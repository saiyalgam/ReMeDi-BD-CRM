-- ReMeDi Opportunity CRM, update 4 (knowledge base, evidence search, Google Drive folders) — October 2026
--
-- Adds:
--   * provenance fields on kb_documents (stable document ID, source path, SHA-256, sensitivity, extraction outcome ...)
--   * kb_evidence: extracted text passages with a locator (page / sheet+rows / slide / section) and Postgres full-text search
--   * kb_claims: atomic company claims, each citing a document and locator, with a claim status and a human review status
--   * kb_search(): ranked full-text search that respects row-level security (restricted rows need kb.read_restricted)
--   * evidence links from eligibility clauses to a cited claim (side-by-side evidence on the Eligibility tab)
--   * Google Drive: one organisation connection (refresh token encrypted by the app, readable only by the service role),
--     admin settings (root folder, copy policy), one folder tree per opportunity, linked/copied files, audit
--   * AI / embeddings switch, OFF by default (no provider is called by this release)
--
-- Run AFTER schema.sql, update-2.sql and update-3.sql. Safe to run more than once (rerunnable; nothing is dropped
-- except policies/constraints that are immediately re-created). Supabase dashboard > SQL Editor > New query > paste > Run.
--
-- Forward recovery: this file never deletes data. If a statement fails part-way, fix the cause and run the whole file
-- again. To stop using a feature, revoke its permission on the Roles & permissions screen instead of dropping tables.

-- ===============================================================
-- 1. New permissions (defaults are "Proposed" until the company confirms them)
-- ===============================================================
insert into public.role_permissions (org_role, permission, allowed, status, note)
select r.org_role, p.permission,
  case
    when p.permission = 'drive.admin' then r.org_role in ('CEO', 'CTO')
    when p.permission = 'drive.folder' then r.org_role in ('CEO', 'CTO', 'VP', 'GM')
    when p.permission = 'drive.link' then true
    when p.permission = 'kb.review_claims' then r.org_role in ('CEO', 'CTO', 'VP')
    else false
  end,
  case when p.permission = 'drive.folder' and r.org_role = 'BD Executive' then 'Open question' else 'Proposed' end,
  case
    when p.permission = 'drive.admin' then 'Connect/disconnect the organisation Google account, choose the root folder and copy policy.'
    when p.permission = 'drive.folder' and r.org_role = 'BD Executive' then 'Whether executives may create opportunity folders is not settled.'
    else null
  end
from (values ('CEO'), ('CTO'), ('VP'), ('GM'), ('BD Executive')) as r(org_role)
cross join (values ('drive.admin'), ('drive.folder'), ('drive.link'), ('kb.review_claims')) as p(permission)
on conflict (org_role, permission) do nothing;

-- ===============================================================
-- 2. Knowledge base: provenance on every document record
-- ===============================================================
alter table public.kb_documents add column if not exists doc_uid            text;
alter table public.kb_documents add column if not exists source_path        text;
alter table public.kb_documents add column if not exists container_path     text;      -- archive the file came from, if any
alter table public.kb_documents add column if not exists file_name          text;
alter table public.kb_documents add column if not exists file_type          text;
alter table public.kb_documents add column if not exists size_bytes         bigint;
alter table public.kb_documents add column if not exists sha256             text;
alter table public.kb_documents add column if not exists category           text;
alter table public.kb_documents add column if not exists sensitivity_reason text;
alter table public.kb_documents add column if not exists extraction_status  text;
alter table public.kb_documents add column if not exists extraction_notes   text;
alter table public.kb_documents add column if not exists processing_version text;
alter table public.kb_documents add column if not exists processed_at       timestamptz;
alter table public.kb_documents add column if not exists review_flags       text[] not null default '{}';
alter table public.kb_documents add column if not exists duplicate_of_uid   text;
alter table public.kb_documents add column if not exists searchable         boolean not null default true;
alter table public.kb_documents add column if not exists excluded_reason    text;
alter table public.kb_documents add column if not exists expiry_text        text;
alter table public.kb_documents add column if not exists drive_file_id      text;
alter table public.kb_documents add column if not exists drive_url          text;
drop index if exists public.kb_documents_doc_uid_key;
create unique index if not exists kb_documents_doc_uid_uniq on public.kb_documents (doc_uid);  -- NULLs never collide
create index if not exists kb_documents_sha_idx on public.kb_documents (sha256);

