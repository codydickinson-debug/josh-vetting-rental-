// Shared Supabase client (service-role — server-side only, never expose to the browser).
import { createClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "vetting-photos";

export function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// A paused/unreachable Supabase project answers with a full Cloudflare error
// page; never pass that HTML through to the dashboard as an "error message".
export function friendlyDbError(msg) {
  const s = String(msg || "");
  if (/<!doctype|<html|error code 521|web server is down/i.test(s)) {
    return "Database unreachable — it may be waking from a pause. Try again in a minute.";
  }
  return (s.trim() || "Unknown database error").slice(0, 300);
}
