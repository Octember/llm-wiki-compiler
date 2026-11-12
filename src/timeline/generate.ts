/**
 * @file src/timeline/generate.ts
 * @description Compile's timeline step: write a page for every day the sources
 * cover and one for every ISO week, regenerating only pages whose inputs
 * changed, and removing pages for periods no source covers any more.
 *
 * Order: read the compiled sources → bucket by day and week → write the stale
 * daily pages (from the day's source lines) → write the stale weekly pages (from
 * their daily pages) → delete orphaned periods. Daily pages are written before
 * weekly ones because a week reads its days.
 *
 * Each page is rebuilt from its inputs, never appended to, so a re-run is
 * idempotent and an edited source rewrites exactly the days it touches. A day
 * whose model call fails is skipped and reported; its week waits until every
 * day has a page, so a week is never built from a partial set and then marked
 * current by its signature.
 *
 * ONE BODY over {@link TimelineSteps}, like compile's other steps: the model call
 * is the host's, the reads and the compile page write are domain steps.
 */

import pLimit, { type LimitFunction } from "p-limit";
import type { CompilePageWrite } from "../compiler/compile-write.js";
import { splitAnswer, type PageRequest, type ShownLines } from "../compiler/source-excerpt.js";
import {
  claimable, completePage, createdAtOf, deleteAndReport, fitAndReportCitations, fitPageCitations, ownPages, pageBody, readSources, stringField, writeAndReport,
  type DerivedResult, type DerivedSteps, type OwnPage, type PageReport,
} from "../compiler/derived-steps.js";
import { dayBuckets, weekBuckets, type DayBucket, type WeekBucket } from "./buckets.js";
import { dailyRequest, weeklyRequest } from "./prompts.js";
import { extractClaimCitations } from "../utils/markdown.js";
import {
  isTimelinePage, linksOnDay, timelinePage, TIMELINE_NAMESPACE, withDaySections, type CitingPage, type DaySections, type SpannedLink, type TimelinePageMeta,
} from "./pages.js";

/** The reads, model call and write a timeline pass composes. */
export interface TimelineSteps extends DerivedSteps {
  /** The concept pages, for each day's "Pages from this day" section. */
  listConceptPages(): Promise<CitingPage[]>;
  /** The people with the lines they are mentioned on, for each day's "People this day" section. */
  listPeople(): Promise<SpannedLink[]>;
  /** One model completion. */
  complete(request: PageRequest): Promise<string>;
}

/** How a timeline pass runs: the zone that dates its days and how many model calls may run at once. */
export interface TimelineRun {
  timeZone: string;
  concurrency: number;
}

/** What one pass works over: its steps, the sources' texts, the pages it wrote before, its concurrency, and where it reports. */
interface TimelinePass {
  steps: TimelineSteps;
  texts: Map<string, string>;
  existing: Map<string, OwnPage>;
  limit: LimitFunction;
  report: PageReport;
}

/** A day or week page to write, with the body the weekly pass reads (a refreshed tail carries none). */
interface PeriodWrite {
  write: CompilePageWrite;
  body?: string;
}

/** What a regenerated period page is built from, besides the model's answer: its frontmatter, and the source lines the model was shown, which its citations are fitted to. */
type PeriodPage = Pick<TimelinePageMeta, "kind" | "period" | "sources" | "signature"> & { shown: ShownLines[] };

/** Bring `wiki/timeline/` up to date with the sources. */
export async function generateTimelineWith(steps: TimelineSteps, run: TimelineRun): Promise<DerivedResult> {
  const report = timelineReport();
  const read = await readSources(steps);
  const allDays = dayBuckets(read, run.timeZone);
  const { own: existing, foreign } = ownPages(await steps.listPages(TIMELINE_NAMESPACE), isTimelinePage);
  const pass: TimelinePass = { steps, texts: new Map(read.map((source) => [source.file, source.text])), existing, limit: pLimit(run.concurrency), report };
  const allWeeks = weekBuckets(allDays);
  const days = allDays.filter((day) => claimable(report, day.day, foreign));
  const weeks = allWeeks.filter((week) => claimable(report, week.week, foreign) && hasNoForeignDay(report, week, foreign));
  const dailyBodies = await writeDays(pass, days, soleDayOf(allDays));
  await planAndCommit(pass, weeks, (week) => planWeek(pass, week, dailyBodies));
  // A page is an orphan only when no source covers its period; a week held back by a hand-written day keeps its page.
  await deleteAndReport(report, steps, orphanDeletes(pass, allDays, allWeeks));
  return report.result;
}

/** How the timeline names its pages in what it reports. */
function timelineReport(): PageReport {
  return {
    directory: TIMELINE_NAMESPACE, writer: "the timeline",
    label: (slug) => `Timeline page "${slug}"`, id: (slug) => slug,
    result: { written: [], deleted: [], errors: [] },
  };
}

/** The signature stored on a timeline page: the inputs it was built from. */
function storedSignature(page: OwnPage | undefined): string {
  return page ? stringField(page.meta, "timelineSignature") : "";
}

/** Whether every day of a week can have a generated page; a hand-written day holds the week back, and says so. */
function hasNoForeignDay(report: PageReport, week: WeekBucket, foreign: ReadonlySet<string>): boolean {
  if (week.days.every((day) => !foreign.has(day.day))) return true;
  report.result.errors.push(`Timeline week "${week.week}" not written: one of its days is a hand-written page`);
  return false;
}

