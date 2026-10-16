-- ReMeDi Opportunity CRM, update 3 (opportunity workflow, Oct 2026)
-- Adds: stable reference numbers, the 11-stage pipeline, reviewed eligibility (separate from the crawler's guess),
-- Go / No-go recommendation + approval, clause-level requirements, risk items, configurable scorecards,
-- dated deadline amendments that only move the deadline once verified, documents and document requests (drafts only),
-- tasks, partners, a company evidence library, personal relationships, integration events, saved views,
-- configurable roles & permissions enforced in the database, and a general audit log.
--
-- Run AFTER schema.sql and update-2.sql. Safe to run more than once.
-- Supabase dashboard > SQL Editor > New query > paste this file > Run.
--
-- IMPORTANT for existing installs: everyone keeps working because system admins (profiles.role = 'admin') pass every
-- permission check, and members without an organisation role are treated as 'BD Executive'. After running this,
-- an admin should open Settings > Roles & permissions and set each person's organisation role.

-- ===============================================================
-- 1. Organisation roles and permissions
-- ===============================================================
alter table public.profiles add column if not exists org_role text;
alter table public.profiles drop constraint if exists profiles_org_role_check;
alter table public.profiles add constraint profiles_org_role_check
  check (org_role is null or org_role in ('CEO', 'CTO', 'VP', 'GM', 'BD Executive'));

create table if not exists public.role_permissions (
  org_role   text not null check (org_role in ('CEO', 'CTO', 'VP', 'GM', 'BD Executive')),
  permission text not null,
  allowed    boolean not null default false,
  -- 'Proposed': a sensible default nobody has signed off yet. 'Open question': the business has not decided.
  status     text not null default 'Proposed' check (status in ('Confirmed', 'Proposed', 'Open question')),
  note       text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_role, permission)
);

-- The caller's organisation role (members without one count as BD Executive: least privilege).
create or replace function public.my_org_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select org_role from public.profiles where id = auth.uid()), 'BD Executive');
$$;

-- true when the signed-in person may do p. System admins may do everything.
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_team_member() and (
    public.is_admin()
    or exists (select 1 from public.role_permissions rp where rp.org_role = public.my_org_role() and rp.permission = p and rp.allowed)
  );
$$;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.my_org_role() to authenticated;

-- Seed defaults once (an admin changes them on the Roles & permissions screen; re-running never overwrites edits).
insert into public.role_permissions (org_role, permission, allowed, status, note)
select r.org_role, p.permission,
  case
    when r.org_role in ('CEO', 'CTO') then true
    when r.org_role = 'VP' then p.permission not in ('docs.read_restricted', 'kb.read_restricted', 'partners.read_sensitive')
    when r.org_role = 'GM' then p.permission in ('opp.read', 'opp.create', 'opp.edit', 'opp.verify', 'opp.assign', 'opp.claim', 'opp.export', 'deadline.verify', 'decision.recommend', 'assess.edit',
                                                 'docs.read', 'docs.edit', 'tasks.create', 'tasks.assign', 'tasks.claim', 'kb.read', 'kb.edit', 'partners.read', 'partners.edit', 'reports.read', 'integrations.use', 'audit.read')
    else p.permission in ('opp.read', 'opp.create', 'opp.edit', 'opp.verify', 'opp.claim', 'decision.recommend', 'assess.edit', 'docs.read', 'docs.edit',
                          'tasks.create', 'tasks.claim', 'kb.read', 'partners.read', 'integrations.use')
  end,
  case
    when r.org_role = 'VP' and p.permission in ('decision.approve', 'docs.read_restricted', 'kb.read_restricted', 'partners.read_sensitive', 'opp.reassign') then 'Open question'
    when r.org_role = 'GM' and p.permission in ('decision.approve', 'opp.reassign') then 'Open question'
    when r.org_role = 'BD Executive' and p.permission in ('opp.reassign', 'opp.claim', 'tasks.claim') then 'Open question'
    else 'Proposed'
  end,
  case
    when r.org_role = 'VP' and p.permission = 'decision.approve' then 'VP approval authority relative to CEO/CTO not settled.'
    when r.org_role = 'GM' and p.permission = 'decision.approve' then 'GM approval authority not settled.'
    when p.permission = 'opp.reassign' and r.org_role in ('GM', 'BD Executive', 'VP') then 'Who may move work between people is not settled.'
    when r.org_role = 'BD Executive' and p.permission in ('opp.claim', 'tasks.claim') then 'Whether executives may take available work themselves is not settled.'
    else null
  end
from (values ('CEO'), ('CTO'), ('VP'), ('GM'), ('BD Executive')) as r(org_role)
cross join (values
  ('opp.read'), ('opp.create'), ('opp.edit'), ('opp.verify'), ('opp.assign'), ('opp.reassign'), ('opp.claim'), ('opp.export'), ('opp.delete'),
  ('deadline.verify'), ('decision.recommend'), ('decision.approve'), ('assess.edit'),
  ('docs.read'), ('docs.edit'), ('docs.read_restricted'),
  ('tasks.create'), ('tasks.assign'), ('tasks.claim'),
  ('kb.read'), ('kb.edit'), ('kb.approve'), ('kb.read_restricted'),
  ('partners.read'), ('partners.edit'), ('partners.read_sensitive'),
  ('relationships.read_shared'), ('reports.read'), ('audit.read'), ('integrations.use')
) as p(permission)
on conflict (org_role, permission) do nothing;
-- CEO/CTO do not delete opportunities by default (references are never recycled; mark Incorrect/Duplicate instead).
update public.role_permissions set allowed = false where permission = 'opp.delete' and status = 'Proposed' and updated_by is null;

