// GET /api/verification-config   (public)
// Tells the renter form which third-party verification steps to show.
// Only ever exposes public keys — never secrets. With no keys configured,
// both providers report disabled and the form stays as-is.

import { vouchedEnabled, plaidEnabled, plaidEnv } from "../lib/verification.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  return res.status(200).json({
    vouched: {
      enabled: vouchedEnabled(),
      publicKey: process.env.VOUCHED_PUBLIC_KEY || null,
    },
    plaid: {
      enabled: plaidEnabled(),
      env: plaidEnv(),
    },
  });
}
