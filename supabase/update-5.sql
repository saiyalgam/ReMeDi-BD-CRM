-- ReMeDi Opportunity CRM, update 5 (Lead Tracker board, events and outreach) — November 2026
--
-- Adds:
--   * permissions outreach.read / outreach.edit / outreach.assign ("Proposed" until the company confirms them)
--   * bd_events: conferences and events (dates, application deadline, importance, purpose, people, cost estimate vs
--     actual, checklist, actual output, effectiveness, status)
--   * bd_contacts: people met at events and personal leads (organisation, contact details, meeting status, owner,
--     follow-up date, introducer, link to the lead it became)
--   * bd_learnings: what we learned at an event (year, winners, model, learnings)
--   * pre_leads: early opportunities being explored before they become leads
--   * cohorts: accelerator / network cohorts and their status
--   Owner changes are checked by the database: you may take a row yourself, but giving it to someone else needs
--   outreach.assign.
--
-- Run AFTER schema.sql, update-2.sql, update-3.sql and update-4.sql. Safe to run more than once. It never deletes data.
-- Supabase dashboard > SQL Editor > New query > paste > Run.

-- 1. Permissions
insert into public.role_permissions (org_role, permission, allowed, status, note)
select r.org_role, p.permission,
  case when p.permission in ('outreach.read', 'outreach.edit') then true
       when p.permission = 'outreach.assign' then r.org_role in ('CEO', 'CTO', 'VP', 'GM')
       else false end,
  case when p.permission = 'outreach.assign' and r.org_role = 'BD Executive' then 'Open question' else 'Proposed' end,
  case when p.permission = 'outreach.assign' and r.org_role = 'BD Executive'
       then 'Whether executives may hand contacts to others is not settled. They can always take a contact themselves.' else null end
from (values ('CEO'), ('CTO'), ('VP'), ('GM'), ('BD Executive')) as r(org_role)
cross join (values ('outreach.read'), ('outreach.edit'), ('outreach.assign')) as p(permission)
on conflict (org_role, permission) do nothing;

-- 2. Tables
create table if not exists public.bd_events (
  id             bigint generated always as identity primary key,
  name           text not null,
  dates_text     text,
  starts_on      date,
  ends_on        date,
  apply_by       date,
  apply_by_text  text,
  importance     text not null default 'Medium' check (importance in ('Must', 'High', 'Medium', 'Optional')),
  location       text,
  purpose        text,
  participation  text,
  personnel      uuid[] not null default '{}',
  personnel_text text,
  cost_estimate  numeric(14, 2),
  cost_actual    numeric(14, 2),
  checklist      jsonb not null default '[]'::jsonb,
  actual_output  text,
  effectiveness  smallint check (effectiveness between 1 and 5),
  status         text not null default 'Planned' check (status in ('Planned', 'Registered', 'Preparing', 'Attended', 'Follow-up', 'Closed', 'Skipped')),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.bd_contacts (
  id             bigint generated always as identity primary key,
  event_id       bigint references public.bd_events (id) on delete set null,
  organisation   text,
  name           text,
  title          text,
  phone          text,
  email          text,
  met_on         date,
  meeting_status text not null default 'To contact' check (meeting_status in ('To contact', 'Scheduled', 'Follow-up', 'Met', 'No response', 'Closed')),
  details        text,
  next_action    text,
  owner          uuid references public.profiles (id) on delete set null,
  followup_on    date,
  source         text,
  introducer     text,
  converted_lead bigint references public.leads (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint bd_contacts_who check (coalesce(nullif(trim(name), ''), nullif(trim(organisation), '')) is not null)
);
create index if not exists bd_contacts_event_idx on public.bd_contacts (event_id);
create index if not exists bd_contacts_owner_idx on public.bd_contacts (owner, followup_on);
create index if not exists bd_contacts_email_idx on public.bd_contacts (lower(email));

create table if not exists public.bd_learnings (
  id         bigint generated always as identity primary key,
  event_id   bigint references public.bd_events (id) on delete cascade,
  year       text,
  winners    text,
  model      text,
  learnings  text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.pre_leads (
  id             bigint generated always as identity primary key,
  task           text not null,
  opportunity    text,
  status         text not null default 'Assigned' check (status in ('Assigned', 'Exploring', 'In progress', 'On hold', 'Lost', 'Converted')),
  steps          text,
  owner          uuid references public.profiles (id) on delete set null,
  due_on         date,
  source         text,
  converted_lead bigint references public.leads (id) on delete set null,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.cohorts (
  id         bigint generated always as identity primary key,
  name       text not null,
  status     text not null default 'Conversation initiated' check (status in ('Applied', 'Waiting', 'Joined', 'Conversation initiated', 'Not selected', 'Closed')),
  contact    text,
  next_step  text,
  updates    text,
  deadline   date,
  owner      uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Owner changes: take it yourself, or hold outreach.assign to give it to someone else.
create or replace function public.outreach_owner_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;           -- service role / SQL editor
  if tg_op = 'INSERT' then
    if new.owner is not null and new.owner <> auth.uid() and not public.has_perm('outreach.assign') then
      raise exception 'Your role cannot assign this to someone else. Leave it unassigned or take it yourself.';
    end if;
  elsif new.owner is distinct from old.owner then
    if not (public.has_perm('outreach.assign') or new.owner = auth.uid() or (old.owner = auth.uid() and new.owner is null)) then
      raise exception 'Your role cannot move this to someone else.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['bd_contacts', 'pre_leads', 'cohorts'] loop
    execute format('drop trigger if exists %I_owner_guard on public.%I', t, t);
    execute format('create trigger %I_owner_guard before insert or update on public.%I for each row execute function public.outreach_owner_guard()', t, t);
  end loop;
end $$;

create or replace function public.bd_events_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists bd_events_touch on public.bd_events;
create trigger bd_events_touch before update on public.bd_events for each row execute function public.bd_events_touch();

-- 4. Row-level security
alter table public.bd_events    enable row level security;
alter table public.bd_contacts  enable row level security;
alter table public.bd_learnings enable row level security;
alter table public.pre_leads    enable row level security;
alter table public.cohorts      enable row level security;

create or replace function pg_temp.pol(tbl text, name text, cmd text, using_ text, check_ text default null) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', name, tbl);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', name, tbl, cmd,
    case when using_ is null then '' else 'using (' || using_ || ')' end,
    case when check_ is null then '' else 'with check (' || check_ || ')' end);
end $$;

do $$ declare t text; begin
  foreach t in array array['bd_events', 'bd_contacts', 'bd_learnings', 'pre_leads', 'cohorts'] loop
    perform pg_temp.pol(t, 'read ' || t, 'select', 'public.has_perm(''outreach.read'')');
    perform pg_temp.pol(t, 'add ' || t, 'insert', null, 'public.has_perm(''outreach.edit'')');
    perform pg_temp.pol(t, 'edit ' || t, 'update', 'public.has_perm(''outreach.edit'')', 'public.has_perm(''outreach.edit'')');
    perform pg_temp.pol(t, 'remove ' || t, 'delete', 'public.has_perm(''outreach.assign'') or created_by = auth.uid()');
  end loop;
end $$;

-- 5. Audit trail (the audit_row() function comes from update-3.sql)
do $$ declare t text; begin
  foreach t in array array['bd_events', 'bd_contacts', 'bd_learnings', 'pre_leads', 'cohorts'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;
