/**
 * Pure relevance scoring for `search_packs`.
 *
 * No database, no I/O — a plain function over plain strings, so it is
 * trivial to unit-test and impossible to accidentally turn into a per-pack
 * query. `shelf.ts` is the only caller, and it supplies every field after
 * doing whatever I/O was needed to resolve them.
 *
 * Field weights favour what a buyer is most likely typing: the name (and its
 * slug, the surface's own currency) most, then what the pack actually
 * touches (its tags and its declared tools), then the pitch (tagline,
 * author), then the softer listing prose (use cases, then the long-form
 * description) least. Within one field, a query that lands as a whole phrase
 * outranks the same words landing separately — "code review" beats a pack
 * whose tagline merely contains "code" and "review" apart from one another.
 */

export type ScoreFields = {
  name: string;
  tagline: string;
  author: string;
  description: string;
  useCases: string[];
  tags: string;
  tools: string[];
  /** The pack's slug — this surface's own currency: every other tool takes
   * one, `search_packs` prints `Name (slug)`, and its own description tells
   * agents to call it when they don't know the slug. Weighted alongside
   * `name` so a query that *is* a slug — "senior-engineer" — actually finds
   * the pack it names. */
  slug: string;
};

const WEIGHTS: ReadonlyArray<readonly [keyof ScoreFields, number]> = [
  ["name", 8],
  ["slug", 8],
  ["tags", 5],
  ["tools", 5],
  ["tagline", 3],
  ["author", 3],
  ["useCases", 2],
  ["description", 1],
];

const flatten = (v: string | string[]): string => (Array.isArray(v) ? v.join(" ") : v);

/** `-` and `_` normalised to spaces, so a hyphenated slug and its spaced-out
 * name tokenise into the same words either side of the match. Applied to
 * both the query and every field before either is tokenised or tested. */
const normalize = (s: string): string => s.replace(/[-_]+/g, " ");

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A query word's match pattern.
 *
 * A word under 4 characters still requires a boundary at *both* ends —
 * otherwise a two-letter word like "in" would "match" almost every field in
 * the catalog ("into", "inbox", "pointing", …) and a search for anything
 * containing it would come back as a page of noise instead of the empty
 * result that query actually deserves.
 *
 * A word of 4 or more characters only requires a *leading* boundary: a buyer
 * typing "audit" or "engineer" means to find "Audits" or "Engineering" too,
 * and at four characters and up a false positive from this relaxation (some
 * unrelated longer word that merely starts the same way) is rare enough to
 * be worth it, while still never matching mid-word ("Maudit" does not start
 * a word at its "audit", so it still would not match).
 */
const wordPattern = (word: string): RegExp => {
  const esc = escapeRegExp(word);
  return word.length >= 4 ? new RegExp(`\\b${esc}`) : new RegExp(`\\b${esc}\\b`);
};

/**
 * `query` matched against every weighted field, case-insensitively, with `-`
 * and `_` normalised to spaces on both sides first.
 *
 * Each query word present in a field earns that field's weight; a field that
 * contains every query word *and* contains them as the exact phrase earns a
 * further bonus of one weight per word — guaranteeing a phrase hit scores
 * above the same words merely being present, in that field or spread across
 * several. The phrase check compares against the normalised, single-spaced
 * query (`words.join(" ")`), not the raw query string, so doubled whitespace
 * or a hyphen in the query can never make a real phrase hit fail the check.
 * Zero when the query is empty or nothing matches anywhere.
 */
export function score(query: string, fields: ScoreFields): number {
  const q = normalize(query.trim().toLowerCase());
  if (!q) return 0;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const patterns = words.map(wordPattern);
  const phrase = words.join(" ");
  let total = 0;
  for (const [key, weight] of WEIGHTS) {
    const text = normalize(flatten(fields[key]).toLowerCase());
    if (!text) continue;
    let hits = 0;
    for (const pattern of patterns) if (pattern.test(text)) hits += 1;
    if (hits === 0) continue;
    total += hits * weight;
    if (words.length > 1 && hits === words.length && text.includes(phrase)) {
      total += words.length * weight;
    }
  }
  return total;
}
