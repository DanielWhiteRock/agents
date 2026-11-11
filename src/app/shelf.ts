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
