# Deploy Guide — Renter Vetting System

This is a small full-stack app: a renter fills out a form, the backend scores it +
runs an AI assessment, and a password-protected dashboard shows you everything.
It runs on **Vercel** (hosting + serverless functions) and **Supabase**
(database + photo storage). No servers to manage.

Follow the steps in order. Total time: ~15 minutes.

---

## 0. What you need before starting

- A **Vercel** account (free tier is fine) — https://vercel.com
- An **Anthropic API key** for the AI assessment — https://console.anthropic.com → *API Keys*
- Access to the **Supabase** project that's already been provisioned for this app
  (project `josh-rental-vetting`). You only need to copy one key from it — see Step 2.
- A **dashboard password** of your choice (this is what unlocks the dashboard).

> The database and photo storage are **already set up** — you do not need to create
> any tables or buckets. (If you ever need to rebuild them, see *Appendix A*.)

---

## 1. Put the code where Vercel can deploy it

Pick **one** of these two paths.

### Path A — GitHub (recommended, gives you auto-deploys)
1. Create a new **private** GitHub repository.
2. Push this folder to it:
   ```sh
   git init
   git add .
   git commit -m "Renter vetting system"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
   *(The `.gitignore` already excludes `.env.local`, so your password and keys won't be uploaded.)*
3. Go to https://vercel.com/new → **Import** that repository → **Deploy**.
   Vercel auto-detects everything (no framework, no build step needed).

### Path B — Vercel CLI (no GitHub)
```sh
npm i -g vercel        # one-time install
cd "Josh Rental Vetting"
vercel                 # first run: answer the prompts to link/create the project
vercel --prod          # deploy to production
```

The first deploy will succeed but the app **won't work yet** — it needs the
environment variables from Step 3.

---

## 2. Get your two secret keys

**a) Supabase service-role key**
- Open the Supabase dashboard → project **`josh-rental-vetting`**
- Settings → **API**
- Under *Project API keys*, copy the **`service_role`** secret (the long `eyJ...` one).
  ⚠️ Copy `service_role`, **not** `anon`. This key is used server-side only.

**b) Anthropic API key**
- https://console.anthropic.com → **API Keys** → *Create Key*
- Copy the `sk-ant-...` value.

---

## 3. Set the 4 environment variables in Vercel

In Vercel: **Project → Settings → Environment Variables.**
Add all four, for **Production** *and* **Preview** (tick both environments):

| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://tpjvtggolakbzkvbyiqu.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` secret from Step 2a |
| `ANTHROPIC_API_KEY` | your `sk-ant-...` key from Step 2b |
| `DASHBOARD_PASSWORD` | the staff password you chose (it's saved locally in your `.env.local`) |

Then **redeploy** so the new variables take effect:
- GitHub path: Vercel → Deployments → ⋯ → **Redeploy**
- CLI path: `vercel --prod`

---

## 4. Smoke-test it (do this every time you deploy)

Replace `YOUR-APP` with your real Vercel domain (e.g. `josh-vetting.vercel.app`).

**a) The renter form loads**
Open `https://YOUR-APP/` in a browser — you should see the green "Let's get you on the road" form.

**b) The submit endpoint accepts an application**
Send a test application (this creates one real row you can delete later):

*Windows PowerShell:*
```powershell
$body = @{
  firstName="Test"; lastName="Applicant"; dob="1990-01-01"
  phone="(305) 555-0123"; email="test@example.com"
  address="123 Main St, Miami FL 33101"; yearsAddr="3"
  licClass="Class E"; licExp="2030-01-01"; licStatus="valid"
  violations="0"; accidents="0"; dui="0"
  hasIns="yes"; insGood=$true; insListed=$true; insLimits=$true
  rentedBefore="no"; nameMatch=$true; consent=$true
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://YOUR-APP/api/submit" -Method Post -ContentType "application/json" -Body $body
```
Expected response: `ok : True`

*macOS/Linux (curl):*
```sh
curl -s -X POST https://YOUR-APP/api/submit \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"Applicant","dob":"1990-01-01","phone":"(305) 555-0123","email":"test@example.com","address":"123 Main St, Miami FL 33101","yearsAddr":"3","licClass":"Class E","licExp":"2030-01-01","licStatus":"valid","violations":"0","accidents":"0","dui":"0","hasIns":"yes","insGood":true,"insListed":true,"insLimits":true,"rentedBefore":"no","nameMatch":true,"consent":true}'
```
Expected: `{"ok":true}`

**c) The dashboard shows it**
Open `https://YOUR-APP/dashboard` → enter your `DASHBOARD_PASSWORD` →
you should see **Test Applicant** with a rule score and an AI assessment.

That's it — you're live. Hand renters the root URL; keep `/dashboard` for yourself.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard says **"DASHBOARD_PASSWORD not configured"** | The env var isn't set in Vercel, or you didn't redeploy after adding it. |
| Dashboard says **"Unauthorized"** | Wrong password typed. It must exactly match `DASHBOARD_PASSWORD`. |
| Submit returns **"Server not configured"** | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing or wrong. Re-check Step 3. |
| Submit works but card shows **"AI assessment unavailable"** | `ANTHROPIC_API_KEY` missing/invalid, or no Anthropic credit. The submission still saves — only the AI read is skipped. |
| Photos don't appear on the dashboard | They're only included if the renter uploaded them; signed URLs expire after 1 hour (just refresh). |
| `/dashboard` 404s | Make sure `vercel.json` deployed with the project (it enables clean URLs). `/dashboard.html` also works. |

---

## Tuning later

- **Scoring** (weights, thresholds, decline rules, minimum age): the `CONFIG` object at the top of `lib/scoring.js`.
- **What the AI judges / its tone**: the `SYSTEM` prompt in `lib/ai.js`. Model is `claude-opus-4-8`.
- **Look & copy**: `index.html` (renter form) and `dashboard.html` (your view).

---

## Appendix A — database

The Supabase table + photo bucket already exist. **One one-time step before the
"Your decision" feature persists on the live site:** open the Supabase project →
**SQL Editor** → run:

```sql
alter table public.vetting_submissions add column if not exists staff jsonb;
```

(Decisions work in demo mode without this; the live `/api/decision` endpoint needs
the column.) If you ever start a **fresh** Supabase project, run the whole
`supabase-setup.sql` instead, then update `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## Appendix B — local development (optional)

```sh
npm i -g vercel
vercel link            # link to the project
vercel env pull        # pulls the env vars into .env.local
vercel dev             # runs the whole app locally at http://localhost:3000
```
