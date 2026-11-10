import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { claimPlatformOrg, id, now, settingInt } from "./db.js";
import { sql } from "./sql.js";
import { credit } from "../billing/points.js";
import { DomainError } from "./errors.js";

/**
 * Passwords, sessions, invitations and roles.
 *
 * No dependencies: scrypt and randomBytes are in Node. The point is not to be
 * clever, it is to stop the current situation where anyone who reaches the port
 * is the owner of the organisation.
 */

export type Role = "owner" | "member";

/** A permission denial, not a crash: the server answers 403, not 500. */
export class ForbiddenError extends DomainError {
  constructor(message = "only an owner can do that") {
    super(message, 403, "ForbiddenError");
  }
}

export type UserRow = {
  id: string; org_id: string; email: string; name: string; role: Role;
  password_hash: string | null; created_at: string;
};

export type Session = { user: UserRow; orgId: string; role: Role };

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const [, nRaw, salt, expected] = parts as [string, string, string, string];
  const n = Number(nRaw);
  if (!Number.isFinite(n) || n <= 0) return false;
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: n, r: SCRYPT.r, p: SCRYPT.p });
  const a = Buffer.from(expected, "base64url");
  // timingSafeEqual throws on a length mismatch, which is itself a signal.
  return a.length === key.length && timingSafeEqual(a, key);
}

export const newToken = (): string => randomBytes(32).toString("base64url");

// ---------------------------------------------------------------- sessions

const SESSION_DAYS = 30;

export async function createSession(userId: string): Promise<string> {
  const s = await sql();
  const token = newToken();
  await s.query(
    "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)",
    [token, userId, now(), new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()]);
  return token;
}

export async function sessionFromToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const s = await sql();
  const row = await s.one<UserRow & { expires_at: string }>(
    `SELECT u.*, us.expires_at FROM user_sessions us JOIN users u ON u.id = us.user_id
     WHERE us.token = $1 AND us.expires_at > $2`, [token, now()]);
  if (!row) return null;
  return { user: row, orgId: row.org_id, role: row.role };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const s = await sql();
  await s.query("DELETE FROM user_sessions WHERE token = $1", [token]);
}

// ------------------------------------------------------------------ people

export async function userByEmail(email: string): Promise<UserRow | undefined> {
  const s = await sql();
  return s.one<UserRow>("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email]);
}

export async function orgMembers(orgId: string): Promise<UserRow[]> {
  const s = await sql();
  return s.query<UserRow>("SELECT * FROM users WHERE org_id = $1 ORDER BY created_at", [orgId]);
}

export async function seatsUsed(orgId: string): Promise<number> {
  const s = await sql();
  const row = await s.one<{ n: unknown }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE org_id = $1)
          + (SELECT COUNT(*) FROM invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > $2) AS n`,
    [orgId, now()]);
  return Number(row?.n ?? 0);
}

export async function seatLimit(orgId: string): Promise<number> {
  const s = await sql();
  const org = await s.one<{ tier: string }>("SELECT tier FROM orgs WHERE id = $1", [orgId]);
  return settingInt(`tier.${org?.tier ?? "personal"}.seats`);
}

/** Signing up creates the organisation and makes you its owner. */
export async function signUp(args: {
  email: string; name: string; password: string; orgName: string;
}): Promise<{ userId: string; orgId: string; token: string }> {
  if (await userByEmail(args.email)) throw new Error("that email already has an account");
  const s = await sql();
  const orgId = id("org"), userId = id("usr"), tier = "personal";
  await s.query("INSERT INTO orgs (id, name, tier, concurrency_limit, created_at) VALUES ($1,$2,$3,$4,$5)",
    [orgId, args.orgName || `${args.name}'s workspace`, tier, await settingInt(`tier.${tier}.concurrency`), now()]);
  await s.query(
    `INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
     VALUES ($1,$2,$3,$4,'owner',$5,$6)`,
    [userId, orgId, args.email, args.name, hashPassword(args.password), now()]);
  // The tier's monthly grant, which expires. Without this a new organisation
  // had no points at all, so every run came out of the platform's pocket and
  // the ledger stayed empty.
  await credit(orgId, "grant", await settingInt(`tier.${tier}.points_cents`), `${tier} monthly grant`,
    new Date(Date.now() + 30 * 86400_000).toISOString());
  // The first organisation to sign up curates the catalog; later ones do not.
  await claimPlatformOrg(orgId);
  return { userId, orgId, token: await createSession(userId) };
}

// ----------------------------------------------------------------- invites

export type InviteRow = {
  token: string; org_id: string; email: string; role: Role;
  invited_by: string; created_at: string; expires_at: string; accepted_at: string | null;
};

const INVITE_DAYS = 14;

export class SeatsExhaustedError extends DomainError {
  constructor(limit: number) {
    super(`no seats left on this tier (${limit}); upgrade or remove a member`, 409, "SeatsExhaustedError");
  }
}

