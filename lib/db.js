// Shared Supabase client (service-role — server-side only, never expose to the browser).
import { createClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "vetting-photos";

export function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key, { auth: { persistSession: false } });
}
