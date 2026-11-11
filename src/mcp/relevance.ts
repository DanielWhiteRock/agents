/**
 * Pure relevance scoring for `search_packs`.
 *
 * No database, no I/O — a plain function over plain strings, so it is
 * trivial to unit-test and impossible to accidentally turn into a per-pack
 * query. `shelf.ts` is the only caller, and it supplies every field after
 * doing whatever I/O was needed to resolve them.
 *
 * Field weights favour what a buyer is most likely typing: the name most,
 * then what the pack actually touches (its tags and its declared tools),
 * then the pitch (tagline, author), then the softer listing prose (use
 * cases, then the long-form description) least. Within one field, a query
 * that lands as a whole phrase outranks the same words landing separately —
 * "code review" beats a pack whose tagline merely contains "code" and
 * "review" apart from one another.
 */

export type ScoreFields = {
  name: string;
  tagline: string;
  author: string;
  description: string;
  useCases: string[];
  tags: string;
  tools: string[];
};

const WEIGHTS: ReadonlyArray<readonly [keyof ScoreFields, number]> = [
  ["name", 8],
  ["tags", 5],
  ["tools", 5],
  ["tagline", 3],
  ["author", 3],
  ["useCases", 2],
  ["description", 1],
];

const flatten = (v: string | string[]): string => (Array.isArray(v) ? v.join(" ") : v);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A query word matches a field as a whole word, not as a substring of a
 * longer one — otherwise a two-letter word like "in" would "match" almost
 * every field in the catalog ("into", "inbox", "pointing", …) and a search
 * for anything containing it would come back as a page of noise instead of
 * the empty result that query actually deserves.
 */
const wordPattern = (word: string): RegExp => new RegExp(`\\b${escapeRegExp(word)}\\b`);

/**
 * `query` matched against every weighted field, case-insensitively.
 *
 * Each query word present in a field earns that field's weight; a field that
 * contains every query word *and* contains them as the exact phrase earns a
 * further bonus of one weight per word — guaranteeing a phrase hit scores
 * above the same words merely being present, in that field or spread across
 * several. Zero when the query is empty or nothing matches anywhere.
 */
export function score(query: string, fields: ScoreFields): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const words = q.split(/\s+/).filter(Boolean);
  const patterns = words.map(wordPattern);
  let total = 0;
  for (const [key, weight] of WEIGHTS) {
    const text = flatten(fields[key]).toLowerCase();
    if (!text) continue;
    let hits = 0;
    for (const pattern of patterns) if (pattern.test(text)) hits += 1;
    if (hits === 0) continue;
    total += hits * weight;
    if (words.length > 1 && hits === words.length && text.includes(q)) {
      total += words.length * weight;
    }
  }
  return total;
}
