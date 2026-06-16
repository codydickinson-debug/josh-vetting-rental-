// POST /api/submit
// Receives the renter application (fields + 3 downscaled photos as data URLs),
// uploads photos to private Supabase Storage, computes the rule-based score,
// runs the Claude holistic assessment, and stores the row. Returns { ok: true }.
//
// The renter never sees a verdict — this endpoint just confirms receipt.

import { randomUUID } from "node:crypto";
import { getAdminClient, PHOTO_BUCKET } from "../lib/db.js";
import { normalize, assess } from "../lib/scoring.js";
import { runAIAssessment } from "../lib/ai.js";

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid body" });

  // --- minimal server-side validation (defense in depth; the form also validates) ---
  const required = ["firstName", "lastName", "dob", "phone", "email", "address", "licStatus"];
  for (const f of required) {
    if (!String(body[f] || "").trim()) return res.status(400).json({ error: `Missing field: ${f}` });
  }
  if (!body.consent) return res.status(400).json({ error: "Consent is required." });

  const profile = normalize(body);
  const ruleResult = assess(profile);

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { return res.status(500).json({ error: "Server not configured", detail: e.message }); }

  const id = randomUUID();

  // --- upload photos (best-effort; a failed photo doesn't lose the submission) ---
  const photos = { front: null, back: null, selfie: null, insurance: null };
  const photoDataUrls = body.photos || {};
  for (const key of ["front", "back", "selfie", "insurance"]) {
    const parsed = dataUrlToBuffer(photoDataUrls[key]);
    if (!parsed) continue;
    const ext = parsed.mime === "image/png" ? "png" : "jpg";
    const path = `${id}/${key}.${ext}`;
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
    if (!error) photos[key] = path;
  }

  // --- AI assessment (sees the photos via the original data URLs) ---
  const ai = await runAIAssessment({ profile, ruleResult, photos: photoDataUrls });

  // --- persist ---
  const row = {
    id,
    applicant_name: `${profile.firstName} ${profile.lastName}`.trim(),
    email: profile.email,
    rule_total: ruleResult.total,
    ai_score: Number.isInteger(ai?.ai_score) ? ai.ai_score : null,
    recommendation: ai?.recommendation || ruleResult.verdict,
    data: profile,
    scores: ruleResult,
    ai,
    photos,
  };

  const { error: insertErr } = await supabase.from("vetting_submissions").insert(row);
  if (insertErr) return res.status(500).json({ error: "Could not save submission", detail: insertErr.message });

  return res.status(200).json({ ok: true });
}
