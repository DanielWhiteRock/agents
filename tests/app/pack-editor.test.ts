import { describe, it, expect } from "vitest";
import { packEditorPage } from "../../src/app/views.js";
import type { PackRow } from "../../src/app/platform.js";

/**
 * The role select, rendered.
 *
 * The route's half of this — reading the `roles` table, storing what came
 * back — is covered end to end in `tests/node/pack-role-routes.test.mjs`.
 * What only a pure render test can pin down is the markup itself: which
 * option carries `selected`, which is the one thing that decides what the
 * browser submits for a pack nobody is deliberately re-filing.
 */
const ROLES = [
  { id: "engineer", name: "Engineer" },
  { id: "reviewer", name: "Reviewer" },
  { id: "writer", name: "Writer" },
];

const pack = (over: Partial<PackRow> = {}): PackRow => ({
  id: "pk_1", slug: "guardrails", name: "Guardrails Reviewer",
  tagline: "Reads another agent's work before you act on it", author: "alphaCEO",
  author_org_id: "org_1", price_points: 0, tags: "quality", image: null,
  role: "", upgrade_points: 0, model: "claude-opus-5", effort: "high",
  pinned_models: "[]", instructions: "Review it.", status: "draft",
  author_payout_email: null, extras: "{}", created_at: "2026-01-02T03:04:05.000Z",
  description: "", use_cases: "", limitations: "", faq: "", scenarios: "", requirements: "",
  listing_approved_at: null, listing_stale_at: null, listed_at: null, built_on: null,
  creator_id: null, featured_rank: null,
  ...over,
});

const render = (over: Partial<PackRow> | null, roles = ROLES): string => packEditorPage({
  pack: over === null ? null : pack(over),
  roles, models: ["claude-opus-5"], balance: 0,
  viewer: { name: "A", email: "a@example.com", role: "owner", orgName: "Co" }, isCurator: false,
});

describe("the role select", () => {
  it("offers every role it was handed, and nothing it was not", () => {
    const h = render({});
    expect(h).toContain('<select name="role">');
    expect(h).toContain('<option value="engineer">Engineer</option>');
    expect(h).toContain('<option value="reviewer">Reviewer</option>');
    expect(h).not.toContain('value="growth"');
  });

  it("selects no role for a pack that has none, so saving cannot invent one", () => {
    expect(render({ role: "" })).toContain('<option value="" selected>(no role)</option>');
  });

  it("offers no role even for a pack that has one, because untagging has to be possible", () => {
    // Four packs on the catalog are deliberately in no role: their work fits
    // nothing the surviving taxonomy describes. A select that cannot say that
    // makes the honest state unreachable.
    const h = render({ role: "reviewer" });
    expect(h).toContain('<option value="">(no role)</option>');
    expect(h).toContain('<option value="reviewer" selected>Reviewer</option>');
  });

  it("keeps a role the table no longer offers, labelled, rather than dropping it", () => {
    // Dropping it would leave the first option selected by default, so
    // opening the editor and pressing Save would re-file the pack under a job
    // nobody chose.
    const h = render({ role: "support" });
    expect(h).toContain('<option value="support" selected>support — no longer listed</option>');
    expect(h).not.toContain('<option value="engineer" selected>');
  });

  it("is on the new-pack form too, so a role never needs a second save", () => {
    const h = render(null);
    expect(h).toContain('<select name="role">');
    expect(h).toContain('<option value="" selected>(no role)</option>');
  });
});