alter table public.kb_documents drop constraint if exists kb_documents_entity_check;
alter table public.kb_documents add constraint kb_documents_entity_check
  check (entity in ('NCPL', 'ReMeDi Foundation', 'RKF', 'Partner', 'Other', 'Unresolved'));
alter table public.kb_documents drop constraint if exists kb_documents_confidentiality_check;
alter table public.kb_documents add constraint kb_documents_confidentiality_check
  check (confidentiality in ('Internal', 'Confidential', 'Restricted'));
-- Excluded material (patient-identifiable, secrets) may be listed as metadata only: it must be Restricted and unsearchable.
alter table public.kb_documents drop constraint if exists kb_documents_excluded_check;
alter table public.kb_documents add constraint kb_documents_excluded_check
  check (excluded_reason is null or (confidentiality = 'Restricted' and not searchable));

-- ===============================================================
-- 3. Evidence passages with full-text search
-- ===============================================================
create table if not exists public.kb_evidence (
  id              bigint generated always as identity primary key,
  document_id     bigint not null references public.kb_documents (id) on delete cascade,
  locator         text not null,                     -- "page 4", "sheet ""Budget"" rows 2-40", "slide 7", "section ""Scope"""
  body            text not null,
  confidentiality text not null default 'Internal' check (confidentiality in ('Internal', 'Confidential', 'Restricted')),
  ocr             boolean not null default false,
  tsv             tsvector generated always as (to_tsvector('english', coalesce(locator, '') || ' ' || body)) stored,
  created_at      timestamptz not null default now()
);
create index if not exists kb_evidence_doc_idx on public.kb_evidence (document_id);
create index if not exists kb_evidence_tsv_idx on public.kb_evidence using gin (tsv);
alter table public.kb_evidence enable row level security;