-- Only system admins change org roles.
create or replace function public.profiles_guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.org_role is distinct from old.org_role) and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;

-- ===============================================================
-- 2. Leads: reference numbers, stages, reviewed eligibility, approvals
-- ===============================================================
create sequence if not exists public.lead_ref_seq;
alter table public.leads add column if not exists ref_code text;
do $$ declare r record; begin
  for r in select id, created_at from public.leads where ref_code is null order by id loop
    update public.leads set ref_code = 'OPP-' || to_char(r.created_at at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.lead_ref_seq')::text, 4, '0') where id = r.id;
  end loop;
end $$;
create unique index if not exists leads_ref_code_key on public.leads (ref_code);

-- 11 stages (old values are mapped: New -> Identified, Qualified -> Under consideration, Preparing -> In preparation)
alter table public.leads drop constraint if exists leads_stage_check;
update public.leads set stage = case stage when 'New' then 'Identified' when 'Qualified' then 'Under consideration' when 'Preparing' then 'In preparation' else stage end
  where stage in ('New', 'Qualified', 'Preparing');
alter table public.leads alter column stage set default 'Identified';
alter table public.leads add constraint leads_stage_check check (stage in
  ('Identified', 'Screening', 'Under consideration', 'Partnering', 'In preparation', 'Submitted', 'Clarification', 'Won', 'Lost', 'Dropped', 'Banked'));

alter table public.leads add column if not exists eligibility_status  text not null default 'Not assessed';
alter table public.leads add column if not exists eligibility_summary text;
alter table public.leads add column if not exists eligibility_by      uuid references public.profiles (id) on delete set null;
alter table public.leads add column if not exists eligibility_at      timestamptz;
alter table public.leads drop constraint if exists leads_eligibility_status_check;
alter table public.leads add constraint leads_eligibility_status_check check (eligibility_status in
  ('Not assessed', 'Meets directly', 'Potentially eligible with partner', 'Does not meet', 'Needs clarification'));

alter table public.leads add column if not exists partner_need text not null default 'Not indicated';
alter table public.leads drop constraint if exists leads_partner_need_check;
alter table public.leads add constraint leads_partner_need_check check (partner_need in ('Required by tender', 'Recommended for delivery', 'Not indicated', 'Unclear'));

alter table public.leads add column if not exists recommended_decision  text;
alter table public.leads add column if not exists recommendation_reason text;
alter table public.leads add column if not exists recommended_by        uuid references public.profiles (id) on delete set null;
alter table public.leads add column if not exists recommended_at        timestamptz;
alter table public.leads add column if not exists approval_status       text not null default 'None';
alter table public.leads add column if not exists approval_note         text;
alter table public.leads drop constraint if exists leads_recommended_decision_check;
alter table public.leads add constraint leads_recommended_decision_check check (recommended_decision is null or recommended_decision in ('Go', 'No-go'));
alter table public.leads drop constraint if exists leads_approval_status_check;
alter table public.leads add constraint leads_approval_status_check check (approval_status in ('None', 'Pending', 'Approved', 'Returned'));

alter table public.leads add column if not exists duplicate_of  bigint references public.leads (id) on delete set null;
alter table public.leads add column if not exists scorecard_kind text;
alter table public.leads add column if not exists value_band     text;
create index if not exists leads_approval_idx on public.leads (approval_status);
create index if not exists leads_eligibility_status_idx on public.leads (eligibility_status);

create or replace function public.leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ref_code is null then
    new.ref_code := 'OPP-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.lead_ref_seq')::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists leads_before_insert on public.leads;
create trigger leads_before_insert before insert on public.leads for each row execute function public.leads_before_insert();

