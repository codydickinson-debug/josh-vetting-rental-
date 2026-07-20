// POST /api/delete   (password-gated — removes an application from the dashboard)
// Header: x-dashboard-key: <DASHBOARD_PASSWORD>
// Body:   { id }
// Hard-deletes the row and best-effort removes its stored photos. Used by the
// dashboard "Delete" button to clear out bad leads.

import { getAdminClient, PHOTO_BUCKET, friendlyDbError } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return res.status(500).json({ error: "DASHBOARD_PASSWORD not configured" });
  if (req.headers["x-dashboard-key"] !== expected) return res.status(401).json({ error: "Unauthorized" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = body && body.id;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { return res.status(500).json({ error: "Server not configured", detail: e.message }); }

  // Remove the applicant's stored photos first (best-effort — a storage hiccup
  // must not block deleting the row). Full-application rows keep their ID/selfie
  // photos under `${id}/…`; ID-only (/verify) rows have none.
  try {
    const { data: row } = await supabase.from("vetting_submissions").select("photos").eq("id", id).single();
    const paths = row && row.photos ? Object.values(row.photos).filter((p) => typeof p === "string" && p) : [];
    if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  } catch (e) { /* ignore — proceed to delete the row regardless */ }

  const { error } = await supabase.from("vetting_submissions").delete().eq("id", id);
  if (error) return res.status(500).json({ error: friendlyDbError(error.message) });
  return res.status(200).json({ ok: true });
}
