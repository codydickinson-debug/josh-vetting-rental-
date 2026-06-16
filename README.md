# Josh Rental — Renter Vetting System

A renter submits an application → it lands in a backend → **you** get a dashboard
showing everything they submitted, a rule-based category score, **and** an AI
holistic assessment from Claude (which also looks at the uploaded photos).
The renter only sees a "thanks, received" confirmation — no approve/deny screen.

## Present it right now (no deploy, no keys)
The app has a built-in **demo mode** for prototypes/presentations:
1. Open `dashboard.html` (double-click, or host the folder).
2. Enter the staff password → you'll see a **Demo mode** banner and sample applicants
   (approve / review / decline), each with an AI write-up.
3. Open `index.html`, fill it out, submit → the new applicant appears in the dashboard.

Demo mode runs automatically whenever there's **no live backend** (e.g. opened as a
local file). Once you deploy to Vercel with the env vars below, the real backend takes
over and demo mode never triggers. *(Demo AI write-ups are simulated; the deployed app
uses Claude on the real uploaded photos.)*

## What's here

```
index.html             Renter application form (served at /)        — downsizes photos, POSTs to the API
dashboard.html         Your password-gated dashboard (served at /dashboard)
api/submit.js          Receives the application: scores it, runs Claude, saves it
api/submissions.js     Returns all submissions for the dashboard (password-gated)
lib/scoring.js         Deterministic rule engine (MVR 60 / Fraud 20 / Insurance 10 / History 10)
lib/ai.js              Claude assessment (claude-opus-4-8, sees the photos)
lib/db.js              Supabase client
vercel.json            Clean URLs + security headers
supabase-setup.sql     Schema (already applied to your project — kept for reference)
```

**New here? Read `DEPLOY.md` for the full step-by-step launch guide.**

## Already done for you
- **Supabase project provisioned**: `josh-rental-vetting` (region us-east-1, free tier, $0/mo)
  - URL: `https://tpjvtggolakbzkvbyiqu.supabase.co`
  - Table `vetting_submissions` + private `vetting-photos` bucket created.

## To go live — 3 steps

### 1. Get your two keys
- **Supabase service_role key**: Supabase dashboard → project `josh-rental-vetting` →
  Settings → API → copy the **`service_role`** secret (NOT the anon key).
- **Anthropic API key**: https://console.anthropic.com → API Keys → create one (`sk-ant-...`).

### 2. Deploy to Vercel
From this folder:
```
vercel            # link/create the project (first run)
vercel --prod     # deploy to production
```
(Or push to a GitHub repo and import it at vercel.com — same result.)

### 3. Set Environment Variables in Vercel
Project → Settings → Environment Variables (Production **and** Preview):

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://tpjvtggolakbzkvbyiqu.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role secret from step 1 |
| `ANTHROPIC_API_KEY` | your `sk-ant-...` key |
| `DASHBOARD_PASSWORD` | a password you choose (to open the dashboard) |

Redeploy after adding them (`vercel --prod`).

## Using it
- **Renters** go to your site root (`/`) → fill the form → submit.
- **You** go to `/dashboard` → enter your `DASHBOARD_PASSWORD` → review everything,
  including the AI's score, written read, the category points, and the ID/selfie photos.

## Tuning
- Score weights, thresholds, and decline rules: top of `lib/scoring.js` (`CONFIG`).
- AI behavior / what Claude is asked to judge: the `SYSTEM` prompt in `lib/ai.js`.

## What the AI checks — and what it can't (important)
The AI assessment (Claude, with vision on the uploaded photos) does four things:
1. **Identity cross-check** — reads the name, DOB, license #, expiry and address off the
   license and compares them to what the applicant typed. Mismatches = a strong lying signal.
2. **Fake-ID screen** — flags signs of a forged/tampered/photo-of-a-screen ID, and whether
   the selfie plausibly matches the license photo. Verdict: appears genuine / suspicious /
   likely fake / can't determine.
3. **Insurance review** — if an insurance card / dec page is uploaded, reads the named
   insured, carrier and dates and checks they match the applicant and aren't expired.
4. **Credibility** — calls out anything that suggests misrepresentation.

**These are decision-support flags, not authoritative verification.** A web form cannot
*prove* an ID is genuine or that insurance is in force — that requires the paid services in
the v2 flowchart: **Vouched** (real ID authentication + liveness), **ADD123** (the official
MVR pull), and an **insurance-verification API**. This system is built so those drop in
later; until then, treat "appears genuine / card reviewed" as *passed the AI sniff test*,
and verify anything flagged in person or by calling the insurer.

## Notes
- Driving / insurance / history fields are **self-reported** (no live MVR pull yet).
- Photos (license front/back, selfie, optional insurance card) are downsized in the browser
  and stored in a **private** bucket; the dashboard shows them via short-lived signed URLs.
- The service_role key is used server-side only and is never sent to the browser.
- The dashboard has search, status filters, and sort so it stays usable with many applicants.
