-- Run once in the Supabase SQL Editor of your NEW dedicated project.
-- (If Claude provisioned the project for you via the connected tool, this is already applied.)

-- Submissions table
create table if not exists public.vetting_submissions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  applicant_name  text,
  email           text,
  rule_total      int,
  ai_score        int,
  recommendation  text,
  data            jsonb,   -- normalized applicant profile
  scores          jsonb,   -- rule-engine breakdown (categories + flags)
  ai              jsonb,   -- Claude assessment (or { error })
  photos          jsonb,   -- storage paths { front, back, selfie, insurance }
  staff           jsonb    -- your decision: { decision, note, decided_at }
);

-- If the table already existed (e.g. from an earlier version), add the new column:
alter table public.vetting_submissions add column if not exists staff jsonb;

create index if not exists vetting_submissions_created_idx
  on public.vetting_submissions (created_at desc);

-- Lock the table down: only the service role (used by the API) may read/write.
-- RLS on with no policies = no anon/public access. The service_role key bypasses RLS.
alter table public.vetting_submissions enable row level security;

-- Private storage bucket for the license/selfie photos.
insert into storage.buckets (id, name, public)
values ('vetting-photos', 'vetting-photos', false)
on conflict (id) do nothing;
-- No storage policies are added, so the bucket is reachable only via the service role.
