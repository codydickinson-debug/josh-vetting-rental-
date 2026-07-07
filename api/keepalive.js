// GET /api/keepalive
// Pinged daily by Vercel Cron (see vercel.json). A free-tier Supabase project
// pauses after ~1 week without traffic — that pause is what takes the whole
// app (and the dashboard login) down. One tiny query a day keeps it awake.
//
// Public endpoint: no error details in the response (they go to the logs).
// If a CRON_SECRET env var is set in Vercel, only the cron may call this.

import { getAdminClient } from "../lib/db.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { console.error("keepalive config error:", e.message); return res.status(500).json({ ok: false }); }

  const { error } = await supabase.from("vetting_submissions").select("id").limit(1);
  if (error) { console.error("keepalive query failed:", error.message); return res.status(500).json({ ok: false }); }
  return res.status(200).json({ ok: true });
}
