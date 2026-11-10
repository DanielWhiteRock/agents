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

export function statusOf(e: unknown): number | null {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" && s >= 400 && s < 600 ? s : null;
}
