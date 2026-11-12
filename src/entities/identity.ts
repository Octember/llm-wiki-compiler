/**
 * @file src/entities/identity.ts
 * @description Which extracted names are the same record. Wrong merges are
 * worse than duplicates, so nothing here guesses:
 *
 *  - Extraction answers WHO each mention is (`name`, the fullest correct name the
 *    source supports, or a relation such as "Sam's mother") separately from how
 *    the source writes it (`writtenAs`: "Tommmy", "mama"). Records are grouped by
 *    `name`, and the registry, `exclude` and the owner check all match `name`;
 *    the spellings become the page's aliases and feed the possible-duplicate
 *    flags, but never merge or exclude anything.
 *  - The registry (see `registry.ts`) is the owner's word: every name it lists
 *    under a record id is that record, and the owner's names are no record.
 *  - Otherwise a name is its own record: names that normalize the same (case,
 *    accents, spacing) are one record, and any other name is a different one,
 *    even when both make the same slug: the later one's id gets a suffix.
 *  - Names the registry excludes from a type are not records of it.
 *  - The owner page has an id of its own that no record takes.
 */

import { isSlugSafe } from "../profile/identity.js";
import { slugify } from "../utils/markdown.js";
import { normalizeName, withoutAccents, type AliasRegistry } from "./registry.js";
import type { Mention } from "./extract.js";

/** One record after identity: its id, the name its page shows, every name it went by, and every mention. */
export interface ResolvedRecord {
  id: string;
  title: string;
  /** Every name it went by, then every other way the sources wrote it. */
  names: string[];
  mentions: Mention[];
}

/** Longest record id; a longer one is cut and given a hash so it stays unique and fits a filename. */
const MAX_ID_LENGTH = 80;
/** Room a cut id keeps for its hash: a hyphen and up to seven base-36 digits of a 32-bit hash. */
const HASH_SUFFIX_ROOM = 8;

/** A slug-safe id for a name: ASCII-folded and at most {@link MAX_ID_LENGTH} long, or a short hash when nothing slug-safe is left. */
export function recordId(name: string): string {
  const folded = slugify(withoutAccents(name)).replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (!isSlugSafe(folded)) return `record-${nameHash(name)}`;
  return folded.length <= MAX_ID_LENGTH ? folded : `${folded.slice(0, MAX_ID_LENGTH - HASH_SUFFIX_ROOM).replace(/-+$/, "")}-${nameHash(name)}`;
}

/** A short, stable hash of a name. */
function nameHash(name: string): string {
  let hash = 0;
  for (const char of normalizeName(name)) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash.toString(36);
}

/** The id of the owner page in `type`, or null when the owner is not of that type. */
export function ownerPageId(registry: AliasRegistry, type: string): string | null {
  const name = registry.owner?.type === type ? registry.owner.names[0] : undefined;
  if (!name) return null;
  const taken = new Set(Object.keys(registry.entities[type] ?? {}));
  const base = recordId(name);
  return taken.has(base) ? uniqueId(`${base}-owner`, taken) : base;
}

/**
 * Group one type's mentions into records: registry names first, then exact
 * normalized names. Each record gets its own id: a registry id as given, else
 * its name's slug, with a numbered suffix when another record or the owner page has it.
 */
