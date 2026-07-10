// POST /api/stripe-verification-session   (public — used by the renter form)
// Creates a short-lived Stripe Identity VerificationSession and returns the
// client_secret (drives the in-browser modal) + id (echoed back at submit so the
// server can retrieve the authoritative result). Returns 503 when Stripe keys
// aren't configured.
//
// Abuse guards (this endpoint spends Stripe quota): browser requests must be
// same-origin, and a per-instance rate limit caps scripted creation. Fluid
// Compute reuses instances, so the in-memory limiter has real effect.

import { stripeEnabled, createStripeVerificationSession } from "../lib/verification.js";

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
  if (!stripeEnabled()) return res.status(503).json({ error: "ID verification is not configured." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) { windowStart = now; windowCount = 0; }
  if (++windowCount > MAX_PER_WINDOW) return res.status(429).json({ error: "Too many requests — try again in a minute." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = body && typeof body.email === "string" ? body.email.slice(0, 200) : "";

  try {
    const out = await createStripeVerificationSession(email || undefined);
    return res.status(200).json({ client_secret: out.client_secret, id: out.id });
  } catch (e) {
    console.error("stripe verification session failed:", e?.message || e);
    return res.status(500).json({ error: "Could not start ID verification — please upload your photos instead." });
  }
}