-- Stamp who/when, keep the reference fixed, and enforce permissions for people (the crawler's secret key has no auth.uid()).
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  new.updated_at := now();
  new.ref_code := old.ref_code;                                   -- never changes, never recycled

  if me is not null then
    if new.verification is distinct from old.verification and not public.has_perm('opp.verify') then
      raise exception 'Your role cannot change lead verification';
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      if old.assigned_to is null and new.assigned_to = me and public.has_perm('opp.claim') then null;      -- take available work
      elsif old.assigned_to = me and new.assigned_to is null then null;                                       -- give back own work
      elsif old.assigned_to is null and public.has_perm('opp.assign') then null;
      elsif old.assigned_to is not null and public.has_perm('opp.reassign') then null;
      else raise exception 'Your role cannot assign or reassign this opportunity';
      end if;
    end if;
    if (new.decision is distinct from old.decision) and not public.has_perm('decision.approve') then
      raise exception 'Your role can recommend a decision but not approve it';
    end if;
    if (new.recommended_decision is distinct from old.recommended_decision or new.recommendation_reason is distinct from old.recommendation_reason)
       and not public.has_perm('decision.recommend') then
      raise exception 'Your role cannot recommend a decision';
    end if;
    if new.approval_status is distinct from old.approval_status and new.approval_status in ('Approved', 'Returned') and not public.has_perm('decision.approve') then
      raise exception 'Your role cannot approve decisions';
    end if;
    if new.deadline is distinct from old.deadline and not public.has_perm('deadline.verify') then
      raise exception 'Only people who can verify deadlines may change the active deadline (add an amendment instead)';
    end if;
    if (new.eligibility_status, new.eligibility_summary, new.partner_need) is distinct from (old.eligibility_status, old.eligibility_summary, old.partner_need)
       and not public.has_perm('assess.edit') then
      raise exception 'Your role cannot change the eligibility assessment';
    end if;
    if (new.title, new.funder_buyer, new.country, new.amount, new.ref_no, new.url, new.summary, new.stage, new.deadline_note, new.value_band, new.duplicate_of,
        new.rfp_status, new.applied_on, new.pitch_summary, new.contact_name, new.contact_role, new.contact_email, new.contact_phone, new.next_followup)
       is distinct from
       (old.title, old.funder_buyer, old.country, old.amount, old.ref_no, old.url, old.summary, old.stage, old.deadline_note, old.value_band, old.duplicate_of,
        old.rfp_status, old.applied_on, old.pitch_summary, old.contact_name, old.contact_role, old.contact_email, old.contact_phone, old.next_followup)
       and not public.has_perm('opp.edit') then
      raise exception 'Your role cannot edit this opportunity';
    end if;
  end if;

  if new.verification is distinct from old.verification then new.verified_by := me; new.verified_at := now(); end if;
  if new.assigned_to is distinct from old.assigned_to then new.assigned_at := case when new.assigned_to is null then null else now() end; end if;
  if new.decision is distinct from old.decision then
    new.decided_by := me;
    new.decided_at := case when new.decision = 'Undecided' then null else now() end;
  end if;
  if new.recommended_decision is distinct from old.recommended_decision or new.recommendation_reason is distinct from old.recommendation_reason then
    new.recommended_by := me; new.recommended_at := now();
  end if;
  if new.eligibility_status is distinct from old.eligibility_status or new.eligibility_summary is distinct from old.eligibility_summary then
    new.eligibility_by := me; new.eligibility_at := now();
  end if;
  return new;
end $$;

-- More kinds of history rows
alter table public.lead_activity drop constraint if exists lead_activity_action_check;
alter table public.lead_activity add constraint lead_activity_action_check check (action in (
  'created', 'verified', 'assigned', 'stage', 'comment', 'decision', 'edited', 'pursuit', 'updated',
  'eligibility', 'recommendation', 'approval', 'requirement', 'risk', 'score', 'deadline', 'document', 'request', 'task', 'partner', 'merge', 'meeting'));

-- Extra history for the update-3 lead fields (runs after the update-2 history trigger).
create or replace function public.leads_after_change_v3() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.deadline is not null then
      insert into public.lead_deadlines (lead_id, kind, deadline, source, verified, created_by)
      values (new.id, 'Original', new.deadline, coalesce(new.source, case when new.origin = 'crawler' then 'Crawler' else 'Added by hand' end), true, auth.uid());
    end if;
    return new;
  end if;
  if new.eligibility_status is distinct from old.eligibility_status or new.eligibility_summary is distinct from old.eligibility_summary then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'eligibility', new.eligibility_status || coalesce(': ' || nullif(new.eligibility_summary, ''), ''));
  end if;
  if new.partner_need is distinct from old.partner_need then
    insert into public.lead_activity (lead_id, actor, action, detail) values (new.id, auth.uid(), 'partner', 'Partner need: ' || new.partner_need);
  end if;
  if new.recommended_decision is distinct from old.recommended_decision or new.recommendation_reason is distinct from old.recommendation_reason then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'recommendation', coalesce('Recommended ' || new.recommended_decision, 'Recommendation withdrawn') || coalesce(': ' || nullif(new.recommendation_reason, ''), ''));
  end if;
  if new.approval_status is distinct from old.approval_status and new.approval_status in ('Approved', 'Returned') then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'approval', new.approval_status || coalesce(': ' || nullif(new.approval_note, ''), ''));
  end if;
  if new.duplicate_of is distinct from old.duplicate_of and new.duplicate_of is not null then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'merge', 'Marked duplicate of ' || coalesce((select ref_code from public.leads where id = new.duplicate_of), '#' || new.duplicate_of));
  end if;
  return new;
end $$;
drop trigger if exists leads_after_change_v3 on public.leads;
create trigger leads_after_change_v3 after insert or update on public.leads for each row execute function public.leads_after_change_v3();