export function resolveRecords(type: string, mentions: Mention[], registry: AliasRegistry): ResolvedRecord[] {
  const taken = new Set(Object.keys(registry.entities[type] ?? {}));
  const ownerPage = ownerPageId(registry, type);
  if (ownerPage) taken.add(ownerPage);
  // Excluded names still take their ids here, so excluding one never renames another record.
  return [...groupMentions(type, mentions, registry)].sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({ group, id: group.registered ?? uniqueId(recordId(group.names[0]), taken) }))
    .filter(({ group }) => !group.excluded)
    .map(({ group, id }) => ({
      id, title: displayName(group.mentions, registry.entities[type]?.[id]), names: [...group.names, ...spellingsOf(group)], mentions: group.mentions,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** One record's mentions before it has an id: the registry id it has, if any, whether it is excluded, and the names it went by. */
interface MentionGroup { registered?: string; excluded: boolean; names: string[]; mentions: Mention[] }

/** Mentions grouped by registry id, else by normalized name, with excluded names marked; the owner's names are left out. */
function groupMentions(type: string, mentions: Mention[], registry: AliasRegistry): Map<string, MentionGroup> {
  const { owner, excluded, known } = registryIndex(type, registry);
  const groups = new Map<string, MentionGroup>();
  for (const mention of mentions) {
    const key = normalizeName(mention.name);
    if (!key || owner.has(key)) continue;
    const registered = known.get(key);
    const groupKey = registered ? `id:${registered}` : `name:${key}`;
    const group = groups.get(groupKey) ?? { registered, excluded: excluded.has(key), names: [], mentions: [] };
    if (!group.names.includes(mention.name)) group.names.push(mention.name);
    group.mentions.push(mention);
    groups.set(groupKey, group);
  }
  return groups;
}

/** Words that refer to someone without naming them; a spelling made only of these is no name. */
const PRONOUNS = new Set(["i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "hers", "it", "its", "we", "us", "our", "they", "them", "their", "the", "a"]);
/** Whether a spelling is only pronouns and articles ("they", "his"), which the model sometimes lists among how a source writes someone. */
function isPronoun(form: string): boolean {
  return normalizeName(form).split(" ").every((word) => PRONOUNS.has(word));
}

/** An address rather than a name, which is never kept as a spelling. */
const ADDRESS = /@|:\/\//;
/** A possessive ending after a lowercase letter ("Ben’s", "parents’"), which is not part of the name; "O'S" is left alone. */
const POSSESSIVE = /(?<=\p{Ll})['’]s?$/u;

/** A spelling as kept: trimmed, without a possessive ending. */
function cleanSpelling(form: string): string {
  return form.trim().replace(POSSESSIVE, "").trim();
}

/**
 * The spellings a group's mentions used that are not among its names, as kept
 * by {@link cleanSpelling}, leaving out addresses and bare pronouns. The cache
 * holds spellings as the model wrote them, so these rules reach every cached answer.
 */
function spellingsOf(group: MentionGroup): string[] {
  const names = new Set(group.names.map(normalizeName));
  const first = new Map<string, string>();
  for (const form of group.mentions.flatMap((mention) => mention.writtenAs ?? []).filter((form) => !ADDRESS.test(form)).map(cleanSpelling)) {
    const key = normalizeName(form);
    if (key && !names.has(key) && !isPronoun(form) && !first.has(key)) first.set(key, form);
  }
  return [...first.values()];
}

/** The registry for one type, by normalized name: the owner's names, the excluded names, and each registered name's id. */
function registryIndex(type: string, registry: AliasRegistry): { owner: Set<string>; excluded: Set<string>; known: Map<string, string> } {
  const owner = new Set((registry.owner?.type === type ? registry.owner.names : []).map(normalizeName));
  const excluded = new Set((registry.exclude?.[type] ?? []).map(normalizeName));
  const known = new Map<string, string>();
  for (const [id, names] of Object.entries(registry.entities[type] ?? {})) for (const name of names) known.set(normalizeName(name), id);
  return { owner, excluded, known };
}

/** `base`, or `base-2`, `base-3`… the first one not yet taken; marks it taken. */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`;
  taken.add(id);
  return id;
}

/**
 * The name a record is shown under: the registry's first name for it, else its
 * fullest, most-used name, preferring one written with capitals. A name only ever
 * written in lowercase (common in chats) is shown with each word capitalized; the
 * spellings as written stay in the record's names.
 */
function displayName(mentions: Mention[], registered: string[] | undefined): string {
  if (registered?.[0]) return registered[0];
  const uses = new Map<string, number>();
  for (const mention of mentions) uses.set(mention.name, (uses.get(mention.name) ?? 0) + 1);
  const capitalized = (name: string): number => (name === name.toLowerCase() ? 0 : 1);
  const [chosen] = [...uses].sort(([a, x], [b, y]) =>
    b.split(" ").length - a.split(" ").length || capitalized(b) - capitalized(a) || y - x || a.localeCompare(b))[0];
  return capitalized(chosen) ? chosen : chosen.replace(/(^|\s)(\p{Ll})/gu, (_match, space: string, letter: string) => space + letter.toUpperCase());
}
