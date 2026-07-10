// ============================================================================
// Third-party verification providers: Vouched (ID verification) and Plaid
// (bank / account-holder verification).
//
// Everything here is OPTIONAL and driven by env vars — when the keys are not
// set, the providers report "not configured", the form hides the steps, and
// the app behaves exactly as it did before. To finish setup, see README.md
// ("Finishing the Vouched & Plaid setup").
//
// Env vars:
//   VOUCHED_PUBLIC_KEY   — Vouched public key (used by the in-browser plugin)
//   VOUCHED_PRIVATE_KEY  — Vouched private key (server-side job lookup)
//   PLAID_CLIENT_ID      — Plaid client id
//   PLAID_SECRET         — Plaid secret for the chosen environment
//   PLAID_ENV            — sandbox | production (default sandbox)
// ============================================================================

// Both keys required: the public key alone would show the renter the ID-check
// flow while the server silently fails to retrieve the result — unvetted
// submissions with no photos. Never enable half-configured.
export function vouchedEnabled() { return !!(process.env.VOUCHED_PUBLIC_KEY && process.env.VOUCHED_PRIVATE_KEY); }
export function plaidEnabled() { return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET); }
// Both keys required: the publishable key drives the in-browser modal, the
// secret key retrieves the result server-side. Never enable half-configured.
export function stripeEnabled() { return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY); }
export function plaidEnv() {
  // Plaid retired the "development" environment in 2024 — sandbox/production only.
  const e = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  return ["sandbox", "production"].includes(e) ? e : "sandbox";
}

