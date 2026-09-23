// GET /api/verify-image?session=vs_...&which=document|document2|selfie
// (password-gated) — streams a renter's ID/selfie image from Stripe so the
// operator can view the license right in the dashboard, without opening Stripe.
//
// The file id is resolved server-side from the session's verification report, so
// the client can never request an arbitrary file. Requires the STRIPE_SECRET_KEY
// to also have "Files Read" permission (a 502 here usually means it doesn't yet).

import { resolveStripeImageFile, fetchStripeFile, stripeEnabled } from "../lib/verification.js";

const WHICH = new Set(["document", "document2", "selfie"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return res.status(500).json({ error: "DASHBOARD_PASSWORD not configured" });
  if (req.headers["x-dashboard-key"] !== expected) return res.status(401).json({ error: "Unauthorized" });
  if (!stripeEnabled()) return res.status(503).json({ error: "Stripe not configured" });

  const session = String((req.query && req.query.session) || "").slice(0, 128);
  const which = String((req.query && req.query.which) || "document");
  if (!session.startsWith("vs_")) return res.status(400).json({ error: "Invalid session" });
  if (!WHICH.has(which)) return res.status(400).json({ error: "Invalid image" });

  try {
    const fileId = await resolveStripeImageFile(session, which);
    if (!fileId) return res.status(404).json({ error: "No image for this session" });
    const { buffer, contentType } = await fetchStripeFile(fileId);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).send(buffer);
  } catch (e) {
    console.error("verify-image failed:", e?.message || e);
    return res.status(502).json({ error: "Could not load image" });
  }
}
