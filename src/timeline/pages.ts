/**
 * @file src/timeline/pages.ts
 * @description Assemble timeline pages: titles, frontmatter and the
 * deterministic tail that ties a day (the episode) to the concept pages built
 * from its lines (what was learned) and to the people in it.
 *
 * Frontmatter carries `timeline` (`daily` | `weekly`), the `date` or `week` it
 * covers, its `sources`, and `timelineSignature`, which the generator compares
 * on the next compile to skip a page whose inputs have not changed.
 */

import { buildFrontmatter } from "../utils/markdown.js";
import { overlaps, type LineRange } from "../compiler/source-excerpt.js";
import { ownPages, pageBody, stringField } from "../compiler/derived-steps.js";
import { linkList, withGenerated, type PageLink } from "../wiki/generated-section.js";
import { weekStart, type DayBucket } from "./buckets.js";

/** The wiki namespace timeline pages live in: `wiki/timeline/`. */
export const TIMELINE_NAMESPACE = "timeline";

/** A concept page, as the related-pages section needs it. */
export interface CitingPage {
  slug: string;
  title: string;
  body: string;
}

/** What a timeline page records about itself in frontmatter. */
export interface TimelinePageMeta {
  kind: "daily" | "weekly";
  /** `YYYY-MM-DD` for a day, `YYYY-Www` for a week. */
  period: string;
  summary: string;
  sources: string[];
  signature: string;
  createdAt: string;
  updatedAt: string;
  /** Model provenance, stamped by the caller. */
  provenance: Record<string, unknown>;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
const DAY_TITLE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });

/** `May 4, 2026` for a `YYYY-MM-DD` day. */
export function formatDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

/** `Monday, May 4, 2026`: a day page's title. */
function dayTitle(day: string): string {
  return DAY_TITLE_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

/** `Week of May 4, 2026` for an ISO week. */
function weekTitle(week: string): string {
  return `Week of ${formatDay(weekStart(week))}`;
}

/** A day's generated tail: the concept pages built from its lines, and the people in it. */
export interface DaySections {
  related: PageLink[];
  people: PageLink[];
}

/** The full markdown of a timeline page. */
export function timelinePage(meta: TimelinePageMeta, body: string, sections: DaySections = { related: [], people: [] }): string {
  const frontmatter = buildFrontmatter({
    title: meta.kind === "daily" ? dayTitle(meta.period) : weekTitle(meta.period),
    summary: meta.summary,
    sources: meta.sources,
    timeline: meta.kind,
    [meta.kind === "daily" ? "date" : "week"]: meta.period,
    timelineSignature: meta.signature,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ...meta.provenance,
  });
  return withDaySections(`${frontmatter}\n\n${body.trim()}\n`, sections);
}

/** A link (a concept page, a person) with the source spans it draws on; a span without lines covers its whole file. */
export interface SpannedLink extends PageLink {
  spans: { file: string; lines?: LineRange }[];
}

/** Whether any of `lines` in `file` falls on the day. */
export function dayCovers(bucket: DayBucket, file: string, lines: LineRange): boolean {
  return bucket.sources.some((source) => source.file === file && source.ranges.some((range) => overlaps(range, lines)));
}

/**
 * The links with a span on the day, by title. A whole-file span counts only when
 * all of that file's dated content is on this one day (`soleDays`: file → its only day).
 */
export function linksOnDay(bucket: DayBucket, links: SpannedLink[], soleDays: ReadonlyMap<string, string>): PageLink[] {
  return links
    .filter((link) => link.spans.some((span) => (span.lines ? dayCovers(bucket, span.file, span.lines) : soleDays.get(span.file) === bucket.day)))
    .map(({ target, title }) => ({ target, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** A day's generated tail as markdown: the concept pages built from its lines, then the people in it. */
function daySections({ related, people }: DaySections): string {
  return [
    related.length > 0 ? `## Pages from this day\n\n${linkList(related)}` : "",
    people.length > 0 ? `## People this day\n\n${linkList(people)}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * A day page's text with its generated tail rebuilt. The tail is derived from
 * concept and person pages, which change without the day's sources changing,
 * so it is kept current on every compile without a model call.
 */
export function withDaySections(text: string, sections: DaySections): string {
  return withGenerated(text, daySections(sections));
}

/** Whether a page's frontmatter says the timeline wrote it (a day or a week). */
export function isTimelinePage(meta: Record<string, unknown>): boolean {
  return meta.timeline === "daily" || meta.timeline === "weekly";
}

/** The week pages among the timeline's pages, newest first: each week and its model-written body. */
export function weekPages(texts: Map<string, string>): { week: string; body: string }[] {
  const { own } = ownPages(texts, (meta) => meta.timeline === "weekly");
  return [...own.values()].map((page) => ({ week: stringField(page.meta, "week"), body: pageBody(page) }))
    .filter((week) => week.week && week.body).sort((a, b) => b.week.localeCompare(a.week));
}
