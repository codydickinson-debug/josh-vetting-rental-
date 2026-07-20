// POST /api/verify   (public — used by the standalone /verify ID-check page)
// A minimal, ID-verification-only intake: just a name + a completed Stripe
// Identity session. Retrieves the result server-side (name-bound), and stores a
// row in vetting_submissions so it shows up in the dashboard like any applicant.
// No driving/insurance data and no AI photo assessment — just the ID check.

import { randomUUID } from "node:crypto";
import { getAdminClient } from "../lib/db.js";
import { fetchStripeVerification, stripeEnabled } from "../lib/verification.js";

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
  const verified = stx.verified === true;
  const processing = stx.status === "processing";
  const recommendation = verified ? "approve" : "review";

  // A light, AI-shaped summary so the dashboard renders a verdict + pros/cons
  // for these ID-only entries (no real AI photo assessment is run here).
  const ai = {
    recommendation,
    confidence: verified ? "high" : "medium",
    summary: verified
      ? `${applicantName} passed the Stripe ID check, and the name on the ID matches.`
      : processing
        ? `${applicantName} finished the ID check — Stripe is still processing the result. Check back shortly.`
        : `${applicantName}'s ID check did not fully pass. Take a closer look before renting.`,
    strengths: verified ? ["Passed the Stripe ID check.", "The name on the ID matches this person."] : [],
    concerns: verified
      ? []
      : [processing ? "The ID check is still processing." : "The ID check did not pass, or the name did not match — check before renting."],
    identity_check: {}, document_authenticity: {}, insurance_check: {},
    credibility_flags: [], document_notes: "",
    ai_score: verified ? 5 : 50,
  };

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
