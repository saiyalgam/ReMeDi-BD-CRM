-- Update 7: first-login product tour and "New" feature badges. Run after update-6.sql. Safe to run more than once.
-- One row per user. People can read and write only their own row.

create table if not exists public.user_onboarding (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  tour_version  text,
  tour_done_at  timestamptz,
  seen_features text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

drop policy if exists user_onboarding_own_select on public.user_onboarding;
create policy user_onboarding_own_select on public.user_onboarding for select to authenticated using (user_id = auth.uid());
drop policy if exists user_onboarding_own_insert on public.user_onboarding;
create policy user_onboarding_own_insert on public.user_onboarding for insert to authenticated with check (user_id = auth.uid());
drop policy if exists user_onboarding_own_update on public.user_onboarding;
create policy user_onboarding_own_update on public.user_onboarding for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.user_onboarding to authenticated;
revoke all on public.user_onboarding from anon;
