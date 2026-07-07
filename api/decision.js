// POST /api/decision   (password-gated — records the operator's decision on an application)
// Header: x-dashboard-key: <DASHBOARD_PASSWORD>
// Body:   { id, decision: "approve"|"decline"|"followup"|"", note }
// Requires the `staff` jsonb column (see supabase-setup.sql).

import { getAdminClient, friendlyDbError } from "../lib/db.js";

const DECISIONS = new Set(["approve", "decline", "followup", ""]);

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
  const decision = body && typeof body.decision === "string" ? body.decision : "";
  const note = body && typeof body.note === "string" ? body.note.slice(0, 2000) : "";
  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!DECISIONS.has(decision)) return res.status(400).json({ error: "Invalid decision" });

  let supabase;
  try { supabase = getAdminClient(); }
  catch (e) { return res.status(500).json({ error: "Server not configured", detail: e.message }); }

  const staff = { decision, note, decided_at: new Date().toISOString() };
  const { error } = await supabase.from("vetting_submissions").update({ staff }).eq("id", id);
  if (error) return res.status(500).json({ error: friendlyDbError(error.message) });
  return res.status(200).json({ ok: true, staff });
}
