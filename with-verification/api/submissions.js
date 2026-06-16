// GET /api/submissions   (password-gated — for Josh's dashboard)
// Header: x-dashboard-key: <DASHBOARD_PASSWORD>
// Returns all submissions newest-first, with short-lived signed URLs for the photos.

import { getAdminClient, PHOTO_BUCKET } from "../lib/db.js";

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
  if (error) return res.status(500).json({ error: error.message });

  // sign photo URLs (1 hour)
  for (const row of data) {
    const signed = {};
    const photos = row.photos || {};
    for (const key of ["front", "back", "selfie", "insurance"]) {
      if (photos[key]) {
        const { data: s } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(photos[key], 3600);
        signed[key] = s?.signedUrl || null;
      } else {
        signed[key] = null;
      }
    }
    row.photo_urls = signed;
  }

  return res.status(200).json({ submissions: data });
}
