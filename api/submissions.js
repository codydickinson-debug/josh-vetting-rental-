// GET /api/submissions   (password-gated — for Josh's dashboard)
// Header: x-dashboard-key: <DASHBOARD_PASSWORD>
// Returns all submissions newest-first, with short-lived signed URLs for the photos.

import { getAdminClient, PHOTO_BUCKET, friendlyDbError } from "../lib/db.js";

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
  }

  return res.status(200).json({ submissions: data });
}