export async function invite(args: {
  orgId: string; email: string; role: Role; invitedBy: string;
}): Promise<InviteRow> {
  if (await userByEmail(args.email)) throw new Error("that email already has an account");
  const limit = await seatLimit(args.orgId);
  if ((await seatsUsed(args.orgId)) >= limit) throw new SeatsExhaustedError(limit);
  const s = await sql();
  const token = newToken();
  await s.query(
    `INSERT INTO invites (token, org_id, email, role, invited_by, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [token, args.orgId, args.email, args.role, args.invitedBy, now(),
      new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString()]);
  return (await inviteByToken(token))!;
}

export async function inviteByToken(token: string): Promise<InviteRow | undefined> {
  const s = await sql();
  return s.one<InviteRow>(
    "SELECT * FROM invites WHERE token = $1 AND accepted_at IS NULL AND expires_at > $2", [token, now()]);
}

export async function openInvites(orgId: string): Promise<InviteRow[]> {
  const s = await sql();
  return s.query<InviteRow>(
    "SELECT * FROM invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > $2 ORDER BY created_at",
    [orgId, now()]);
}

export async function acceptInvite(token: string, name: string, password: string): Promise<string> {
  const inv = await inviteByToken(token);
  if (!inv) throw new Error("that invitation is not valid any more");
  const s = await sql();
  const userId = id("usr");
  await s.query(
    `INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, inv.org_id, inv.email, name, inv.role, hashPassword(password), now()]);
  await s.query("UPDATE invites SET accepted_at = $1 WHERE token = $2", [now(), token]);
  return createSession(userId);
}

export async function revokeInvite(orgId: string, token: string): Promise<void> {
  const s = await sql();
  await s.query("DELETE FROM invites WHERE org_id = $1 AND token = $2", [orgId, token]);
}

/** An organisation must never be left without an owner. */
export async function setRole(orgId: string, userId: string, role: Role): Promise<void> {
  const s = await sql();
  if (role === "member") {
    const owners = await s.query("SELECT id FROM users WHERE org_id = $1 AND role = 'owner'", [orgId]);
    if (owners.length <= 1 && owners.some((o) => (o as { id: string }).id === userId)) {
      throw new Error("an organisation needs at least one owner");
    }
  }
  await s.query("UPDATE users SET role = $1 WHERE org_id = $2 AND id = $3", [role, orgId, userId]);
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const s = await sql();
  const owners = await s.query("SELECT id FROM users WHERE org_id = $1 AND role = 'owner'", [orgId]);
  if (owners.length <= 1 && owners.some((o) => (o as { id: string }).id === userId)) {
    throw new Error("an organisation needs at least one owner");
  }
  await s.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  await s.query("DELETE FROM users WHERE org_id = $1 AND id = $2", [orgId, userId]);
}

// ------------------------------------------------------------- api tokens

export type ApiTokenRow = {
  token: string; org_id: string; user_id: string; name: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
};

/** Returned once, in full. Only the row remains afterwards. */
export async function createApiToken(orgId: string, userId: string, name: string): Promise<string> {
  const s = await sql();
  const token = `mk_${newToken()}`;
  await s.query(
    "INSERT INTO api_tokens (token, org_id, user_id, name, created_at) VALUES ($1,$2,$3,$4,$5)",
    [token, orgId, userId, name || "unnamed", now()]);
  return token;
}

export async function apiTokens(orgId: string): Promise<ApiTokenRow[]> {
  const s = await sql();
  return s.query<ApiTokenRow>(
    "SELECT * FROM api_tokens WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC", [orgId]);
}

export async function revokeApiToken(orgId: string, token: string): Promise<void> {
  const s = await sql();
  await s.query("UPDATE api_tokens SET revoked_at = $1 WHERE org_id = $2 AND token = $3", [now(), orgId, token]);
}

/**
 * Resolve a bearer token to a session, and note that it was used.
 *
 * A token acts with the role of whoever created it, so it can do no more than
 * that person could in the browser.
 */
export async function sessionFromApiToken(bearer: string | undefined): Promise<Session | null> {
  if (!bearer) return null;
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const s = await sql();
  const row = await s.one<ApiTokenRow>(
    "SELECT * FROM api_tokens WHERE token = $1 AND revoked_at IS NULL", [token]);
  if (!row) return null;
  const user = await s.one<UserRow>("SELECT * FROM users WHERE id = $1", [row.user_id]);
  if (!user) return null;
  await s.query("UPDATE api_tokens SET last_used_at = $1 WHERE token = $2", [now(), token]);
  return { user, orgId: row.org_id, role: user.role };
}

/** Kept for callers that only need the organisation. */
export async function orgFromApiToken(bearer: string | undefined): Promise<{ orgId: string; userId: string } | null> {
  const session = await sessionFromApiToken(bearer);
  return session ? { orgId: session.orgId, userId: session.user.id } : null;
}
