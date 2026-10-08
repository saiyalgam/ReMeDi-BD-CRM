-- ReMeDi Opportunity CRM: database schema for Supabase (Postgres).
-- Run once: Supabase dashboard > SQL Editor > New query > paste this file > Run.

-- ---------------------------------------------------------------
-- 1. Who may use the CRM
-- ---------------------------------------------------------------
create table if not exists public.access_list (
  pattern    text primary key,          -- a full email (tej@x.com) or a domain starting with @ (@neurosynaptic.com)
  note       text,
  created_at timestamptz not null default now()
);
insert into public.access_list (pattern, note)
values ('@neurosynaptic.com', 'Everyone with a company email')
on conflict do nothing;

-- true when this email is on the access list (used by the login page before a link is sent)
create or replace function public.is_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_list a
    where lower(trim(p_email)) = lower(a.pattern)
       or (a.pattern like '@%' and lower(trim(p_email)) like '%' || lower(a.pattern))
  );
$$;

-- true when the signed-in user is on the access list
create or replace function public.is_team_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_email_allowed(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- ---------------------------------------------------------------
-- 2. Team members (one row per signed-in person)
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') and public.is_team_member();
$$;

-- only admins may change anyone's role (members can still edit their own name)
create or replace function public.profiles_guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.profiles_guard_role();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', initcap(replace(split_part(new.email, '@', 1), '.', ' '))),
    -- the first approved person to sign in becomes admin
    case when public.is_email_allowed(new.email) and not exists (select 1 from public.profiles where role = 'admin')
         then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 3. Leads (tenders, RFPs / EOIs, grants, CSR calls)
-- ---------------------------------------------------------------
create table if not exists public.leads (
  id                bigint generated always as identity primary key,
  uid               text not null unique,                 -- crawler's stable id, used to skip duplicates
  lead_type         text not null default 'Tender' check (lead_type in ('Tender', 'RFP / EOI', 'Grant', 'CSR')),
  category          text not null,
  title             text not null,
  funder_buyer      text,
  country           text,
  deadline          date,
  amount            text,
  ref_no            text,
  url               text,
  source            text,
  summary           text,
  fit_score         int check (fit_score between 0 and 100),
  priority          text,
  eligibility       text,
  partner_needed    text,
  suggested_partner text,
  why_fit           text,
  risks             text,
  next_step         text,
  -- CRM fields
  verification      text not null default 'Unverified' check (verification in ('Unverified', 'Correct', 'Incorrect', 'Duplicate')),
  verification_note text,
  verified_by       uuid references public.profiles (id) on delete set null,
  verified_at       timestamptz,
  stage             text not null default 'New' check (stage in ('New', 'Qualified', 'Preparing', 'Submitted', 'Won', 'Lost', 'Dropped')),
  assigned_to       uuid references public.profiles (id) on delete set null,
  assigned_at       timestamptz,
  found_on          date not null default current_date,
  origin            text not null default 'crawler',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists leads_type_deadline_idx on public.leads (lead_type, deadline);
create index if not exists leads_assigned_idx on public.leads (assigned_to);
create index if not exists leads_verification_idx on public.leads (verification);

-- History of everything that happens to a lead (also holds comments)
create table if not exists public.lead_activity (
  id         bigint generated always as identity primary key,
  lead_id    bigint not null references public.leads (id) on delete cascade,
  actor      uuid references public.profiles (id) on delete set null,
  action     text not null check (action in ('created', 'verified', 'assigned', 'stage', 'comment')),
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at desc);

-- Stamp who/when and write history rows automatically, whichever screen made the change
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.verification is distinct from old.verification then
    new.verified_by := auth.uid();
    new.verified_at := now();
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  return new;
end $$;

create or replace function public.leads_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'created', case when new.origin = 'crawler' then 'Found by the crawler (' || coalesce(new.source, 'unknown source') || ')' else 'Added manually' end);
    return new;
  end if;
  if new.verification is distinct from old.verification then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'verified', new.verification || coalesce(': ' || nullif(new.verification_note, ''), ''));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    select coalesce(full_name, email) into who from public.profiles where id = new.assigned_to;
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'assigned', coalesce('Assigned to ' || who, 'Unassigned'));
  end if;
  if new.stage is distinct from old.stage then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'stage', old.stage || ' → ' || new.stage);
  end if;
  return new;
end $$;

drop trigger if exists leads_before_update on public.leads;
create trigger leads_before_update before update on public.leads
  for each row execute function public.leads_before_update();
drop trigger if exists leads_after_change on public.leads;
create trigger leads_after_change after insert or update on public.leads
  for each row execute function public.leads_after_change();

-- One row per crawler push, shown on the overview
create table if not exists public.ingest_runs (
  id        bigint generated always as identity primary key,
  run_at    timestamptz not null default now(),
  received  int not null default 0,
  inserted  int not null default 0,
  note      text
);

-- ---------------------------------------------------------------
-- 4. News
-- ---------------------------------------------------------------
create table if not exists public.news_feeds (
  id     bigint generated always as identity primary key,
  name   text not null,
  url    text not null unique,
  topic  text,
  active boolean not null default true
);

