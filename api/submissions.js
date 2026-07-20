// GET /api/submissions   (password-gated — for Josh's dashboard)
// Header: x-dashboard-key: <DASHBOARD_PASSWORD>
// Returns all submissions newest-first, with short-lived signed URLs for the photos.

import { getAdminClient, PHOTO_BUCKET, friendlyDbError } from "../lib/db.js";
import { stripeEnabled, fetchStripeVerification, buildIdOnlyAssessment } from "../lib/verification.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return res.status(500).json({ error: "DASHBOARD_PASSWORD not configured" });
  const provided = req.headers["x-dashboard-key"];
  if (!provided || provided !== expected) return res.status(401).json({ error: "Unauthorized" });

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { return res.status(500).json({ error: "Server not configured", detail: e.message }); }

  const { data, error } = await supabase
    .from("vetting_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: friendlyDbError(error.message) });

  // Re-check any Stripe Identity sessions still "processing". Stripe verifies
  // asynchronously, so a row created the instant the renter finished usually
  // snapshots "processing" — and with no webhook it would otherwise stay stuck
  // on "Maybe" forever, even after the ID actually passes. Refresh those against
  // Stripe live and persist the result, so a pass flips to "Good" on its own
  // (the dashboard polls, so this self-heals within a poll or two). Capped so a
  // large backlog of pending checks can't stall the dashboard load.
  if (stripeEnabled()) {
    const pending = data
      .filter((r) => r && r.verification && r.verification.stripe && r.verification.stripe.status === "processing")
      .slice(0, 20);
    await Promise.all(pending.map(async (row) => {
      try {
        const sessionId = String((row.verification.stripe.sessionId) || "").slice(0, 128);
        if (!sessionId) return;
        const fresh = await fetchStripeVerification(sessionId, row.applicant_name || "");
        // Still pending or the lookup failed — leave the row untouched for next poll.
        if (!fresh || fresh.error || !fresh.status || fresh.status === "processing") return;
        const verification = { ...(row.verification || {}), stripe: fresh };
        const update = { verification };
        // Only /verify (ID-only) rows carry the light ID-shaped assessment; a full
        // application's `ai` is a real Claude assessment and must NOT be clobbered
        // (its "Outside checks" still gets the refreshed Stripe status above).
        if (row.data && row.data.source === "id-verification-link") {
          const built = buildIdOnlyAssessment(row.applicant_name || "", fresh);
          update.recommendation = built.recommendation;
          update.ai = built.ai;
          update.ai_score = built.ai.ai_score;
          row.recommendation = built.recommendation;
          row.ai = built.ai;
          row.ai_score = built.ai.ai_score;
        }
        row.verification = verification;
        await supabase.from("vetting_submissions").update(update).eq("id", row.id);
      } catch (e) { /* best-effort — a re-check must never fail the dashboard load */ }
    }));
  }

  // sign photo URLs (1 hour) — one batch call for every path; the dashboard
  // polls this endpoint, so per-photo round-trips would compound quickly.
  const PHOTO_KEYS = ["front", "back", "selfie", "insurance"];
  const allPaths = [];
  for (const row of data) {
    const photos = row.photos || {};
    for (const key of PHOTO_KEYS) if (photos[key]) allPaths.push(photos[key]);
  }
  const signedByPath = {};
  if (allPaths.length) {
    const { data: signedList } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(allPaths, 3600);
    for (const s of signedList || []) if (s && s.path && s.signedUrl) signedByPath[s.path] = s.signedUrl;
  }
  for (const row of data) {
    const photos = row.photos || {};
    row.photo_urls = {};
    for (const key of PHOTO_KEYS) row.photo_urls[key] = photos[key] ? signedByPath[photos[key]] || null : null;
    // Plaid access tokens stay server-side only — never ship them to the browser.
    if (row.verification && row.verification.plaid) delete row.verification.plaid.access_token;
  }

  return res.status(200).json({ submissions: data });
}
