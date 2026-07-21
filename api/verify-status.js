// GET /api/verify-status?session=vs_...   (public — used by the /verify form)
// After the renter finishes the Stripe ID scan, the form polls this to pull the
// name off the verified ID so it can pre-fill the first/last name fields.
// Returns ONLY status + first/last name — never DOB, document number or address.

import { fetchStripeVerification, stripeEnabled } from "../lib/verification.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!stripeEnabled()) return res.status(503).json({ error: "ID verification is not configured." });

  const session = String((req.query && req.query.session) || "").slice(0, 128);
  if (!session.startsWith("vs_")) return res.status(400).json({ error: "Invalid session." });

  // name match isn't needed here — we're reading the name TO pre-fill the form.
  const r = await fetchStripeVerification(session, "");
  if (!r || r.error) return res.status(200).json({ status: "unknown" });

  return res.status(200).json({
    status: r.status || null,            // verified | processing | requires_input | canceled
    verified: r.status === "verified",
    firstName: r.firstName || null,
    lastName: r.lastName || null,
  });
}
