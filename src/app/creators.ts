import { id, now, platformOrgId } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";

/**
 * A creator: the person or org behind a pack, with a real page instead of a
 * bare string in `packs.author`. That column stays exactly as it is — the
 * display fallback for a pack with no creator record yet — so nothing breaks
 * on day one. Re-attributing the existing catalog is Task 7's job, not this
 * module's.
 *
 * Deliberately absent: an aggregate rating. That depends on the
 * hidden-below-five threshold Task 9 owns in `social.ts`, which does not
 * exist yet; putting a second copy of it here is how the two would drift
 * apart. `creatorStats` only counts things this module can already count
 * honestly — packs, runs, owning orgs.
 */
export class HandleTakenError extends DomainError {
  constructor(handle: string) { super(`the handle "${handle}" is already taken`, 409, "HandleTakenError"); }
}
export class CreatorInputError extends DomainError {
  constructor(message: string) { super(message, 400, "CreatorInputError"); }
}

export type CreatorRow = {
  id: string; user_id: string; org_id: string; handle: string; display_name: string;
  bio: string; avatar: string | null; links: string;
  /** Curator-set, nothing more: there is no self-serve verification. */
  verified: number;
  created_at: string;
};

export type CreatorInput = {
  userId: string; orgId: string; handle: string; displayName: string;
  bio?: string; avatar?: string; links?: Array<{ label: string; url: string }>;
};

export async function creatorByHandle(handle: string): Promise<CreatorRow | undefined> {
  const s = await sql();
  return s.one<CreatorRow>("SELECT * FROM creators WHERE handle = $1", [handle]);
}

/** One creator per organisation — the same org_id a pack's author_org_id points to. */
export async function creatorForOrg(orgId: string): Promise<CreatorRow | undefined> {
  const s = await sql();
  return s.one<CreatorRow>("SELECT * FROM creators WHERE org_id = $1", [orgId]);
}

/**
 * Create or edit an organisation's creator profile. Keyed on org_id, so
 * saving again edits the same row rather than creating a second one; `verified`
 * is never settable here — it starts at its column default and stays there
 * until a curator changes it directly.
 */
export async function upsertCreator(input: CreatorInput): Promise<CreatorRow> {
  const handle = input.handle.trim();
  const displayName = input.displayName.trim();
  if (!handle) throw new CreatorInputError("a creator needs a handle");
  if (!displayName) throw new CreatorInputError("a creator needs a display name");

  const takenBy = await creatorByHandle(handle);
  if (takenBy && takenBy.org_id !== input.orgId) throw new HandleTakenError(handle);

  const s = await sql();
  const existing = await creatorForOrg(input.orgId);
  const creatorId = existing?.id ?? id("cr");
  await s.query(
    `INSERT INTO creators (id, user_id, org_id, handle, display_name, bio, avatar, links, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (org_id) DO UPDATE SET
       user_id = EXCLUDED.user_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
       bio = EXCLUDED.bio, avatar = EXCLUDED.avatar, links = EXCLUDED.links`,
    [creatorId, input.userId, input.orgId, handle, displayName,
      input.bio?.trim() ?? "", input.avatar?.trim() || null, JSON.stringify(input.links ?? []), now()]);
  const created = (await creatorForOrg(input.orgId))!;

  // The curating org's own creator record is the first moment re-attribution
  // can actually succeed (see claimUnownedPacks below). Every other org's
  // profile save is a no-op here, since no pack is ever unowned for them.
  //
  // Logged rather than thrown: this fires on *every* curator profile save,
  // and the profile itself is already written by the time it runs. A failure
  // in a bulk UPDATE over rows this save did not create must not turn an
  // otherwise-valid save into an error page over a change that did land —
  // re-attribution is idempotent, so the next save simply tries again.
  if (input.orgId === (await platformOrgId())) {
    try {
      await claimUnownedPacks(created.id, input.orgId);
    } catch (e) {
      console.error("[creators] claiming unowned packs failed:", (e as Error)?.message ?? e);
    }
  }

  return created;
}

/**
 * Task 7: the one function in this codebase that writes to rows it did not
 * create. Every pack shipped with a bare `author` string and no org or
 * creator behind it; this gives the catalog's existing packs to one real
 * creator, in one pass.
 *
 * Only `author_org_id IS NULL` packs are touched — a pack already attributed
 * to a real author is never in this UPDATE's WHERE clause, so it can never be
 * stolen. That same guard makes a second call a no-op: once a pack is
 * claimed, it drops out of the set and nothing about it changes again.
 *
 * `built_on` gets the pre-existing `author` string wherever `built_on` is
 * itself unset (NULL or '' — the column was added without a NOT NULL
 * default), so a byline like "typeui.sh" or the senior-engineer pack's MIT
 * credit survives as the built-on line instead of being overwritten by the
 * new owner's name. `packs.author` itself is never touched; it stays the
 * display byline exactly as Task 6 left it.
 */
export async function claimUnownedPacks(creatorId: string, orgId: string): Promise<number> {
  const s = await sql();
  const rows = await s.query<{ id: string }>(
    `UPDATE packs SET
       author_org_id = $1,
       creator_id = $2,
       built_on = COALESCE(NULLIF(built_on, ''), author)
     WHERE author_org_id IS NULL
     RETURNING id`,
    [orgId, creatorId]);
  return rows.length;
}

/**
 * What the shelf can honestly say about a creator: summed the same way
 * `packStats` counts a single pack — runs that actually completed (never
 * trials) and the organisations that actually bought something, both summed
 * across every pack this creator has been attributed. No rating; see the
 * module note above.
 */
export async function creatorStats(creatorId: string): Promise<{ packs: number; runs: number; orgs: number }> {
  const s = await sql();
  const row = await s.one<{ packs: string | number; runs: string | number; orgs: string | number }>(
    `SELECT
       (SELECT COUNT(*) FROM packs WHERE creator_id = $1) AS packs,
       (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
          JOIN packs p ON p.id = v.pack_id
         WHERE p.creator_id = $1 AND r.is_trial = 0) AS runs,
       (SELECT COUNT(DISTINCT e.org_id) FROM entitlements e JOIN pack_versions v ON v.id = e.pack_version_id
          JOIN packs p ON p.id = v.pack_id
         WHERE p.creator_id = $1) AS orgs`,
    [creatorId]);
  return {
    packs: Number(row?.packs ?? 0),
    runs: Number(row?.runs ?? 0),
    orgs: Number(row?.orgs ?? 0),
  };
}
