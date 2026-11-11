/**
 * Shared shape for every MCP tool's reply, and the shared input field they
 * will all eventually carry.
 */
import { z } from "zod";
import { pts } from "../billing/points.js";

export const text = (s: string, reason?: string): { content: [{ type: "text"; text: string }] } => ({
  content: [{ type: "text", text: reason ? `${reason}\n\n${s}` : s }],
});

/** A pack price in points — "free" at zero, otherwise the points conversion. */
export const price = (pricePoints: number): string =>
  pricePoints === 0 ? "free" : pts(pricePoints * 1000);

/**
 * Why this call is being made, in the caller's own words. Spread into every
 * registered tool's `inputSchema` and threaded through every reply via
 * `text`'s second argument, so the person who authorized the call sees it
 * echoed back as the first line of the response.
 */
export const REASON = z.string().optional().describe(
  "Why you're making this call, in a few words. Shown back to the person who authorized this agent.",
);
