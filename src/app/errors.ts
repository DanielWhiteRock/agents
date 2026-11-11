/**
 * Domain failures that are answers, not crashes.
 *
 * Each carries the status the HTTP layer should send, so "you do not own that
 * pack" renders as a refusal rather than as "Something broke" with a 500 — which
 * is what it did until a live export attempt showed it.
 */
export class DomainError extends Error {
  constructor(message: string, readonly status: number, name: string) {
    super(message);
    this.name = name;
  }
}

/**
 * `packs.faq` changed between a writer's read and its write, often enough to
 * exhaust that writer's retries.
 *
 * Here rather than beside any one of its throwers because it has three —
 * `updateFaq` and `approveDraft` in `listing.ts`, and `importPack`'s merge in
 * `authoring.ts` — and `authoring.ts` may not import `listing.ts`: the cycle's
 * first edge would be a `class extends` evaluated at module load, which breaks
 * at runtime rather than at typecheck. `listing.ts` re-exports it, so the
 * callers that already name `L.FaqContendedError` still can.
 */
export class FaqContendedError extends DomainError {
  constructor() {
    super("the FAQ was being written by somebody else at the same time — try that again",
      409, "FaqContendedError");
  }
}

/**
 * How many times a writer of `packs.faq` recomputes its value and tries the
 * conditional write again before giving up. Shared by every one of them, so
 * the number means the same thing wherever it is read.
 */
export const FAQ_WRITE_ATTEMPTS = 5;

export function statusOf(e: unknown): number | null {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" && s >= 400 && s < 600 ? s : null;
}
