/**
 * What the shelf can say about itself, in two queries.
 *
 * The catalog used to call `packStats` once per pack — 72 queries to draw one
 * page, and the front page would have added more on top. Everything either
 * page needs comes from here, and nothing in this file renders anything.
 *
 * Every figure traces to a row we hold. There are no ratings, no vote counts
 * and no "users" number, because we have none, and a marketplace that invents
 * its own popularity has nothing left to sell.
 */
import { sql } from "./sql.js";

export type ShelfTotals = {
  packs: number; roles: number; authors: number; skills: number;
  runs: number; pointsSpent: number;
};

export type PackSignal = { runs: number; buyers: number; version: number };

/** Postgres counts arrive as strings; SQLite's arrive as numbers. */
const n = (v: unknown): number => Number(v ?? 0);

export async function shelfTotals(): Promise<ShelfTotals> {
  const s = await sql();
  const row = await s.one<Record<string, unknown>>(`
    SELECT
      (SELECT COUNT(*) FROM packs WHERE status = 'listed') AS packs,
      (SELECT COUNT(DISTINCT role) FROM packs WHERE status = 'listed' AND role <> '') AS roles,
      (SELECT COUNT(DISTINCT author) FROM packs WHERE status = 'listed') AS authors,
      (SELECT COUNT(*) FROM pack_version_skills k
         JOIN pack_versions v ON v.id = k.pack_version_id
         JOIN packs p ON p.id = v.pack_id WHERE p.status = 'listed') AS skills,
      (SELECT COUNT(*) FROM runs WHERE is_trial = 0) AS runs,
      (SELECT COALESCE(SUM(points_millipoints), 0) FROM runs) AS spent`);
  return {
    packs: n(row?.["packs"]), roles: n(row?.["roles"]), authors: n(row?.["authors"]),
    skills: n(row?.["skills"]), runs: n(row?.["runs"]),
    pointsSpent: n(row?.["spent"]) / 1000,
  };
}

/** Per-pack signals for every listed pack, keyed by pack id. */
export async function packSignals(): Promise<Map<string, PackSignal>> {
  const s = await sql();
  const rows = await s.query<Record<string, unknown>>(`
    SELECT p.id AS pack_id,
      (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
        WHERE v.pack_id = p.id AND r.is_trial = 0) AS runs,
      (SELECT COUNT(DISTINCT e.org_id) FROM entitlements e JOIN pack_versions v ON v.id = e.pack_version_id
        WHERE v.pack_id = p.id) AS buyers,
      (SELECT COALESCE(MAX(version), 0) FROM pack_versions WHERE pack_id = p.id) AS version
    FROM packs p WHERE p.status = 'listed'`);
  return new Map(rows.map((r) => [String(r["pack_id"]), {
    runs: n(r["runs"]), buyers: n(r["buyers"]), version: n(r["version"]),
  }]));
}

export type Anatomy = { dir: string; label: string; packs: number; files: number };

/** The directories a pack folder may carry, in the order the strip reads them. */
const PARTS: Array<[string, string]> = [
  ["skills", "Skills"], ["tools", "Tools"], ["hooks", "Hooks"],
  ["workflows", "Workflows"], ["commands", "Commands"], ["docs", "Docs"],
];

/**
 * What the folders on the shelf actually contain.
 *
 * Pure, so the shaping is testable without a database. A directory nobody uses
 * is left out rather than shown as zero: "0 workflows" invites the question
 * and answers it badly.
 */
export function shapeAnatomy(
  files: Array<{ path: string; packId: string }>,
): Anatomy[] {
  const byDir = new Map<string, { packs: Set<string>; files: number }>();
  for (const f of files) {
    const top = f.path.split("/")[0] ?? "";
    if (!PARTS.some(([d]) => d === top)) continue;   // agent.md is every pack, not a part
    const e = byDir.get(top) ?? { packs: new Set<string>(), files: 0 };
    e.packs.add(f.packId); e.files += 1;
    byDir.set(top, e);
  }
  return PARTS
    .filter(([dir]) => byDir.has(dir))
    .map(([dir, label]) => ({
      dir, label,
      packs: byDir.get(dir)!.packs.size,
      files: byDir.get(dir)!.files,
    }));
}

export async function anatomy(): Promise<Anatomy[]> {
  const s = await sql();
  const rows = await s.query<{ path: string; pack_id: string }>(`
    SELECT f.path, v.pack_id FROM pack_version_files f
      JOIN pack_versions v ON v.id = f.pack_version_id
      JOIN packs p ON p.id = v.pack_id WHERE p.status = 'listed'`);
  return shapeAnatomy(rows.map((r) => ({ path: r.path, packId: r.pack_id })));
}


/**
 * Words in a sentence worth searching for.
 *
 * The funnel asks "what do you need done?", so people answer in sentences.
 * The shelf's own search matches the whole query as one substring, which a
 * sentence can never satisfy: "someone to review my code" found nothing on a
 * shelf that holds a code reviewer. Pulling the carrying words out of the
 * sentence is what makes the question on the page an honest one.
 *
 * Pure, so the hard part — which words carry meaning — is tested directly.
 */
const STOPWORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "anyone", "are", "as", "at", "be", "best",
  "build", "built", "but", "by", "can", "could", "do", "does", "expert", "find", "for",
  "from", "get", "give", "good", "has", "have", "help", "her", "here", "him", "hire",
  "hiring", "his", "how", "i", "in", "into", "is", "it", "its", "just", "like", "looking",
  "me", "more", "my", "need", "needs", "of", "on", "one", "or", "our", "out", "person",
  "please", "pro", "professional", "senior", "should", "so", "some", "somebody",
  "someone", "that", "the", "their", "them", "then", "there", "they", "this", "to",
  "up", "us", "very", "want", "wanted", "wants", "was", "we", "well", "what", "when",
  "which", "who", "why",
  "will", "with", "work", "worker", "would", "you", "your",
]);

export function searchTerms(sentence: string): string[] {
  const seen = new Set<string>();
  for (const raw of sentence.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^[.]+|[.]+$/g, "");
    // Two letters is the floor because the roles people ask for live there:
    // qa, ux, ai. Below that a match is noise.
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    seen.add(w);
    if (seen.size === 6) break;      // a long sentence is a mood, not a query
  }
  return [...seen];
}

/** The text on a pack a search is allowed to look at. */
type Searchable = { name: string; tagline: string; tags: string; role: string; author: string };

/**
 * Order packs by how much of the sentence they answer.
 *
 * Packs arrive already in the shelf's ranked order, and a sort that keeps ties
 * in their incoming order means the shelf's own ranking decides between two
 * packs that match the question equally well.
 */
export function rankByTerms<T extends Searchable>(packs: T[], terms: string[]): T[] {
  if (terms.length === 0) return [];
  const hits = (p: T): number => {
    const hay = `${p.name} ${p.tagline} ${p.tags} ${p.role} ${p.author}`.toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };
  return packs
    .map((p, i) => ({ p, i, h: hits(p) }))
    .filter((x) => x.h > 0)
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.p);
}
