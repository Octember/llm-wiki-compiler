/**
 * How a citation reads on a chip and in a list: a cited line range (`L12–15`,
 * or "whole file") and a span with its file (`notes.md:12-15`), as the server
 * labels citation chips. Pure, so it is tested without a browser.
 */
import type { SourceSpan } from "./api";

/** A cited range as a chip reads it: `L12–15`, `L12`, or "whole file" when the citation names no lines. */
export function rangeLabel(lines: { start: number; end: number } | null | undefined): string {
  if (!lines) return "whole file";
  return lines.end !== lines.start ? `L${lines.start}–${lines.end}` : `L${lines.start}`;
}

/** `notes.md`, `notes.md:12`, `notes.md:12-15`: the label the server gives a citation chip. */
export function spanLabel(span: SourceSpan): string {
  if (span.lines === undefined) return span.file;
  const { start, end } = span.lines;
  return start === end ? `${span.file}:${start}` : `${span.file}:${start}-${end}`;
}
