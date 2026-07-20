// POST /api/verify   (public — used by the standalone /verify ID-check page)
// A minimal, ID-verification-only intake: just a name + a completed Stripe
// Identity session. Retrieves the result server-side (name-bound), and stores a
// row in vetting_submissions so it shows up in the dashboard like any applicant.
// No driving/insurance data and no AI photo assessment — just the ID check.

import { randomUUID } from "node:crypto";
import { getAdminClient } from "../lib/db.js";
import { fetchStripeVerification, stripeEnabled, buildIdOnlyAssessment } from "../lib/verification.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid body" });

  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  if (!firstName || !lastName) return res.status(400).json({ error: "Please enter your first and last name." });
  const applicantName = `${firstName} ${lastName}`.trim();

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { return res.status(500).json({ error: "Server not configured", detail: e.message }); }

  // Retrieve the Stripe result and bind it to this person's name.
  const verification = {};
  if (body.stripeVerificationSessionId && stripeEnabled()) {
    verification.stripe = await fetchStripeVerification(String(body.stripeVerificationSessionId).slice(0, 128), applicantName);
  }
  const stx = verification.stripe || {};
  // A light, AI-shaped summary so the dashboard renders a verdict + pros/cons
  // for these ID-only entries (no real AI photo assessment is run here). The
  // dashboard re-checks "processing" rows and rebuilds this same shape once
  // Stripe finishes, so a pending check that passes flips to "approve" itself.
  const { recommendation, ai, verified } = buildIdOnlyAssessment(applicantName, stx);

  const row = {
    id: randomUUID(),
    applicant_name: applicantName,
    email: String(body.email || "").trim() || null,
    rule_total: 0,
    ai_score: ai.ai_score,
    recommendation,
    data: { firstName, lastName, source: "id-verification-link" },
    scores: {},
    ai,
    photos: {},
    verification: Object.keys(verification).length ? verification : null,
  };

  const { error: insertErr } = await supabase.from("vetting_submissions").insert(row);
  if (insertErr) {
    console.error("verify insert failed:", insertErr.message);
    return res.status(500).json({ error: "Could not save — please try again." });
  }
  return res.status(200).json({ ok: true, verified });
}
