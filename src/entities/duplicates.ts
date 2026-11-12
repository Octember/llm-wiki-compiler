/**
 * @file src/entities/duplicates.ts
 * @description Records that MIGHT be the same one: one's name or spelling is
 * another's first name, or two share a first name. They are flagged both ways
 * for the owner to settle in the registry, never merged, since a wrong merge is
 * worse than a duplicate.
 */

import { normalizeName } from "./registry.js";
import type { ResolvedRecord } from "./identity.js";

/**
 * Words a spelling can start with that name a relation, not a person: possessive
 * pronouns ("my dad") and family words ("mom", "mother-in-law"). A spelling that
 * starts with one never makes a "Might be the same as" flag. (A given name that is
 * also a family word, like "Son", is not indexed either; its full name still is.)
 */
const RELATION_WORDS = new Set([
  "my", "your", "his", "her", "our", "their",
  "mom", "mum", "mama", "momma", "mommy", "mother", "dad", "papa", "father", "parent", "parents", "brother", "brothers", "sister", "sisters",
  "aunt", "auntie", "aunts", "uncle", "uncles", "cousin", "niece", "nephew", "wife", "husband", "partner", "son", "daughter", "kid", "child", "baby",
  "grandma", "grandmother", "grandpa", "grandfather", "gran", "granny", "nan",
]);

/** A name formed as a relation to someone ("Sam's mother"). */
const RELATION_NAME = /\S['’]s\s/;

/** Whether a normalized first word names a relation: one of {@link RELATION_WORDS}, an in-law, or a step-relation. */
function isRelationWord(word: string): boolean {
  return RELATION_WORDS.has(word) || word.endsWith("-in-law") || (word.startsWith("step") && RELATION_WORDS.has(word.slice("step".length)));
}

/**
 * Record id → ids of records that might be the same one: a name or spelling of
 * one is another's first name, or two share a first name. A relation name ("Sam's
 * mother") and a spelling that starts with a possessive pronoun or family word
 * ("my dad", "mom") are not indexed by their first word, which names no one. Ids in one of the
 * `distinct` sets were settled as different people and are never flagged together.
 */
export function possibleDuplicates(records: ResolvedRecord[], distinct: string[][] = []): Map<string, string[]> {
  const settled = (a: string, b: string): boolean => distinct.some((set) => set.includes(a) && set.includes(b));
  const others = new Map<string, Set<string>>();
  for (const ids of firstNameIndex(records).values()) {
    for (const id of ids) for (const other of ids) if (other !== id && !settled(id, other)) others.set(id, (others.get(id) ?? new Set()).add(other));
  }
  return new Map([...others].map(([id, ids]) => [id, [...ids].sort()]));
}

/** First word → ids of the records with a name or spelling starting with it; relation names and words that name no one are left out. */
function firstNameIndex(records: ResolvedRecord[]): Map<string, Set<string>> {
  const firstNames = new Map<string, Set<string>>();
  for (const record of records) {
    for (const name of record.names.filter((candidate) => !RELATION_NAME.test(candidate))) {
      const first = normalizeName(name).split(" ")[0];
      if (first && !isRelationWord(first)) firstNames.set(first, (firstNames.get(first) ?? new Set()).add(record.id));
    }
  }
  return firstNames;
}