/**
 * Write every day whose inputs changed, and refresh the generated tail ("Pages
 * from this day", "People this day") of every other day whose concept or person
 * pages moved, without a model call.
 * @returns Day → page body of the days written, for the weekly pass.
 */
async function writeDays(pass: TimelinePass, days: DayBucket[], soleDays: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  if (days.length === 0) return new Map();
  const [conceptPages, people] = await Promise.all([pass.steps.listConceptPages(), pass.steps.listPeople()]);
  const cited: SpannedLink[] = conceptPages.map((page) => ({
    target: page.slug, title: page.title, spans: extractClaimCitations(page.body).flatMap((citation) => citation.spans),
  }));
  return planAndCommit(pass, days, (day) => planDay(pass, day, { related: linksOnDay(day, cited, soleDays), people: linksOnDay(day, people, soleDays) }));
}

/** A day's write: its page regenerated when its lines changed, else its citations and tail refreshed, else nothing. */
async function planDay(pass: TimelinePass, day: DayBucket, sections: DaySections): Promise<PeriodWrite | null> {
  const page = pass.existing.get(day.day);
  const { request, shown } = dailyRequest(day, pass.texts);
  if (page && storedSignature(page) === day.signature) {
    const updated = withDaySections(fitPageCitations(page.text, shown), sections);
    return updated === page.text ? null : { write: timelineWrite(day.day, updated) };
  }
  const answer = await completePage(pass.report, pass.steps, request, day.day);
  if (answer === null) return null;
  const sources = day.sources.map((source) => source.file);
  return periodWrite(pass, { kind: "daily", period: day.day, sources, signature: day.signature, shown }, answer, sections);
}

/**
 * A week's write: its page regenerated when its days changed (null when one of
 * them has no current page or the model call fails), else its citations fitted
 * to its days' lines, else nothing.
 */
async function planWeek(pass: TimelinePass, week: WeekBucket, freshDays: Map<string, string>): Promise<PeriodWrite | null> {
  const page = pass.existing.get(week.week);
  const shown = week.days.flatMap((day) => day.sources);
  if (page && storedSignature(page) === week.signature) {
    const fitted = fitPageCitations(page.text, shown);
    return fitted === page.text ? null : { write: timelineWrite(week.week, fitted) };
  }
  const bodies = week.days.map((day) => ({ day: day.day, body: freshDays.get(day.day) ?? currentBody(pass, day) }));
  if (bodies.some((entry) => !entry.body)) return null;
  const answer = await completePage(pass.report, pass.steps, weeklyRequest(week.week, bodies), week.week);
  if (answer === null) return null;
  const sources = [...new Set(shown.map((source) => source.file))].sort();
  return periodWrite(pass, { kind: "weekly", period: week.week, sources, signature: week.signature, shown }, answer);
}

/** The deletes for timeline pages of days and weeks no source covers any more. */
function orphanDeletes(pass: TimelinePass, days: DayBucket[], weeks: WeekBucket[]): CompilePageWrite[] {
  const live = new Set([...days.map((day) => day.day), ...weeks.map((week) => week.week)]);
  return [...pass.existing].filter(([slug]) => !live.has(slug))
    .map(([slug, page]) => timelineWrite(slug, page.text));
}

/** A regenerated day or week page from the model's answer, keeping the page's original creation time. */
function periodWrite(pass: TimelinePass, page: PeriodPage, answer: string, sections?: DaySections): PeriodWrite {
  const { summary, body } = splitAnswer(fitAndReportCitations(pass.report, page.period, answer, page.shown));
  const now = pass.steps.now();
  const text = timelinePage({
    kind: page.kind, period: page.period, sources: page.sources, signature: page.signature, summary,
    createdAt: createdAtOf(pass.existing.get(page.period), now), updatedAt: now, provenance: pass.steps.provenance(),
  }, body, sections);
  return { write: timelineWrite(page.period, text), body };
}

/** A write of `text` to `wiki/timeline/<slug>.md`. */
function timelineWrite(slug: string, text: string): CompilePageWrite {
  return { namespace: TIMELINE_NAMESPACE, slug, body: text };
}

/**
 * Plan each item's write, at most the pass's concurrency at once, and apply the
 * writes together; returns slug → body of the regenerated pages that landed, for the weekly pass.
 */
async function planAndCommit<T>(pass: TimelinePass, items: T[], plan: (item: T) => Promise<PeriodWrite | null>): Promise<Map<string, string>> {
  const planned = await Promise.all(items.map((item) => pass.limit(() => plan(item))));
  const ready = planned.filter((write): write is PeriodWrite => write !== null);
  const landed = new Set(await writeAndReport(pass.report, pass.steps, ready.map((period) => period.write)));
  return new Map(ready.filter((period) => period.body && landed.has(period.write)).map((period) => [period.write.slug, period.body!]));
}

/** File → the one day its dated content falls on, for each file on exactly one day: a whole-file citation of it belongs to that day. */
function soleDayOf(days: DayBucket[]): Map<string, string> {
  const daysOf = new Map<string, string[]>();
  for (const day of days) for (const source of day.sources) daysOf.set(source.file, [...(daysOf.get(source.file) ?? []), day.day]);
  return new Map([...daysOf].filter(([, fileDays]) => fileDays.length === 1).map(([file, [day]]) => [file, day]));
}

/**
 * A day page's body as the week should read it, or `""` when the page on disk was
 * built from other inputs (its regeneration failed this run) and must not be used.
 */
function currentBody(pass: TimelinePass, day: DayBucket): string {
  const page = pass.existing.get(day.day);
  if (!page || storedSignature(page) !== day.signature) return "";
  return pageBody(page);
}