create table if not exists public.news_items (
  id           bigint generated always as identity primary key,
  feed_id      bigint references public.news_feeds (id) on delete set null,
  guid         text not null unique,
  title        text not null,
  url          text not null,
  source       text,
  topic        text,
  summary      text,
  published_at timestamptz,
  auto_score   int not null default 0,
  relevance    text not null default 'Unreviewed' check (relevance in ('Unreviewed', 'Relevant', 'Not relevant')),
  marked_by    uuid references public.profiles (id) on delete set null,
  marked_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists news_items_published_idx on public.news_items (published_at desc);

-- News sources: Google News searches for this domain plus one trade feed (edit on the Team page)
insert into public.news_feeds (name, url, topic) values
  ('Telemedicine tenders, India', 'https://news.google.com/rss/search?q=telemedicine+tender+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Tenders'),
  ('Health kiosks and health ATMs', 'https://news.google.com/rss/search?q=%22health+ATM%22+OR+%22health+kiosk%22+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Tenders'),
  ('Mobile medical units', 'https://news.google.com/rss/search?q=%22mobile+medical+unit%22+tender+OR+launch+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Tenders'),
  ('CSR healthcare, India', 'https://news.google.com/rss/search?q=CSR+healthcare+rural+telemedicine+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'CSR'),
  ('Ayushman Arogya Mandir and e-Sanjeevani', 'https://news.google.com/rss/search?q=%22Ayushman+Arogya+Mandir%22+OR+eSanjeevani+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Policy'),
  ('ABDM and digital health policy', 'https://news.google.com/rss/search?q=ABDM+OR+%22digital+health%22+India+policy+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Policy'),
  ('Point-of-care diagnostics', 'https://news.google.com/rss/search?q=%22point-of-care%22+diagnostics+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', 'Industry'),
  ('Digital health funding, LMICs', 'https://news.google.com/rss/search?q=digital+health+grant+OR+%22call+for+proposals%22+Africa+OR+Asia+when:14d&hl=en&gl=US&ceid=US:en', 'Grants'),
  ('Health tenders, Africa', 'https://news.google.com/rss/search?q=telemedicine+OR+%22medical+equipment%22+tender+Africa+ministry+of+health+when:14d&hl=en&gl=US&ceid=US:en', 'Tenders'),
  ('MobiHealthNews', 'https://www.mobihealthnews.com/feed', 'Industry')
on conflict (url) do nothing;

-- ---------------------------------------------------------------
-- 5. Security: only people on the access list can read or change anything.
--    The crawler and the daily news job use the secret key, which bypasses these rules.
-- ---------------------------------------------------------------
alter table public.access_list   enable row level security;
alter table public.profiles      enable row level security;
alter table public.leads         enable row level security;
alter table public.lead_activity enable row level security;
alter table public.ingest_runs   enable row level security;
alter table public.news_feeds    enable row level security;
alter table public.news_items    enable row level security;

drop policy if exists "team reads access list" on public.access_list;
create policy "team reads access list" on public.access_list for select to authenticated using (public.is_team_member());
drop policy if exists "admins manage access list" on public.access_list;
create policy "admins manage access list" on public.access_list for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "team reads profiles" on public.profiles;
create policy "team reads profiles" on public.profiles for select to authenticated using (public.is_team_member());
drop policy if exists "people edit own profile" on public.profiles;
create policy "people edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_team_member()) with check (id = auth.uid());
drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "team reads leads" on public.leads;
create policy "team reads leads" on public.leads for select to authenticated using (public.is_team_member());
drop policy if exists "team adds leads" on public.leads;
create policy "team adds leads" on public.leads for insert to authenticated with check (public.is_team_member());
drop policy if exists "team updates leads" on public.leads;
create policy "team updates leads" on public.leads for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "admins delete leads" on public.leads;
create policy "admins delete leads" on public.leads for delete to authenticated using (public.is_admin());

drop policy if exists "team reads activity" on public.lead_activity;
create policy "team reads activity" on public.lead_activity for select to authenticated using (public.is_team_member());
drop policy if exists "team comments as themselves" on public.lead_activity;
create policy "team comments as themselves" on public.lead_activity for insert to authenticated
  with check (public.is_team_member() and actor = auth.uid() and action = 'comment');

drop policy if exists "team reads ingest runs" on public.ingest_runs;
create policy "team reads ingest runs" on public.ingest_runs for select to authenticated using (public.is_team_member());

drop policy if exists "team reads feeds" on public.news_feeds;
create policy "team reads feeds" on public.news_feeds for select to authenticated using (public.is_team_member());
drop policy if exists "admins manage feeds" on public.news_feeds;
create policy "admins manage feeds" on public.news_feeds for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "team reads news" on public.news_items;
create policy "team reads news" on public.news_items for select to authenticated using (public.is_team_member());
drop policy if exists "team marks news" on public.news_items;
create policy "team marks news" on public.news_items for update to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- the login page may ask whether an email is allowed (returns only true/false)
grant execute on function public.is_email_allowed(text) to anon, authenticated;
