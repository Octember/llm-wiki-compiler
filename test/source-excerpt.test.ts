/**
 * @file test/source-excerpt.test.ts
 * @description What a page prompt shows and how its answer is read: a day's
 * excerpt keeps each line's original number, a long source is cut at a line
 * and says how much was cut, the budget is shared so a long chat cannot crowd
 * out a short note, the summary line splits from the body, and citations are
 * fitted to the shown lines (a span across a gap is cut to them, a span with no
 * shown line is kept and counted, and fitting is idempotent).
 */

import { describe, expect, it } from "bun:test";
import { fitCitations, sourcesExcerpt, splitAnswer } from "../src/compiler/source-excerpt.js";
import { dayBuckets } from "../src/timeline/buckets.js";

const CHAT = ["# Chat", "- 2026-05-04 09:00 A: plan the trip", "- 2026-05-05 10:00 B: booked it"].join("\n");

const SHOWN = [{ file: "chat.md", ranges: [{ start: 94, end: 102 }, { start: 110, end: 114 }] }, { file: "note.md", ranges: [{ start: 1, end: 5 }] }];

describe("fitting citations to the shown lines", () => {
  it("cuts a span across a gap to the shown lines on each side", () => {
    expect(fitCitations("- Met. ^[chat.md:97-112]", SHOWN)).toEqual({ body: "- Met. ^[chat.md:97-102, 110-112]", outside: 0 });
  });

  it("leaves spans inside the shown lines, and whole-file citations, byte for byte", () => {
    const body = "- A. ^[chat.md:95-100]\n- B. ^[note.md:2-3, chat.md:111-111]\n- C. ^[note.md]";
    expect(fitCitations(body, SHOWN)).toEqual({ body, outside: 0 });
  });

  it("keeps and counts a span with no shown line, or in a file not shown", () => {
    const body = "- A. ^[chat.md:103-109]\n- B. ^[other.md:1-2]";
    expect(fitCitations(body, SHOWN)).toEqual({ body, outside: 2 });
  });

  it("fits only the span that needs it in a citation of several, and changes nothing the second time", () => {
    const once = fitCitations("- A. ^[note.md:2-3, chat.md:100-111]", SHOWN).body;
    expect(once).toBe("- A. ^[note.md:2-3, chat.md:100-102, 110-111]");
    expect(fitCitations(once, SHOWN)).toEqual({ body: once, outside: 0 });
  });

  it("leaves a marker with a malformed entry as written, for the linter to report", () => {
    const body = "- A. ^[a.md:12-5, chat.md:97-112]";
    expect(fitCitations(body, SHOWN).body).toBe(body);
  });

  it("joins a file's shown ranges from several sources before fitting", () => {
    const split = [{ file: "chat.md", ranges: [{ start: 1, end: 3 }] }, { file: "chat.md", ranges: [{ start: 4, end: 6 }] }];
    expect(fitCitations("- A. ^[chat.md:2-5]", split)).toEqual({ body: "- A. ^[chat.md:2-5]", outside: 0 });
  });
});

describe("a day's source excerpt", () => {
  it("cuts a day past the excerpt budget at a line, and says how much was cut", () => {
    const long = Array.from({ length: 3000 }, (_, index) => `- 2026-05-0${index < 2999 ? 4 : 5} 09:00 ${"x".repeat(40)}`).join("\n");
    const [day] = dayBuckets([{ file: "big.md", hash: "h", text: long }], "UTC");
    const excerpt = sourcesExcerpt(day.sources, new Map([["big.md", long]])).text;
    expect(excerpt.length).toBeLessThan(61_000);
    expect(excerpt).toMatch(/^--- SOURCE: big\.md ---\n\n {3}1 \| /);
    expect(excerpt).toMatch(/\(\d+ more lines not shown: over the excerpt budget\. Do not cite them\.\)$/);
  });

  it("shares the budget so a long chat cannot crowd out a short note, and reports the lines it did not show", () => {
    const chat = Array.from({ length: 3000 }, (_, index) => `- 2026-05-04 09:${String(index % 60).padStart(2, "0")} ${"x".repeat(40)}`).join("\n");
    const note = "---\ndate: 2026-05-04\n---\nDecided to hire.";
    const [day] = dayBuckets([{ file: "a-chat.md", hash: "1", text: chat }, { file: "b-note.md", hash: "2", text: note }], "UTC");
    const { text, shown } = sourcesExcerpt(day.sources, new Map([["a-chat.md", chat], ["b-note.md", note]]));
    expect(text).toContain("--- SOURCE: b-note.md ---\n\n4 | Decided to hire.");
    expect(shown.find((source) => source.file === "b-note.md")!.ranges).toEqual([{ start: 4, end: 4 }]);
    expect(fitCitations("Late. ^[a-chat.md:2999-2999]", shown).outside).toBe(1);
  });

  it("shows a day's lines under their original numbers, ranges apart", () => {
    const [, second] = dayBuckets([{ file: "chat.md", hash: "h", text: CHAT }], "UTC");
    expect(sourcesExcerpt(second.sources, new Map([["chat.md", CHAT]])).text).toBe("--- SOURCE: chat.md ---\n\n3 | - 2026-05-05 10:00 B: booked it");
  });

  it("splits the summary line from the body, and keeps an answer without one whole", () => {
    expect(splitAnswer("SUMMARY: A day.\n\nBody ^[a.md:1-2]")).toEqual({ summary: "A day.", body: "Body ^[a.md:1-2]" });
    expect(splitAnswer("Just a body.")).toEqual({ summary: "", body: "Just a body." });
  });
});
