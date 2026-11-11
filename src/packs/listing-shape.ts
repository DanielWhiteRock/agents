/**
 * The shape of a listing, and nothing else.
 *
 * A leaf module on purpose: it imports nothing, so every layer that has to
 * agree about what a listing *is* can agree here rather than each keeping its
 * own copy. Three of them do, and they cannot all reach one another —
 * `src/app/listing.ts` imports `authoring.ts` for the authority pattern, so
 * `authoring.ts` importing `listing.ts` back would close a cycle whose first
 * edge is a `class extends` evaluated at module load: a runtime failure, not
 * a typecheck one. `messages.ts` had grown its own third copy of the FAQ
 * parser for the same reason.
 *
 * So the parsers, the shape coercion and the FAQ merge live here, where
 * `listing.ts`, `authoring.ts` and `messages.ts` can all have them.
 */

export type FaqEntry = { q: string; a: string };
export type Scenario = { brief: string; reached: string[]; output: string };

export type Listing = {
  description: string;
  useCases: string[];
  limitations: string[];
  faq: FaqEntry[];
  scenarios: Scenario[];
  requirements: string[];
};

/** The six stored columns, shared by `packs` and `pack_listing_drafts`. */
export type ListingColumns = {
  description: string; use_cases: string; limitations: string;
  faq: string; scenarios: string; requirements: string;
};

/**
 * A column is stored as JSON, except it starts life as `''` rather than
 * `'[]'` — deliberate, so nothing has to be written before an author touches
 * it. `''` means empty, same as genuinely malformed JSON: either way, there
 * is nothing usable to show, so both fall through to the empty array.
 */
export function parseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A list column as the page needs it: strings with something in them. */
export const strings = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map(text).filter(Boolean);

/**
 * Shape, not just type.
 *
 * `Array.isArray` was the whole check, and the page renders `s.reached.length`
 * and `f.q` straight off the element — so one stored scenario missing a field
 * took the entire pack page down with a 500 rather than dropping a card. The
 * columns hold whatever was written to them (a hand-fixed row, an older
 * writer, a generator), so the shape is settled here, once, on the way in.
 *
 * An entry with no heading — a scenario with no brief, a question with no
 * question — has nothing to render, so it is dropped rather than rendered as
 * an empty card.
 */
export function toFaq(raw: unknown[]): FaqEntry[] {
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ q: text(e["q"]), a: text(e["a"]) }))
    .filter((e) => e.q.length > 0);
}

export function toScenarios(raw: unknown[]): Scenario[] {
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ brief: text(e["brief"]), reached: strings(e["reached"]), output: text(e["output"]) }))
    .filter((e) => e.brief.length > 0);
}

/** One stored column as the list it holds, tolerating `''` and malformed JSON. */
export const stringsFromJson = (raw: string | null | undefined): string[] => strings(parseArray(raw));
export const faqFromJson = (raw: string | null | undefined): FaqEntry[] => toFaq(parseArray(raw));
export const scenariosFromJson = (raw: string | null | undefined): Scenario[] => toScenarios(parseArray(raw));

/**
 * Six fields of unknown provenance as one listing.
 *
 * The one place the shape is decided, so a column read back off `packs` and a
 * block of JSON a generator produced cannot disagree about what a scenario
 * is — `scripts/generate-listings.mjs` normalises through here too.
 */
export function listingFromParts(parts: {
  description?: unknown; useCases?: unknown; limitations?: unknown;
  faq?: unknown; scenarios?: unknown; requirements?: unknown;
}): Listing {
  return {
    description: text(parts.description),
    useCases: strings(parts.useCases),
    limitations: strings(parts.limitations),
    faq: toFaq(Array.isArray(parts.faq) ? parts.faq : []),
    scenarios: toScenarios(Array.isArray(parts.scenarios) ? parts.scenarios : []),
    requirements: strings(parts.requirements),
  };
}

/** The six columns off a `packs` or `pack_listing_drafts` row, as a listing. */
export function listingFromColumns(row: ListingColumns): Listing {
  return listingFromParts({
    description: row.description,
    useCases: parseArray(row.use_cases),
    limitations: parseArray(row.limitations),
    faq: parseArray(row.faq),
    scenarios: parseArray(row.scenarios),
    requirements: parseArray(row.requirements),
  });
}