// Whole-token name comparison (substring matching lets "Al Li" match
// "Allison Little"). Requires the applicant's first AND last name to appear
// as complete tokens in the candidate name; middle names are ignored.
export function namesMatch(applicantName, candidateName) {
  const tok = (s) => String(s || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const a = tok(applicantName);
  const c = new Set(tok(candidateName));
  if (a.length === 0 || c.size === 0) return false;
  return c.has(a[0]) && c.has(a[a.length - 1]);
}

// --- Vouched -----------------------------------------------------------------
// Look up a completed verification job by id and BIND it to this applicant:
// a job id is client-supplied and could be replayed from someone else's
// verification, so `verified` requires success AND the name on the ID to
// match the applicant. Returns a trimmed summary, or { error } — never throws.
export async function fetchVouchedJob(jobId, applicantName) {
  const key = process.env.VOUCHED_PRIVATE_KEY;
  if (!key) return { error: "VOUCHED_PRIVATE_KEY is not set — job result not retrieved.", jobId };
  try {
    const res = await fetch(`https://verify.vouched.id/api/jobs?id=${encodeURIComponent(jobId)}`, {
      headers: { "x-api-key": key, "Content-Type": "application/json" },
    });
    if (!res.ok) return { error: `Vouched API responded ${res.status}`, jobId };
    const body = await res.json();
    const job = Array.isArray(body?.items) ? body.items[0] : body;
    if (!job) return { error: "Vouched job not found", jobId };
    const r = job.result || {};
    const nameOnId = [r.firstName, r.lastName].filter(Boolean).join(" ");
    const nameMatch = nameOnId ? namesMatch(applicantName, nameOnId) : null;
    return {
      provider: "vouched",
      jobId: job.id || jobId,
      status: job.status || null,
      success: r.success === true,
      // The only flag the dashboard/AI should treat as "ID verified".
      verified: r.success === true && nameMatch === true,
      nameMatch,
      confidences: r.confidences || null,
      firstName: r.firstName || null,
      lastName: r.lastName || null,
      birthDate: r.birthDate || null,
      expireDate: r.expireDate || null,
      state: r.state || null,
      idType: r.type || null,
      issues: job.errors || r.errors || null,
      retrieved_at: new Date().toISOString(),
    };
  } catch (e) {
    return { error: `Vouched lookup failed: ${e?.message || e}`, jobId };
  }
}

// --- Plaid -------------------------------------------------------------------
async function plaidRequest(path, payload) {
  const res = await fetch(`https://${plaidEnv()}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...payload,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error_message || body?.error_code || `Plaid responded ${res.status}`);
  return body;
}

export async function createPlaidLinkToken(clientUserId) {
  return plaidRequest("/link/token/create", {
    client_name: "Rental Application",
    user: { client_user_id: clientUserId },
    // Identity only — listing unused products (auth) narrows the institution
    // picker and requires extra Plaid production approval/billing.
    products: ["identity"],
    country_codes: ["US"],
    language: "en",
  });
}

// Exchange the public token from Plaid Link, pull account-holder identity, and
// return a trimmed summary (incl. whether the applicant's name matches an
// account owner). The access_token is used once here and deliberately NOT
// returned/persisted — a live banking credential does not belong in the row.
// Returns { error } on failure — never throws.
export async function fetchPlaidSummary(publicToken, applicantName) {
  if (!plaidEnabled()) return { error: "Plaid keys are not set — bank link not processed." };
  try {
    const ex = await plaidRequest("/item/public_token/exchange", { public_token: publicToken });
    const identity = await plaidRequest("/identity/get", { access_token: ex.access_token });
    const accounts = (identity.accounts || []).map((a) => ({
      name: a.name || null,
      mask: a.mask || null,
      type: a.type || null,
      subtype: a.subtype || null,
      owners: (a.owners || []).flatMap((o) => o.names || []),
    }));
    const ownerNames = accounts.flatMap((a) => a.owners);
    const nameMatch = ownerNames.some((n) => namesMatch(applicantName, n));
    return {
      provider: "plaid",
      env: plaidEnv(),
      item_id: ex.item_id || null,
      accounts,
      ownerNames,
      nameMatch,
      retrieved_at: new Date().toISOString(),
    };
  } catch (e) {
    return { error: `Plaid verification failed: ${e?.message || e}` };
  }
}

// --- Stripe Identity ---------------------------------------------------------
async function stripeRequest(method, path, form) {
  const opts = { method, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } };
  if (form) { opts.headers["Content-Type"] = "application/x-www-form-urlencoded"; opts.body = form.toString(); }
  const res = await fetch(`https://api.stripe.com${path}`, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || body?.error?.code || `Stripe responded ${res.status}`);
  return body;
}

// Start a document + selfie verification; return only what the browser needs.
// The client_secret drives the modal; the id is echoed back at submit so the
// server can retrieve the (authoritative) result.
export async function createStripeVerificationSession(applicantEmail) {
  const form = new URLSearchParams({ type: "document" });
  form.set("options[document][require_matching_selfie]", "true");
  if (applicantEmail) form.set("provided_details[email]", applicantEmail);
  const s = await stripeRequest("POST", "/v1/identity/verification_sessions", form);
  return { id: s.id, client_secret: s.client_secret };
}

// Retrieve a session server-side and BIND it to this applicant: a session id is
// client-supplied and could be replayed from someone else's check, so `verified`
// requires status "verified" AND the name on the ID matching the applicant. The
// document/ID number is deliberately NOT requested or stored. Returns { error }
// on failure — never throws.
export async function fetchStripeVerification(sessionId, applicantName) {
  if (!process.env.STRIPE_SECRET_KEY) return { error: "STRIPE_SECRET_KEY is not set — result not retrieved.", sessionId };
  try {
    const s = await stripeRequest("GET", `/v1/identity/verification_sessions/${encodeURIComponent(sessionId)}?expand[]=verified_outputs`, null);
    const vo = s.verified_outputs || null;
    const nameOnId = vo ? [vo.first_name, vo.last_name].filter(Boolean).join(" ") : "";
    const nameMatch = nameOnId ? namesMatch(applicantName, nameOnId) : null;
    // DOB and id_number are deliberately NOT requested: Stripe gates them behind
    // a restricted key (rk_) rather than the secret key, and the verified status
    // + name match already drive the decision — no restricted key to configure.
    return {
      provider: "stripe",
      sessionId: s.id || sessionId,
      status: s.status || null, // verified | processing | requires_input | canceled
      success: s.status === "verified",
      // The only flag the dashboard/AI should treat as "ID verified".
      verified: s.status === "verified" && nameMatch === true,
      nameMatch,
      firstName: vo ? vo.first_name || null : null,
      lastName: vo ? vo.last_name || null : null,
      lastError: s.last_error ? (s.last_error.reason || s.last_error.code || null) : null,
      retrieved_at: new Date().toISOString(),
    };
  } catch (e) {
    return { error: `Stripe verification lookup failed: ${e?.message || e}`, sessionId };
  }
}