-- ===============================================================
-- 3. Opportunity detail tables
-- ===============================================================
create table if not exists public.lead_requirements (
  id           bigint generated always as identity primary key,
  lead_id      bigint not null references public.leads (id) on delete cascade,
  requirement  text not null,
  excerpt      text,                                    -- tender wording / threshold
  necessity    text not null default 'Unclear' check (necessity in ('Mandatory', 'Optional', 'Unclear')),
  source_doc   text,
  source_ref   text,                                    -- page / section / clause
  evidence     text,
  evidence_doc bigint,                                  -- -> kb_documents.id (FK added below)
  status       text not null default 'Not assessed' check (status in ('Meets', 'Does not meet', 'Partner may cover', 'Needs clarification', 'Not assessed')),
  confidence   text check (confidence is null or confidence in ('High', 'Medium', 'Low')),
  question     text,                                    -- the exact open question
  partner_need text not null default 'Not indicated' check (partner_need in ('Required by tender', 'Recommended for delivery', 'Not indicated')),
  gap_type     text check (gap_type is null or gap_type in ('Eligibility', 'Technical', 'Regulatory', 'Local presence / geography', 'Implementation', 'Financing / EMD', 'Equipment / OEM', 'Consortium', 'Other')),
  reviewer     uuid references public.profiles (id) on delete set null,
  note         text,
  extracted    boolean not null default false,          -- true when it came from automatic extraction and is not yet reviewed
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists lead_requirements_lead_idx on public.lead_requirements (lead_id, sort);

create table if not exists public.lead_risks (
  id         bigint generated always as identity primary key,
  lead_id    bigint not null references public.leads (id) on delete cascade,
  factor     text not null,
  level      text not null default 'Unclear' check (level in ('Low', 'Medium', 'High', 'Unclear', 'Not applicable')),
  note       text,
  source     text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (lead_id, factor)
);

create table if not exists public.scorecard_criteria (
  id        bigint generated always as identity primary key,
  kind      text not null check (kind in ('Government / PSU tender', 'International tender', 'Grant / award', 'CSR', 'Relationship lead')),
  criterion text not null,
  weight    int not null default 1 check (weight between 0 and 10),
  guidance  text,
  active    boolean not null default true,
  sort      int not null default 0,
  unique (kind, criterion)
);
insert into public.scorecard_criteria (kind, criterion, weight, guidance, sort) values
  ('Government / PSU tender', 'Scope matches ReMeDi products / services', 3, 'POC diagnostics, telemedicine, screening or implementation are a core part of the scope', 1),
  ('Government / PSU tender', 'Eligibility (turnover, experience, certifications)', 3, 'Based on the clause-level eligibility review, not the crawler guess', 2),
  ('Government / PSU tender', 'Commercial terms (EMD, payment, capex)', 2, 'Upfront capital, payment cycle and reimbursement risk', 3),
  ('Government / PSU tender', 'Delivery capacity and geography', 2, 'Locations, staffing, partner availability', 4),
  ('Government / PSU tender', 'Strategic value', 1, 'Reference value, state relationship, follow-on potential', 5),
  ('International tender', 'Scope matches ReMeDi products / services', 3, null, 1),
  ('International tender', 'Country medical-device regulation', 3, 'Registration route and timeline in that country', 2),
  ('International tender', 'Local partner / consortium readiness', 3, 'Required local partner, JV rules, supplier registration (e.g. UNGM)', 3),
  ('International tender', 'Commercial and currency risk', 2, null, 4),
  ('International tender', 'Strategic value', 1, null, 5),
  ('Grant / award', 'Fit with funder priorities', 3, null, 1),
  ('Grant / award', 'Applicant eligibility (entity, geography)', 3, 'Which entity applies: NCPL, ReMeDi Foundation or RKF', 2),
  ('Grant / award', 'Evidence and outcomes we can show', 2, null, 3),
  ('Grant / award', 'Effort vs award size', 1, null, 4),
  ('CSR', 'Alignment with CSR focus and Schedule VII', 3, null, 1),
  ('CSR', 'Implementing entity eligibility (12A/80G, CSR-1)', 3, 'Which entity can receive CSR funds', 2),
  ('CSR', 'Relationship strength', 2, null, 3),
  ('CSR', 'Programme size and margin', 1, null, 4),
  ('Relationship lead', 'Decision-maker access', 3, null, 1),
  ('Relationship lead', 'Clear need for ReMeDi', 2, null, 2),
  ('Relationship lead', 'Path to a funded opportunity', 2, null, 3)
on conflict (kind, criterion) do nothing;

create table if not exists public.lead_scores (
  lead_id      bigint not null references public.leads (id) on delete cascade,
  criterion_id bigint not null references public.scorecard_criteria (id) on delete cascade,
  score        int check (score is null or score between 0 and 5),
  rationale    text,
  evidence     text,
  scored_by    uuid references public.profiles (id) on delete set null,
  scored_at    timestamptz not null default now(),
  primary key (lead_id, criterion_id)
);

-- Deadlines: the original date and each amendment as separate dated records.
create table if not exists public.lead_deadlines (
  id          bigint generated always as identity primary key,
  lead_id     bigint not null references public.leads (id) on delete cascade,
  kind        text not null default 'Amendment' check (kind in ('Original', 'Amendment')),
  deadline    date not null,
  previous    date,
  source      text,                      -- where the date comes from (portal, corrigendum no., email)
  source_url  text,
  verified    boolean not null default false,
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  rejected    boolean not null default false,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists lead_deadlines_lead_idx on public.lead_deadlines (lead_id, created_at desc);
-- The first known deadline of each lead becomes its Original record.
insert into public.lead_deadlines (lead_id, kind, deadline, source, verified, created_at)
select l.id, 'Original', l.deadline, coalesce(l.source, 'Crawler / import'), true, l.created_at
from public.leads l
where l.deadline is not null and not exists (select 1 from public.lead_deadlines d where d.lead_id = l.id);

create table if not exists public.lead_documents (
  id            bigint generated always as identity primary key,
  lead_id       bigint not null references public.leads (id) on delete cascade,
  name          text not null,
  kind          text not null default 'RFP' check (kind in ('RFP', 'Corrigendum / amendment', 'Annexure', 'BOQ', 'Clarification', 'Pre-bid minutes', 'Submission', 'Other')),
  version       text,
  url           text,
  status        text not null default 'Available' check (status in ('Available', 'Missing', 'Requested', 'Received', 'Login needed')),
  review_status text not null default 'Not reviewed' check (review_status in ('Not reviewed', 'Reviewed', 'Superseded')),
  issued_on     date,
  expires_on    date,
  restricted    boolean not null default false,
  note          text,
  added_by      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lead_documents_lead_idx on public.lead_documents (lead_id);

-- Requests for missing documents: drafts a person reviews and sends themselves. The CRM never sends them.
create table if not exists public.doc_requests (
  id          bigint generated always as identity primary key,
  lead_id     bigint not null references public.leads (id) on delete cascade,
  document    text not null,
  to_name     text,
  to_email    text,
  subject     text,
  body        text,
  remind_on   date,
  status      text not null default 'Draft' check (status in ('Draft', 'Reviewed', 'Sent by a person', 'Cancelled')),
  drafted_by  uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id           bigint generated always as identity primary key,
  lead_id      bigint references public.leads (id) on delete cascade,
  title        text not null,
  detail       text,
  personal     boolean not null default false,   -- personal tasks are visible only to their owner
  status       text not null default 'Open' check (status in ('Open', 'In progress', 'Done', 'Cancelled')),
  assignee     uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  due_on       date,
  done_note    text,                              -- completion evidence
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks (assignee, status);
create index if not exists tasks_lead_idx on public.tasks (lead_id);

-- ===============================================================
-- 4. Partners, evidence library, relationships
-- ===============================================================
create table if not exists public.partners (
  id                  bigint generated always as identity primary key,
  name                text not null unique,
  aliases             text,
  kind                text not null default 'Organisation' check (kind in ('Organisation', 'Person')),
  category            text,
  capabilities        text,
  geography           text,
  health_domains      text,
  owner               uuid references public.profiles (id) on delete set null,
  prior_collaboration text,
  verification        text not null default 'Needs confirmation' check (verification in ('Verified', 'Needs confirmation', 'Unidentified')),
  relationship        text not null default 'To confirm' check (relationship in ('Current', 'Past', 'Prospective', 'To confirm')),
  source_note         text,             -- where the name came from
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Contacts, due diligence and restrictions live in their own table so row-level security can hide them.
create table if not exists public.partner_private (
  partner_id    bigint primary key references public.partners (id) on delete cascade,
  contact_name  text,
  contact_email text,
  contact_phone text,
  due_diligence text,
  restrictions  text,
  updated_at    timestamptz not null default now()
);

create table if not exists public.lead_partners (
  id          bigint generated always as identity primary key,
  lead_id     bigint not null references public.leads (id) on delete cascade,
  partner_id  bigint not null references public.partners (id) on delete cascade,
  need        text not null default 'Recommended for delivery' check (need in ('Required by tender', 'Recommended for delivery')),
  gap_type    text,
  gap_note    text,             -- which requirement creates the need
  evidence    text,             -- why this partner covers it
  status      text not null default 'Suggested' check (status in ('Suggested', 'Contacted', 'Committed', 'Declined')),
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (lead_id, partner_id)
);

-- Names from the BD workbooks and team conversations. Seeded as leads to validate: nothing here is a confirmed partner.
insert into public.partners (name, aliases, kind, verification, relationship, source_note) values
  ('Raj Kumari Foundation (RKF)', 'RKF', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: partner on "CSR AFSL". Separate legal entity; do not use its documents as NCPL''s.'),
  ('Codiant Technologies', 'Codient (workbook spelling)', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026 (Pre-leads, as "Codient"): system-integration collaboration. Confirm legal name and spelling.'),
  ('Equa Medical', 'Equa-Medical', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: Panama and Ecuador projects.'),
  ('TrioTree', 'Triotree', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: named on J&K telemedicine tender; MoU discussion in Pre-leads.'),
  ('TDH', null, 'Organisation', 'Unidentified', 'To confirm', 'BusinessPipeline 29 Sep 2026: Sundarbans grant and pulmonary-studies proposal. Exact entity to be confirmed.'),
  ('Gurumauli Foundation, Pune', null, 'Organisation', 'Unidentified', 'To confirm', 'Mentioned in team discussion. Identity and capabilities not verified.'),
  ('CCAMP', 'C-CAMP', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: CardiVU-PRO Wadhwani Foundation application.'),
  ('Firstmillion', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: Church Project NE (CSR).'),
  ('Qserve Pune', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: eSanjeevani Project Thane.'),
  ('Appzoy', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: "to be involved" in Equa-Medical Ecuador.'),
  ('Divine Spectrum', 'Divine Spectrum SDN BHD', 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026 (Pre-leads): RFI for kiosks.'),
  ('CBR', null, 'Organisation', 'Unidentified', 'To confirm', 'BusinessPipeline 29 Sep 2026: "CBR Devices requirement". Organisation type and full name to be confirmed.'),
  ('Marina', null, 'Organisation', 'Unidentified', 'To confirm', 'BusinessPipeline 29 Sep 2026: named on J&K telemedicine tender. Whether an organisation or a person is unclear.'),
  ('Nitin Chouthai', null, 'Person', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: newborn incubator transporter feasibility (US).'),
  ('Ameya Pethe', null, 'Person', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026: newborn incubator transporter feasibility (US).'),
  ('GenetixBiotech', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026 (Pre-leads): exploring an association.'),
  ('Akash Enterprise', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026 (Pre-leads): GeM tender specialist.'),
  ('COEP Tech', null, 'Organisation', 'Needs confirmation', 'To confirm', 'BusinessPipeline 29 Sep 2026 (Pre-leads): Smart Villages Initiative partner.'),
  ('London-based organisation (Mozambique project)', null, 'Organisation', 'Unidentified', 'To confirm', 'Unidentified—needs confirmation. Mentioned in connection with a Mozambique project; do not state a relationship.')
on conflict (name) do nothing;

create table if not exists public.kb_documents (
  id              bigint generated always as identity primary key,
  name            text not null,
  entity          text not null check (entity in ('NCPL', 'ReMeDi Foundation', 'RKF', 'Partner', 'Other')),
  doc_type        text not null check (doc_type in ('Product', 'Credential / certificate', 'Registration', 'Experience letter', 'Project reference', 'Financial', 'Policy', 'Presentation', 'Proposal material', 'Other')),
  owner           uuid references public.profiles (id) on delete set null,
  doc_date        date,
  expires_on      date,
  version         text,
  confidentiality text not null default 'Internal' check (confidentiality in ('Internal', 'Restricted')),
  approval        text not null default 'Draft' check (approval in ('Draft', 'Approved', 'Superseded')),
  tags            text,
  location        text,          -- file path or link
  summary         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.lead_requirements drop constraint if exists lead_requirements_evidence_doc_fkey;
alter table public.lead_requirements add constraint lead_requirements_evidence_doc_fkey foreign key (evidence_doc) references public.kb_documents (id) on delete set null;

-- Personal relationships (CEO and others). Notes and contacts stay with their owner unless shared.
create table if not exists public.relationships (
  id            bigint generated always as identity primary key,
  owner         uuid not null references public.profiles (id) on delete cascade,
  organisation  text not null,
  contact_name  text,
  contact_role  text,
  contact_email text,
  contact_phone text,
  status        text not null default 'Active' check (status in ('New', 'Active', 'Warm', 'Dormant', 'Closed')),
  last_touch    date,
  next_followup date,
  next_action   text,
  visibility    text not null default 'Private' check (visibility in ('Private', 'Shared with leadership')),
  linked_lead   bigint references public.leads (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.relationship_notes (
  id              bigint generated always as identity primary key,
  relationship_id bigint not null references public.relationships (id) on delete cascade,
  author          uuid references public.profiles (id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now()
);

-- Meetings and Google Chat notifications: drafts and delivery status. Nothing is sent without configuration.
create table if not exists public.integration_events (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('calendar', 'chat')),
  lead_id     bigint references public.leads (id) on delete set null,
  relationship_id bigint references public.relationships (id) on delete set null,
  task_id     bigint references public.tasks (id) on delete set null,
  title       text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'Draft' check (status in ('Draft', 'Opened in Google', 'Sent', 'Not configured', 'Failed')),
  error       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.saved_views (
  id         bigint generated always as identity primary key,
  owner      uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  query      text not null,
  created_at timestamptz not null default now()
);

-- General audit log for records outside leads (partners, evidence, permissions, tasks).
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text,
  op         text not null,
  actor      uuid,
  changed    text[],
  created_at timestamptz not null default now()
);
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare keys text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key) into keys from jsonb_each(to_jsonb(new)) n where n.value is distinct from (to_jsonb(old) -> n.key) and n.key not in ('updated_at');
    if keys is null then return new; end if;
  end if;
  insert into public.audit_log (table_name, row_id, op, actor, changed)
  values (tg_table_name, coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', (to_jsonb(coalesce(new, old)) ->> 'org_role') || ':' || (to_jsonb(coalesce(new, old)) ->> 'permission')), tg_op, auth.uid(), keys);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['partners', 'partner_private', 'kb_documents', 'role_permissions', 'tasks', 'scorecard_criteria'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- Lead history rows for the child tables, written by the database so they cannot be skipped.
create or replace function public.lead_child_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
        act text; det text; lid bigint := (r ->> 'lead_id')::bigint;
begin
  if lid is null then return coalesce(new, old); end if;
  case tg_table_name
    when 'lead_requirements' then act := 'requirement';
      det := lower(tg_op) || ': ' || left(r ->> 'requirement', 120) || ' — ' || (r ->> 'status');
    when 'lead_risks' then act := 'risk'; det := (r ->> 'factor') || ': ' || (r ->> 'level');
    when 'lead_deadlines' then act := 'deadline';
      det := case when tg_op = 'INSERT' then (r ->> 'kind') || ' ' || (r ->> 'deadline') || case when (r ->> 'verified')::boolean then ' (verified)' else ' (awaiting verification)' end || coalesce(' · ' || (r ->> 'source'), '')
                  when (r ->> 'verified')::boolean and not coalesce((o ->> 'verified')::boolean, false) then 'Verified amendment: deadline ' || (r ->> 'deadline')
                  when (r ->> 'rejected')::boolean and not coalesce((o ->> 'rejected')::boolean, false) then 'Rejected unverified date ' || (r ->> 'deadline')
                  else null end;
    when 'lead_documents' then act := 'document'; det := (r ->> 'name') || ' — ' || (r ->> 'status') || ' / ' || (r ->> 'review_status');
    when 'doc_requests' then act := 'request'; det := 'Request for ' || (r ->> 'document') || ' — ' || (r ->> 'status');
    when 'tasks' then act := 'task';
      if coalesce((r ->> 'personal')::boolean, false) then return coalesce(new, old); end if;
      det := (r ->> 'title') || ' — ' || (r ->> 'status') || coalesce(' · ' || (select coalesce(full_name, email) from public.profiles where id = (r ->> 'assignee')::uuid), '');
    when 'lead_partners' then act := 'partner'; det := (select name from public.partners where id = (r ->> 'partner_id')::bigint) || ' — ' || (r ->> 'need') || ' / ' || (r ->> 'status');
    when 'lead_scores' then act := 'score'; det := (select criterion from public.scorecard_criteria where id = (r ->> 'criterion_id')::bigint) || ': ' || coalesce(r ->> 'score', '–') || '/5';
    else return coalesce(new, old);
  end case;
  if det is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then det := 'removed ' || det; end if;
  insert into public.lead_activity (lead_id, actor, action, detail) values (lid, auth.uid(), act, left(det, 600));
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['lead_requirements', 'lead_risks', 'lead_deadlines', 'lead_documents', 'doc_requests', 'tasks', 'lead_partners', 'lead_scores'] loop
    execute format('drop trigger if exists %I_history on public.%I', t, t);
    execute format('create trigger %I_history after insert or update or delete on public.%I for each row execute function public.lead_child_history()', t, t);
  end loop;
end $$;

-- Verifying an amendment is the only way (besides an editor with deadline.verify) to move the active deadline.
create or replace function public.lead_deadlines_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'Amendment' and new.verified and (tg_op = 'INSERT' or not old.verified) then
    if auth.uid() is not null and not public.has_perm('deadline.verify') then raise exception 'Your role cannot verify deadlines'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
    update public.leads set deadline = new.deadline,
      deadline_note = 'Amended ' || coalesce(to_char(new.previous, 'DD Mon YYYY'), '') || ' → ' || to_char(new.deadline, 'DD Mon YYYY') || coalesce(' (' || new.source || ')', '')
      where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists lead_deadlines_apply on public.lead_deadlines;
create trigger lead_deadlines_apply before insert or update on public.lead_deadlines for each row execute function public.lead_deadlines_apply();

-- ===============================================================
-- 5. Row-level security for the new tables
-- ===============================================================
alter table public.role_permissions   enable row level security;
alter table public.lead_requirements  enable row level security;
alter table public.lead_risks         enable row level security;
alter table public.scorecard_criteria enable row level security;
alter table public.lead_scores        enable row level security;
alter table public.lead_deadlines     enable row level security;
alter table public.lead_documents     enable row level security;
alter table public.doc_requests       enable row level security;
alter table public.tasks              enable row level security;
alter table public.partners           enable row level security;
alter table public.partner_private    enable row level security;
alter table public.lead_partners      enable row level security;
alter table public.kb_documents       enable row level security;
alter table public.relationships      enable row level security;
alter table public.relationship_notes enable row level security;
alter table public.integration_events enable row level security;
alter table public.saved_views        enable row level security;
alter table public.audit_log          enable row level security;

-- helper to (re)create a policy
create or replace function pg_temp.pol(tbl text, name text, cmd text, using_ text, check_ text default null) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', name, tbl);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', name, tbl, cmd,
    case when using_ is null then '' else 'using (' || using_ || ')' end,
    case when check_ is null then '' else 'with check (' || check_ || ')' end);
end $$;

do $$ begin
  perform pg_temp.pol('role_permissions', 'team reads permissions', 'select', 'public.is_team_member()');
  perform pg_temp.pol('role_permissions', 'admins manage permissions', 'all', 'public.is_admin()', 'public.is_admin()');
end $$;

do $$ begin
  perform pg_temp.pol('lead_requirements', 'read requirements', 'select', 'public.has_perm(''opp.read'')');
  perform pg_temp.pol('lead_requirements', 'edit requirements', 'all', 'public.has_perm(''assess.edit'')', 'public.has_perm(''assess.edit'')');
  perform pg_temp.pol('lead_risks', 'read risks', 'select', 'public.has_perm(''opp.read'')');
  perform pg_temp.pol('lead_risks', 'edit risks', 'all', 'public.has_perm(''assess.edit'')', 'public.has_perm(''assess.edit'')');
  perform pg_temp.pol('scorecard_criteria', 'read criteria', 'select', 'public.is_team_member()');
  perform pg_temp.pol('scorecard_criteria', 'admins manage criteria', 'all', 'public.is_admin()', 'public.is_admin()');
  perform pg_temp.pol('lead_scores', 'read scores', 'select', 'public.has_perm(''opp.read'')');
  perform pg_temp.pol('lead_scores', 'edit scores', 'all', 'public.has_perm(''assess.edit'')', 'public.has_perm(''assess.edit'')');
end $$;

do $$ begin
  perform pg_temp.pol('lead_deadlines', 'read deadlines', 'select', 'public.has_perm(''opp.read'')');
  perform pg_temp.pol('lead_deadlines', 'record amendments', 'insert', null, 'public.has_perm(''opp.edit'') and (not verified or public.has_perm(''deadline.verify''))');
  perform pg_temp.pol('lead_deadlines', 'verify amendments', 'update', 'public.has_perm(''deadline.verify'')', 'public.has_perm(''deadline.verify'')');
end $$;

do $$ begin
  perform pg_temp.pol('lead_documents', 'read documents', 'select', 'public.has_perm(''docs.read'') and (not restricted or public.has_perm(''docs.read_restricted''))');
  perform pg_temp.pol('lead_documents', 'edit documents', 'all', 'public.has_perm(''docs.edit'') and (not restricted or public.has_perm(''docs.read_restricted''))', 'public.has_perm(''docs.edit'') and (not restricted or public.has_perm(''docs.read_restricted''))');
  perform pg_temp.pol('doc_requests', 'read requests', 'select', 'public.has_perm(''docs.read'')');
  perform pg_temp.pol('doc_requests', 'edit requests', 'all', 'public.has_perm(''docs.edit'')', 'public.has_perm(''docs.edit'')');
end $$;

-- tasks: shared tasks are visible to the team; personal tasks only to their assignee/creator
do $$ begin
  perform pg_temp.pol('tasks', 'read tasks', 'select', 'public.is_team_member() and (not personal or assignee = auth.uid() or created_by = auth.uid())');
  perform pg_temp.pol('tasks', 'create tasks', 'insert', null, 'public.has_perm(''tasks.create'') and created_by = auth.uid() and (assignee is null or assignee = auth.uid() or public.has_perm(''tasks.assign''))');
  perform pg_temp.pol('tasks', 'update tasks', 'update',
  'public.is_team_member() and (assignee = auth.uid() or created_by = auth.uid() or public.has_perm(''tasks.assign'') or (assignee is null and not personal and public.has_perm(''tasks.claim'')))',
  'public.is_team_member() and (assignee = auth.uid() or assignee is null or public.has_perm(''tasks.assign''))');
end $$;

do $$ begin
  perform pg_temp.pol('partners', 'read partners', 'select', 'public.has_perm(''partners.read'')');
  perform pg_temp.pol('partners', 'edit partners', 'all', 'public.has_perm(''partners.edit'')', 'public.has_perm(''partners.edit'')');
  perform pg_temp.pol('partner_private', 'read partner private', 'select', 'public.has_perm(''partners.read_sensitive'')');
  perform pg_temp.pol('partner_private', 'edit partner private', 'all', 'public.has_perm(''partners.edit'') and public.has_perm(''partners.read_sensitive'')', 'public.has_perm(''partners.edit'') and public.has_perm(''partners.read_sensitive'')');
  perform pg_temp.pol('lead_partners', 'read lead partners', 'select', 'public.has_perm(''partners.read'')');
  perform pg_temp.pol('lead_partners', 'edit lead partners', 'all', 'public.has_perm(''assess.edit'')', 'public.has_perm(''assess.edit'')');
end $$;

do $$ begin
  perform pg_temp.pol('kb_documents', 'read evidence', 'select', 'public.has_perm(''kb.read'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('kb_documents', 'add evidence', 'insert', null, 'public.has_perm(''kb.edit'') and (approval <> ''Approved'' or public.has_perm(''kb.approve'')) and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('kb_documents', 'edit evidence', 'update',
  'public.has_perm(''kb.edit'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))',
  'public.has_perm(''kb.edit'') and (approval <> ''Approved'' or public.has_perm(''kb.approve'')) and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
end $$;

do $$ begin
  perform pg_temp.pol('relationships', 'read relationships', 'select', 'public.is_team_member() and owner = auth.uid()');
  perform pg_temp.pol('relationships', 'owners manage relationships', 'all', 'owner = auth.uid() and public.is_team_member()', 'owner = auth.uid() and public.is_team_member()');
end $$;
-- private notes are readable by their relationship's owner only, whatever the visibility
do $$ begin
  perform pg_temp.pol('relationship_notes', 'owner reads notes', 'select', 'exists (select 1 from public.relationships r where r.id = relationship_id and r.owner = auth.uid())');
  perform pg_temp.pol('relationship_notes', 'owner writes notes', 'insert', null, 'author = auth.uid() and exists (select 1 from public.relationships r where r.id = relationship_id and r.owner = auth.uid())');
end $$;

do $$ begin
  perform pg_temp.pol('integration_events', 'read own events', 'select', 'public.is_team_member() and (created_by = auth.uid() or public.has_perm(''audit.read''))');
  perform pg_temp.pol('integration_events', 'create events', 'insert', null, 'public.has_perm(''integrations.use'') and created_by = auth.uid()');
  perform pg_temp.pol('integration_events', 'update own events', 'update', 'created_by = auth.uid()', 'created_by = auth.uid()');
end $$;

do $$ begin
  perform pg_temp.pol('saved_views', 'own views', 'all', 'owner = auth.uid()', 'owner = auth.uid() and public.is_team_member()');
  perform pg_temp.pol('audit_log', 'read audit', 'select', 'public.has_perm(''audit.read'')');
  -- Export log: anyone allowed to export records their own export (who, what, when). Nobody can edit or delete it.
  perform pg_temp.pol('audit_log', 'log own exports', 'insert', null, 'table_name = ''export'' and op = ''EXPORT'' and actor = auth.uid() and public.has_perm(''opp.export'')');
end $$;

-- Relationships others shared with leadership: organisation, status and follow-up only (never contacts or notes).
create or replace function public.shared_relationships()
returns table (id bigint, owner uuid, organisation text, contact_role text, status text, last_touch date, next_followup date, next_action text, linked_lead bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.owner, r.organisation, r.contact_role, r.status, r.last_touch, r.next_followup, r.next_action, r.linked_lead
  from public.relationships r
  where r.visibility = 'Shared with leadership' and r.owner <> auth.uid() and public.has_perm('relationships.read_shared');
$$;
grant execute on function public.shared_relationships() to authenticated;

-- Leads: creating and deleting now follow permissions too (updates are checked field by field in leads_before_update).
drop policy if exists "team adds leads" on public.leads;
create policy "team adds leads" on public.leads for insert to authenticated with check (public.has_perm('opp.create'));
drop policy if exists "team reads leads" on public.leads;
create policy "team reads leads" on public.leads for select to authenticated using (public.has_perm('opp.read'));
drop policy if exists "team updates leads" on public.leads;
create policy "team updates leads" on public.leads for update to authenticated using (public.has_perm('opp.read')) with check (public.has_perm('opp.read'));
drop policy if exists "admins delete leads" on public.leads;
create policy "admins delete leads" on public.leads for delete to authenticated using (public.has_perm('opp.delete'));