-- ===============================================================
-- 4. Claims: one statement, one citation, separate claim status and review status
-- ===============================================================
create table if not exists public.kb_claims (
  id              bigint generated always as identity primary key,
  claim_uid       text unique,
  document_id     bigint references public.kb_documents (id) on delete cascade,
  claim_type      text not null default 'other',
  statement       text not null,
  claim_status    text not null default 'unverified'
                  check (claim_status in ('proposed', 'submitted', 'contracted', 'delivered', 'validated', 'expired', 'unverified')),
  review_status   text not null default 'pending' check (review_status in ('pending', 'confirmed', 'rejected', 'needs_info')),
  entity          text,
  confidentiality text not null default 'Internal' check (confidentiality in ('Internal', 'Confidential', 'Restricted')),
  locator         text,
  quote           text,
  subject         text,
  value           numeric,
  conflict_group  text,                              -- claims that disagree share a group; a person resolves them
  confidence      text,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists kb_claims_doc_idx on public.kb_claims (document_id);
create index if not exists kb_claims_conflict_idx on public.kb_claims (conflict_group) where conflict_group is not null;
alter table public.kb_claims enable row level security;

-- "validated" can only be set together with a human confirmation; stamp who reviewed.
create or replace function public.kb_claims_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.review_status is distinct from old.review_status or new.claim_status is distinct from old.claim_status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  if new.claim_status = 'validated' and new.review_status <> 'confirmed' then
    raise exception 'A claim can be marked validated only when a reviewer confirms it.';
  end if;
  return new;
end $$;
drop trigger if exists kb_claims_before_update on public.kb_claims;
create trigger kb_claims_before_update before update on public.kb_claims for each row execute function public.kb_claims_before_update();

-- Eligibility clause -> cited claim (shown side by side on the Eligibility tab)
alter table public.lead_requirements add column if not exists evidence_claim bigint;
alter table public.lead_requirements drop constraint if exists lead_requirements_evidence_claim_fkey;
alter table public.lead_requirements add constraint lead_requirements_evidence_claim_fkey foreign key (evidence_claim) references public.kb_claims (id) on delete set null;

-- ===============================================================
-- 5. Search (security invoker: row-level security on kb_evidence / kb_documents applies to the caller)
-- ===============================================================
create or replace function public.kb_search(q text, p_entity text default null, p_category text default null, p_limit int default 50)
returns table (evidence_id bigint, document_id bigint, doc_name text, entity text, category text, confidentiality text,
               approval text, expires_on date, locator text, snippet text, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('english', coalesce(q, '')) as tq)
  select e.id, d.id, d.name, d.entity, d.category, e.confidentiality, d.approval, d.expires_on, e.locator,
         ts_headline('english', e.body, query.tq, 'MaxWords=40, MinWords=15, ShortWord=2, MaxFragments=2, StartSel=«, StopSel=»'),
         ts_rank(e.tsv, query.tq)
  from public.kb_evidence e
  join public.kb_documents d on d.id = e.document_id
  cross join query
  where e.tsv @@ query.tq
    and d.searchable
    and (p_entity is null or d.entity = p_entity)
    and (p_category is null or d.category = p_category)
  order by ts_rank(e.tsv, query.tq) desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
grant execute on function public.kb_search(text, text, text, int) to authenticated;

-- ===============================================================
-- 6. Google Drive
-- ===============================================================
-- One organisation connection. The refresh token is encrypted by the application (AES-256-GCM, key in
-- GOOGLE_TOKEN_ENC_KEY) before it is stored. No policy is created for this table, so only the service role
-- (server code) can read or write it; browsers and signed-in users never receive the token.
create table if not exists public.google_connections (
  id                 bigint generated always as identity primary key,
  provider           text not null default 'google_drive' check (provider in ('google_drive')),
  account_email      text,
  scopes             text,
  refresh_token_enc  text,
  status             text not null default 'Not connected' check (status in ('Not connected', 'Connected', 'Error', 'Revoked')),
  last_error         text,
  connected_by       uuid references public.profiles (id) on delete set null,
  connected_at       timestamptz,
  revoked_at         timestamptz,
  updated_at         timestamptz not null default now(),
  unique (provider)
);
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;

-- Non-secret status for the settings screen.
create or replace function public.google_connection_status()
returns table (provider text, account_email text, scopes text, status text, last_error text, connected_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.provider, g.account_email, g.scopes, g.status, g.last_error, g.connected_at
  from public.google_connections g where public.is_team_member();
$$;
grant execute on function public.google_connection_status() to authenticated;

create table if not exists public.integration_settings (
  id                   int primary key default 1 check (id = 1),
  drive_root_id        text,
  drive_root_name      text,
  drive_root_url       text,
  drive_root_verified  timestamptz,
  shared_drive_id      text,
  -- link_only: files are only linked; copy_internal: Internal/Confidential files may be copied into the opportunity
  -- folder; restricted files are never copied automatically.
  copy_policy          text not null default 'link_only' check (copy_policy in ('link_only', 'copy_internal')),
  ai_provider          text not null default 'none' check (ai_provider in ('none')),
  ai_allow_confidential boolean not null default false,
  updated_by           uuid references public.profiles (id) on delete set null,
  updated_at           timestamptz not null default now()
);
insert into public.integration_settings (id) values (1) on conflict (id) do nothing;
alter table public.integration_settings enable row level security;

create table if not exists public.opportunity_drive_folders (
  id             bigint generated always as identity primary key,
  lead_id        bigint not null unique references public.leads (id) on delete cascade,
  folder_id      text,
  folder_url     text,
  folder_name    text,
  parent_id      text,
  subfolders     jsonb not null default '{}'::jsonb,   -- {"00 Source and amendments": "<id>", ...}
  status         text not null default 'Creating' check (status in ('Creating', 'Ready', 'Error')),
  error          text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  last_synced_at timestamptz
);
alter table public.opportunity_drive_folders enable row level security;

create table if not exists public.opportunity_drive_files (
  id             bigint generated always as identity primary key,
  lead_id        bigint not null references public.leads (id) on delete cascade,
  drive_file_id  text not null,
  name           text not null,
  mime_type      text,
  modified_time  timestamptz,
  web_url        text,
  subfolder      text,                                 -- which of the six subfolders it belongs to
  sensitivity    text not null default 'Internal' check (sensitivity in ('Internal', 'Confidential', 'Restricted')),
  kb_document_id bigint references public.kb_documents (id) on delete set null,
  mode           text not null default 'Link' check (mode in ('Link', 'Copy')),
  verified       boolean not null default false,       -- metadata confirmed through the organisation connection
  note           text,
  linked_by      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (lead_id, drive_file_id, mode)
);
create index if not exists opportunity_drive_files_lead_idx on public.opportunity_drive_files (lead_id);
alter table public.opportunity_drive_files enable row level security;

-- History rows for Drive actions
alter table public.lead_activity drop constraint if exists lead_activity_action_check;
alter table public.lead_activity add constraint lead_activity_action_check check (action in (
  'created', 'verified', 'assigned', 'stage', 'comment', 'decision', 'edited', 'pursuit', 'updated',
  'eligibility', 'recommendation', 'approval', 'requirement', 'risk', 'score', 'deadline', 'document', 'request', 'task', 'partner', 'merge', 'meeting',
  'drive'));

create or replace function public.drive_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; det text;
begin
  r := to_jsonb(new);
  if tg_table_name = 'opportunity_drive_folders' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
    det := 'Drive folder ' || lower(new.status) || coalesce(': ' || nullif(new.folder_name, ''), '') || coalesce(' — ' || nullif(new.error, ''), '');
  else
    det := 'Drive file ' || case when new.mode = 'Copy' then 'copied' else 'linked' end || ': ' || new.name || ' (' || coalesce(new.subfolder, 'no subfolder') || ')';
  end if;
  insert into public.lead_activity (lead_id, actor, action, detail) values (new.lead_id, auth.uid(), 'drive', left(det, 600));
  return new;
end $$;
drop trigger if exists drive_folder_history on public.opportunity_drive_folders;
create trigger drive_folder_history after insert or update on public.opportunity_drive_folders for each row execute function public.drive_history();
drop trigger if exists drive_file_history on public.opportunity_drive_files;
create trigger drive_file_history after insert on public.opportunity_drive_files for each row execute function public.drive_history();

-- Audit (uses update-3's generic audit trigger)
do $$ declare t text; begin
  foreach t in array array['kb_claims', 'integration_settings', 'opportunity_drive_folders', 'opportunity_drive_files'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ===============================================================
-- 7. Row-level security policies
-- ===============================================================
create or replace function pg_temp.pol(tbl text, name text, cmd text, using_ text, check_ text default null) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', name, tbl);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', name, tbl, cmd,
    case when using_ is null then '' else 'using (' || using_ || ')' end,
    case when check_ is null then '' else 'with check (' || check_ || ')' end);
end $$;

do $$ begin
  -- evidence passages: read like their document; written only by the loader (service role) or knowledge-base editors
  perform pg_temp.pol('kb_evidence', 'read evidence passages', 'select',
    'public.has_perm(''kb.read'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('kb_evidence', 'edit evidence passages', 'all',
    'public.has_perm(''kb.edit'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))',
    'public.has_perm(''kb.edit'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  -- claims: read like evidence; reviewers change status; editors may add
  perform pg_temp.pol('kb_claims', 'read claims', 'select',
    'public.has_perm(''kb.read'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('kb_claims', 'add claims', 'insert', null,
    'public.has_perm(''kb.edit'') and review_status = ''pending'' and claim_status <> ''validated'' and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('kb_claims', 'review claims', 'update',
    'public.has_perm(''kb.review_claims'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))',
    'public.has_perm(''kb.review_claims'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  -- settings: every member reads (no secrets here); only Drive admins change them
  perform pg_temp.pol('integration_settings', 'read settings', 'select', 'public.is_team_member()');
  perform pg_temp.pol('integration_settings', 'drive admins change settings', 'update', 'public.has_perm(''drive.admin'')', 'public.has_perm(''drive.admin'')');
  -- opportunity folders and files
  perform pg_temp.pol('opportunity_drive_folders', 'read drive folders', 'select', 'public.has_perm(''opp.read'')');
  perform pg_temp.pol('opportunity_drive_folders', 'create drive folders', 'insert', null, 'public.has_perm(''drive.folder'') and created_by = auth.uid()');
  perform pg_temp.pol('opportunity_drive_folders', 'update drive folders', 'update', 'public.has_perm(''drive.folder'')', 'public.has_perm(''drive.folder'')');
  perform pg_temp.pol('opportunity_drive_files', 'read drive files', 'select',
    'public.has_perm(''opp.read'') and (sensitivity <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('opportunity_drive_files', 'link drive files', 'insert', null,
    'public.has_perm(''drive.link'') and linked_by = auth.uid() and (sensitivity <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
  perform pg_temp.pol('opportunity_drive_files', 'unlink drive files', 'delete',
    'public.has_perm(''drive.link'') and (linked_by = auth.uid() or public.has_perm(''drive.folder''))');
end $$;

-- kb_documents: hide unsearchable / excluded rows from people without restricted access (policy from update 3 is replaced)
do $$ begin
  perform pg_temp.pol('kb_documents', 'read evidence', 'select',
    'public.has_perm(''kb.read'') and (confidentiality <> ''Restricted'' or public.has_perm(''kb.read_restricted''))');
end $$;

-- Done. Next: load documents with scripts/kb_ingest/load_supabase.py (service role key on your own computer only),
-- then set the Drive root folder on Settings > Integrations after connecting Google Drive.
