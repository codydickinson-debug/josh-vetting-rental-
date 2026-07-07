// POST /api/plaid-link-token   (public — used by the renter form)
// Creates a short-lived Plaid Link token so the renter can open the bank-link
// flow. Returns 503 with a clear message when Plaid keys aren't configured.
//
// Abuse guards (this endpoint spends Plaid quota): browser requests must be
// same-origin, and a per-instance rate limit caps scripted minting. Fluid
// Compute reuses instances, so the in-memory limiter has real effect.

import { randomUUID } from "node:crypto";
import { plaidEnabled, createPlaidLinkToken } from "../lib/verification.js";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
let windowStart = 0;
let windowCount = 0;

function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // non-browser clients omit these; the rate limit still applies
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!plaidEnabled()) return res.status(503).json({ error: "Bank verification is not configured." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) { windowStart = now; windowCount = 0; }
  if (++windowCount > MAX_PER_WINDOW) return res.status(429).json({ error: "Too many requests — try again in a minute." });

  try {
    const out = await createPlaidLinkToken(randomUUID());
    return res.status(200).json({ link_token: out.link_token, expiration: out.expiration || null });
  } catch (e) {
    console.error("plaid link token failed:", e?.message || e);
    return res.status(500).json({ error: "Could not start bank verification — please skip this step." });
  }
}