/**
 * Two FAQs as one, the human-written entries first and winning.
 *
 * A question is the identity — asked twice, in whatever casing, it is one
 * entry — and the answer kept is the one from `live`, because that is the one
 * a creator wrote to a buyer who actually asked.
 */
export function mergeFaq(live: FaqEntry[], proposed: FaqEntry[]): FaqEntry[] {
  const seen = new Set(live.map((f) => f.q.trim().toLowerCase()));
  const out = [...live];
  for (const entry of proposed) {
    const key = entry.q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ q: entry.q.trim(), a: entry.a.trim() });
  }
  return out;
}

// --------------------------------------------------------------- the form
//
// A generated draft has to be editable before it is approved. The spec says
// twice that the author "edits freely, and approves", and chose per-pack
// approval *because* the author edits — without an editor, approval is
// approve-verbatim or nothing, and the human gate against "a page that
// out-promises the pack" offers only: publish the wrong sentence, publish
// nothing, or pay for another model call.
//
// So the approval screen renders the proposed listing as text a person can
// change, and this is the codec between that text and the stored shape. It
// lives here because both sides need it and neither may import the other:
// `views.ts` is a pure render module (it must not pull the runtime into its
// graph) and `server.ts` parses the posted form.
//
// The two list-of-objects fields need a representation a person can type.
// Blocks separated by a line of `---`, each line labelled, and a label's
// value running to the end of the block so an answer or an output can have
// paragraphs in it. Unlabelled leading text is the first field, so a
// one-line question with no `Q:` still parses rather than vanishing.

export type ListingForm = {
  description: string; useCases: string; limitations: string;
  requirements: string; faq: string; scenarios: string;
};

const BLOCK_SEPARATOR = /^\s*---+\s*$/;

const lines = (raw: string): string[] =>
  raw.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);

/** Split a textarea into blocks on a `---` line, dropping the empty ones. */
function blocks(raw: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (BLOCK_SEPARATOR.test(line)) {
      out.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  out.push(current);
  return out.filter((b) => b.some((l) => l.trim()));
}

/**
 * One block as its labelled fields. `labels` maps a label, lowercased and
 * without its colon, to the field it fills; the first entry is also where
 * unlabelled leading text goes.
 */
function labelled(block: string[], labels: Record<string, string>, first: string): Record<string, string> {
  const out: Record<string, string> = {};
  let field = first;
  for (const line of block) {
    const m = /^\s*([A-Za-z ]{1,16}):\s?(.*)$/.exec(line);
    const key = m ? labels[m[1]!.trim().toLowerCase()] : undefined;
    if (m && key) {
      field = key;
      out[field] = m[2]!;
    } else {
      out[field] = out[field] === undefined ? line : `${out[field]}\n${line}`;
    }
  }
  for (const [k, v] of Object.entries(out)) out[k] = v.trim();
  return out;
}

const FAQ_LABELS = { q: "q", question: "q", a: "a", answer: "a" };
const SCENARIO_LABELS = {
  brief: "brief", reached: "reached", "reached for": "reached", output: "output",
};

/** What a person typed, as the listing it describes. */
export function listingFromForm(f: Partial<Record<keyof ListingForm, string>>): Listing {
  return listingFromParts({
    description: (f.description ?? "").replace(/\r\n/g, "\n").trim(),
    useCases: lines(f.useCases ?? ""),
    limitations: lines(f.limitations ?? ""),
    requirements: lines(f.requirements ?? ""),
    faq: blocks(f.faq ?? "").map((b) => labelled(b, FAQ_LABELS, "q")),
    scenarios: blocks(f.scenarios ?? "").map((b) => {
      const parts = labelled(b, SCENARIO_LABELS, "brief");
      return {
        brief: parts["brief"] ?? "",
        reached: (parts["reached"] ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
        output: parts["output"] ?? "",
      };
    }),
  });
}

/** The same listing as the text the form shows, so a save round-trips. */
export function listingToForm(l: Listing): ListingForm {
  return {
    description: l.description,
    useCases: l.useCases.join("\n"),
    limitations: l.limitations.join("\n"),
    requirements: l.requirements.join("\n"),
    faq: l.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n---\n"),
    scenarios: l.scenarios.map((sc) =>
      `Brief: ${sc.brief}\nReached: ${sc.reached.join(", ")}\nOutput: ${sc.output}`).join("\n---\n"),
  };
}
