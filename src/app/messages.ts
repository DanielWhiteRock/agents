/**
 * Ask the creator: a private line between one buyer organisation and one
 * creator, scoped either to a pack or to the creator's profile in general.
 *
 * Privacy is the point, not a detail. A thread has exactly two parties — the
 * organisation that opened it (`threads.org_id`) and the creator it was
 * opened with (`threads.creator_id`, resolved to that creator's own
 * `org_id`) — and nothing here ever hands a third organisation the thread,
 * its messages, or even the fact that it exists. `reply` checks membership
 * itself rather than trusting a caller that already checked, the same way
 * `openThread` enforces its own daily limit rather than leaving it to the
 * route: every future caller — the route today, an MCP surface tomorrow —
 * inherits both for free.
 *
 * The payoff is `publishToFaq`: a creator can take one exchange that
 * actually happened and quote it onto the pack's FAQ, in the exact shape
 * `listing.ts` already reads — `{ q, a }` appended to `packs.faq` — with the
 * asking organisation named nowhere in the result. The question is quoted as
 * asked and the answer as written; who asked it is not part of what gets
 * published.
 */
import { id, now } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";
import { faqFromJson } from "../packs/listing-shape.js";

/** Thrown by `openThread` and `reply` for a body or subject with nothing in it, or a reference to a creator or pack that does not exist or does not line up. */
export class MessagesInputError extends DomainError {
  constructor(message: string) { super(message, 400, "MessagesInputError"); }
}

/** No more than this many threads per organisation, per rolling day — enforced in `openThread` so every caller inherits it. */
export const MAX_THREADS_PER_DAY = 10;

export class ThreadLimitError extends DomainError {
  constructor() {
    super(`no more than ${MAX_THREADS_PER_DAY} threads may be opened in one day`, 400, "ThreadLimitError");
  }
}

/**
 * Thrown by `reply` and `publishToFaq` for a thread that either does not
 * exist or does not belong to the caller — deliberately the same error for
 * both, since telling a third organisation "that thread exists, but is not
 * yours" is itself a leak. A 404, not a 403: nothing to refuse, nothing found.
 */
export class ThreadNotFoundError extends DomainError {
  constructor() { super("no such thread", 404, "ThreadNotFoundError"); }
}

export type ThreadRow = {
  id: string;
  pack_id: string | null;
  creator_id: string;
  org_id: string;
  subject: string;
  created_at: string;
  last_at: string;
};

export type ThreadMessageRow = {
  id: string;
  thread_id: string;
  org_id: string;
  user_id: string;
  body: string;
  published_at: string | null;
  created_at: string;
};

type PackRef = { slug: string; name: string } | null;

/** A thread as the creator's own inbox shows it: who is asking, and about what. */
export type InboxThread = ThreadRow & {
  messages: ThreadMessageRow[];
  pack: PackRef;
  askerOrgName: string;
};

/** A thread as the asking organisation's own "my questions" list shows it. */
export type MyThread = ThreadRow & {
  messages: ThreadMessageRow[];
  pack: PackRef;
  creatorHandle: string;
  creatorName: string;
};

async function threadById(threadId: string): Promise<ThreadRow | undefined> {
  const s = await sql();
  return s.one<ThreadRow>("SELECT * FROM threads WHERE id = $1", [threadId]);
}

async function creatorOrgIdOf(creatorId: string): Promise<string | null> {
  const s = await sql();
  const row = await s.one<{ org_id: string }>("SELECT org_id FROM creators WHERE id = $1", [creatorId]);
  return row?.org_id ?? null;
}

async function messagesOf(threadId: string): Promise<ThreadMessageRow[]> {
  const s = await sql();
  return s.query<ThreadMessageRow>(
    "SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY created_at ASC, id ASC",
    [threadId],
  );
}

