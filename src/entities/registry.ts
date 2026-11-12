/**
 * @file src/entities/registry.ts
 * @description The owner's alias registry, `.llmwiki/aliases.json`: the owner's
 * word on who is who. Every name it lists under a record id is that record, the
 * owner's own names are never a record, names under `exclude` are not records of
 * that type (people only mentioned in passing, or names the model took for a
 * person that are not one), and ids in a `distinct` set were settled as different
 * people:
 *   { "owner": { "type": "person", "names": ["Sam", "Sam Rivera"] },
 *     "entities": { "person": { "alex-kim": ["Alex", "Alex Kim"] } },
 *     "exclude": { "person": ["Donald Trump", "Acme Corp"] },
 *     "distinct": { "person": [["alex", "alex-kim"]] } }
 * Also how names are compared: without case, accents, punctuation or extra spacing.
 */

import { isSlugSafe } from "../profile/identity.js";

/** The owner's alias registry. */
export interface AliasRegistry {
  owner?: { type: string; names: string[] };
  /** Entity type → record id → the names that are that record. */
  entities: Record<string, Record<string, string[]>>;
  /** Entity type → names that are not records of that type. */
  exclude?: Record<string, string[]>;
  /** Entity type → sets of record ids the owner settled as different people, never flagged as possibly the same. */
  distinct?: Record<string, string[][]>;
}

/** What a malformed `owner` is told it must be. */
const OWNER_SHAPE = '"owner" must be { "type": …, "names": [ … ] }';

/**
 * Read the registry text, or an empty registry when there is none. Malformed
 * JSON, any part of the wrong shape (an owner without a type and a list of
 * names, a record id that is not a slug, a map that is not of lists), or a name
 * both excluded and registered throws, so a mistake is never silently ignored.
 */
export function parseRegistry(text: string | null): AliasRegistry {
  if (text === null) return { entities: {} };
  const raw = JSON.parse(text) as Record<string, unknown>;
  const owner = parseOwner(raw.owner);
  const entities = Object.fromEntries(Object.entries(mapOf(raw.entities, '"entities" must map each entity type to its records'))
    .map(([type, records]) => [type, listsByKey(records, `"entities.${type}" must map each record id to a list of names`)]));
  for (const [type, records] of Object.entries(entities)) {
    const bad = Object.keys(records).find((id) => !isSlugSafe(id));
    if (bad !== undefined) throw new Error(`"entities.${type}" record id "${bad}" is not a slug (lowercase letters, digits and hyphens)`);
  }
  const exclude = listsByKey(raw.exclude, '"exclude" must map each entity type to a list of names');
  assertNotBoth(entities, exclude);
  const distinct = parseDistinct(raw.distinct);
  return {
    ...(owner ? { owner } : {}), entities,
    ...(Object.keys(exclude).length > 0 ? { exclude } : {}), ...(Object.keys(distinct).length > 0 ? { distinct } : {}),
  };
}

/** The owner, or undefined when there is none; an owner without a type and a list of names throws. */
function parseOwner(value: unknown): AliasRegistry["owner"] {
  if (value === undefined) return undefined;
  const owner = mapOf(value, OWNER_SHAPE);
  if (typeof owner.type !== "string" || !Array.isArray(owner.names)) throw new Error(OWNER_SHAPE);
  return { type: owner.type, names: strings(owner.names) };
}

/** `value` as an object (`{}` when absent); anything else throws `message`. */
function mapOf(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

/** `value` as key → list of strings (`{}` when absent); a value that is not a list throws `message`. */
function listsByKey(value: unknown, message: string): Record<string, string[]> {
  const map = mapOf(value, message);
  if (!Object.values(map).every(Array.isArray)) throw new Error(message);
  return Object.fromEntries(Object.entries(map).map(([key, names]) => [key, strings(names)]));
}

/** `distinct` as type → sets of record ids; anything but a map of lists of two or more slug ids throws. */
function parseDistinct(value: unknown): Record<string, string[][]> {
  const message = '"distinct" must map each entity type to a list of sets, each two or more record ids';
  const map = mapOf(value, message);
  const isIdSet = (set: unknown): boolean => Array.isArray(set) && set.length >= 2 && set.every((id) => typeof id === "string" && isSlugSafe(id));
  if (!Object.values(map).every((sets) => Array.isArray(sets) && sets.every(isIdSet))) throw new Error(message);
  return map as Record<string, string[][]>;
}

/** The strings in a list, ignoring anything else. */
function strings(value: unknown): string[] {
  return (value as unknown[]).filter((item): item is string => typeof item === "string");
}

/** Throw when a name is both excluded and registered under a record id of the same type. */
function assertNotBoth(entities: AliasRegistry["entities"], exclude: Record<string, string[]>): void {
  for (const [type, names] of Object.entries(exclude)) {
    const excluded = new Set(names.map(normalizeName));
    for (const [id, registered] of Object.entries(entities[type] ?? {})) {
      const both = registered.find((name) => excluded.has(normalizeName(name)));
      if (both) throw new Error(`"${both}" is both excluded and registered under ${type} "${id}"`);
    }
  }
}

/** A name with its accents removed ("Núñez" → "Nunez"). */
export function withoutAccents(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** A name compared without case, accents, punctuation or extra spacing. */
export function normalizeName(name: string): string {
  return withoutAccents(name).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
}