export type OpenThreadInput = {
  orgId: string;
  userId: string;
  creatorId: string;
  /** Null for a thread opened from a creator's profile rather than one of their packs. */
  packId?: string | null;
  subject: string;
  body: string;
};

/**
 * Open a thread and post its first message in one call — a thread with no
 * question in it is not a useful state to leave lying around.
 *
 * Enforces `MAX_THREADS_PER_DAY` per organisation, counted on a rolling
 * 24-hour window rather than a calendar day (so it cannot be reset by
 * waiting for midnight), before either row is written.
 */
export async function openThread(args: OpenThreadInput): Promise<ThreadRow> {
  const subject = args.subject.trim();
  const body = args.body.trim();
  if (!subject) throw new MessagesInputError("a question needs a subject");
  if (!body) throw new MessagesInputError("a question needs a body");

  const s = await sql();
  const creator = await s.one<{ id: string }>("SELECT id FROM creators WHERE id = $1", [args.creatorId]);
  if (!creator) throw new MessagesInputError("no such creator");

  let packId: string | null = null;
  if (args.packId) {
    const pack = await s.one<{ id: string; creator_id: string | null }>(
      "SELECT id, creator_id FROM packs WHERE id = $1", [args.packId]);
    if (!pack) throw new MessagesInputError("no such pack");
    if (pack.creator_id !== args.creatorId) throw new MessagesInputError("that pack is not this creator's");
    packId = pack.id;
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const count = await s.one<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM threads WHERE org_id = $1 AND created_at >= $2",
    [args.orgId, cutoff],
  );
  if (Number(count?.n ?? 0) >= MAX_THREADS_PER_DAY) throw new ThreadLimitError();

  const t = now();
  const threadId = id("thr");
  await s.query(
    `INSERT INTO threads (id, pack_id, creator_id, org_id, subject, created_at, last_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [threadId, packId, args.creatorId, args.orgId, subject, t],
  );
  await s.query(
    `INSERT INTO thread_messages (id, thread_id, org_id, user_id, body, published_at, created_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
    [id("msg"), threadId, args.orgId, args.userId, body, t],
  );

  return (await threadById(threadId))!;
}

export type ReplyInput = { threadId: string; orgId: string; userId: string; body: string };

/**
 * Add a message to an existing thread, from whichever side `orgId` is.
 * Checks membership itself — the asking organisation's own `org_id`, or the
 * creator's — rather than trusting a caller that already checked, so an
 * organisation with no part in a thread gets exactly the same
 * `ThreadNotFoundError` it would get for a thread ID that never existed.
 */
export async function reply(args: ReplyInput): Promise<void> {
  const body = args.body.trim();
  if (!body) throw new MessagesInputError("a reply needs a body");

  const thread = await threadById(args.threadId);
  if (!thread) throw new ThreadNotFoundError();
  const creatorOrgId = await creatorOrgIdOf(thread.creator_id);
  if (args.orgId !== thread.org_id && args.orgId !== creatorOrgId) throw new ThreadNotFoundError();

  const s = await sql();
  const t = now();
  await s.query(
    `INSERT INTO thread_messages (id, thread_id, org_id, user_id, body, published_at, created_at)
     VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
    [id("msg"), args.threadId, args.orgId, args.userId, body, t],
  );
  await s.query("UPDATE threads SET last_at = $1 WHERE id = $2", [t, args.threadId]);
}

/** The creator's own inbox: every thread asked of them, newest activity first. */
export async function threadsFor(creatorId: string): Promise<InboxThread[]> {
  const s = await sql();
  const rows = await s.query<ThreadRow & { pack_slug: string | null; pack_name: string | null; asker_name: string }>(
    `SELECT t.*, p.slug AS pack_slug, p.name AS pack_name, o.name AS asker_name
       FROM threads t
       JOIN orgs o ON o.id = t.org_id
       LEFT JOIN packs p ON p.id = t.pack_id
      WHERE t.creator_id = $1
      ORDER BY t.last_at DESC`,
    [creatorId],
  );
  return Promise.all(rows.map(async (r) => ({
    id: r.id, pack_id: r.pack_id, creator_id: r.creator_id, org_id: r.org_id,
    subject: r.subject, created_at: r.created_at, last_at: r.last_at,
    pack: r.pack_slug && r.pack_name ? { slug: r.pack_slug, name: r.pack_name } : null,
    askerOrgName: r.asker_name,
    messages: await messagesOf(r.id),
  })));
}

/** An organisation's own "questions you've asked", across every creator. */
export async function threadsForOrg(orgId: string): Promise<MyThread[]> {
  const s = await sql();
  const rows = await s.query<
    ThreadRow & { pack_slug: string | null; pack_name: string | null; handle: string; display_name: string }
  >(
    `SELECT t.*, p.slug AS pack_slug, p.name AS pack_name, c.handle, c.display_name
       FROM threads t
       JOIN creators c ON c.id = t.creator_id
       LEFT JOIN packs p ON p.id = t.pack_id
      WHERE t.org_id = $1
      ORDER BY t.last_at DESC`,
    [orgId],
  );
  return Promise.all(rows.map(async (r) => ({
    id: r.id, pack_id: r.pack_id, creator_id: r.creator_id, org_id: r.org_id,
    subject: r.subject, created_at: r.created_at, last_at: r.last_at,
    pack: r.pack_slug && r.pack_name ? { slug: r.pack_slug, name: r.pack_name } : null,
    creatorHandle: r.handle, creatorName: r.display_name,
    messages: await messagesOf(r.id),
  })));
}

/**
 * Quote one question-and-answer pair from a thread onto its pack's FAQ, in
 * the exact `{ q, a }` shape `listingOf` already reads off `packs.faq`.
 *
 * `creatorId` must own the thread — the same membership check `reply` makes
 * — and the thread must be scoped to a pack: a thread opened from a
 * creator's profile has no FAQ to append to. `questionId` must be a message
 * from the asking organisation and `answerId` a message from the creator's
 * own organisation, so a creator cannot quote themselves as the question or
 * publish words the asker never wrote as their own.
 *
 * The asking organisation's name — `threads.org_id`, `askerOrgName` on the
 * inbox listing — is never read here and never written to `packs.faq`.
 * Quoting the question and the answer as written carries no other trace of
 * who asked it.
 */
export async function publishToFaq(
  creatorId: string, threadId: string, questionId: string, answerId: string,
): Promise<void> {
  const thread = await threadById(threadId);
  if (!thread || thread.creator_id !== creatorId) throw new ThreadNotFoundError();
  if (!thread.pack_id) throw new MessagesInputError("this thread has no pack to publish a FAQ entry to");

  const creatorOrgId = await creatorOrgIdOf(creatorId);
  const s = await sql();
  const question = await s.one<ThreadMessageRow>(
    "SELECT * FROM thread_messages WHERE id = $1 AND thread_id = $2", [questionId, threadId]);
  const answer = await s.one<ThreadMessageRow>(
    "SELECT * FROM thread_messages WHERE id = $1 AND thread_id = $2", [answerId, threadId]);
  if (!question || question.org_id !== thread.org_id) {
    throw new MessagesInputError("the question must be a message from the organisation that asked it");
  }
  if (!answer || answer.org_id !== creatorOrgId) {
    throw new MessagesInputError("the answer must be a message from the creator");
  }
  if (answer.published_at) throw new MessagesInputError("this answer has already been published");

  const pack = await s.one<{ faq: string }>("SELECT faq FROM packs WHERE id = $1", [thread.pack_id]);
  const faq = faqFromJson(pack?.faq);
  faq.push({ q: question.body, a: answer.body });
  const t = now();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify(faq), thread.pack_id]);
  await s.query("UPDATE thread_messages SET published_at = $1 WHERE id = $2", [t, answer.id]);
}
