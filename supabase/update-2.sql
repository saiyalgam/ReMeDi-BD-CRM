-- ReMeDi Opportunity CRM, update 2 (team review, Oct 2026)
-- Adds: Go / No-go decision with reasons, pursuit tracking (applied, pitch, client contact, follow-up),
-- RFP document status, business-model / scope / regulatory assessment, and edit history for every change.
-- Safe to run more than once. Supabase dashboard > SQL Editor > New query > paste this file > Run.

-- 1. New columns on leads
alter table public.leads add column if not exists deadline_note       text;
alter table public.leads add column if not exists rfp_status          text not null default 'Unknown';
alter table public.leads add column if not exists eligibility_reason  text;
alter table public.leads add column if not exists scope_gaps          text;
alter table public.leads add column if not exists scope_type          text;
alter table public.leads add column if not exists uses_our_product    text;
alter table public.leads add column if not exists business_model      text;
alter table public.leads add column if not exists business_model_note text;
alter table public.leads add column if not exists regulatory_risk     text;
alter table public.leads add column if not exists regulatory_note     text;
alter table public.leads add column if not exists red_flags           text;
alter table public.leads add column if not exists decision            text not null default 'Undecided';
alter table public.leads add column if not exists decision_reason     text;
alter table public.leads add column if not exists decided_by          uuid references public.profiles (id) on delete set null;
alter table public.leads add column if not exists decided_at          timestamptz;
alter table public.leads add column if not exists applied_on          date;
alter table public.leads add column if not exists pitch_summary       text;
alter table public.leads add column if not exists contact_name        text;
alter table public.leads add column if not exists contact_role        text;
alter table public.leads add column if not exists contact_email       text;
alter table public.leads add column if not exists contact_phone       text;
alter table public.leads add column if not exists next_followup       date;

alter table public.leads drop constraint if exists leads_decision_check;
alter table public.leads add constraint leads_decision_check check (decision in ('Undecided', 'Go', 'No-go'));
alter table public.leads drop constraint if exists leads_rfp_status_check;
alter table public.leads add constraint leads_rfp_status_check check (rfp_status in ('Unknown', 'Available', 'Missing', 'Login needed', 'Requested', 'Received'));
create index if not exists leads_decision_idx on public.leads (decision);
create index if not exists leads_followup_idx on public.leads (next_followup);

alter table public.ingest_runs add column if not exists updated int not null default 0;

-- 2. More kinds of history rows
alter table public.lead_activity drop constraint if exists lead_activity_action_check;
alter table public.lead_activity add constraint lead_activity_action_check
  check (action in ('created', 'verified', 'assigned', 'stage', 'comment', 'decision', 'edited', 'pursuit', 'updated'));

-- 3. Stamp who/when and write history automatically, whichever screen (or the crawler) made the change.
--    Changes made with the secret key (crawler, imported JSON) have no signed-in person and show as "Crawler / import".
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
  if new.decision is distinct from old.decision then
    new.decided_by := auth.uid();
    new.decided_at := case when new.decision = 'Undecided' then null else now() end;
  end if;
  return new;
end $$;

create or replace function public.leads_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  kind text := case when auth.uid() is null then 'updated' else 'edited' end;
  changed text[] := '{}';
  pursuit text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'created',
      case when new.origin = 'crawler' then 'Found by the crawler (' || coalesce(new.source, 'unknown source') || ')' else 'Added by hand' end);
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
  if new.decision is distinct from old.decision or (new.decision <> 'Undecided' and new.decision_reason is distinct from old.decision_reason) then
    insert into public.lead_activity (lead_id, actor, action, detail)
    values (new.id, auth.uid(), 'decision', new.decision || coalesce(': ' || nullif(new.decision_reason, ''), ''));
  end if;

  -- details and assessment
  if new.deadline is distinct from old.deadline then
    changed := changed || ('Deadline ' || coalesce(to_char(old.deadline, 'DD Mon YYYY'), 'none') || ' → ' || coalesce(to_char(new.deadline, 'DD Mon YYYY'), 'none')
      || coalesce(' (' || nullif(new.deadline_note, '') || ')', ''));
  end if;
  if new.title is distinct from old.title then changed := changed || 'title'::text; end if;
  if new.funder_buyer is distinct from old.funder_buyer then changed := changed || 'buyer'::text; end if;
  if new.country is distinct from old.country then changed := changed || 'country'::text; end if;
  if new.amount is distinct from old.amount then changed := changed || ('value: ' || coalesce(new.amount, '—')); end if;
  if new.ref_no is distinct from old.ref_no then changed := changed || 'reference'::text; end if;
  if new.url is distinct from old.url then changed := changed || 'link'::text; end if;
  if new.summary is distinct from old.summary then changed := changed || 'summary'::text; end if;
  if new.fit_score is distinct from old.fit_score then changed := changed || ('fit score ' || coalesce(old.fit_score::text, '–') || ' → ' || coalesce(new.fit_score::text, '–')); end if;
  if new.priority is distinct from old.priority then changed := changed || ('priority ' || coalesce(old.priority, '–') || ' → ' || coalesce(new.priority, '–')); end if;
  if new.eligibility is distinct from old.eligibility then changed := changed || ('eligibility ' || coalesce(new.eligibility, '–')); end if;
  if new.business_model is distinct from old.business_model then changed := changed || ('business model ' || coalesce(new.business_model, '–')); end if;
  if new.scope_type is distinct from old.scope_type then changed := changed || ('scope ' || coalesce(new.scope_type, '–')); end if;
  if new.regulatory_risk is distinct from old.regulatory_risk then changed := changed || ('regulatory risk ' || coalesce(new.regulatory_risk, '–')); end if;
  if new.red_flags is distinct from old.red_flags then changed := changed || 'red flags'::text; end if;
  if (new.why_fit, new.risks, new.next_step, new.partner_needed, new.scope_gaps, new.eligibility_reason, new.business_model_note, new.regulatory_note, new.uses_our_product, new.suggested_partner)
     is distinct from (old.why_fit, old.risks, old.next_step, old.partner_needed, old.scope_gaps, old.eligibility_reason, old.business_model_note, old.regulatory_note, old.uses_our_product, old.suggested_partner) then
    changed := changed || 'assessment notes'::text;
  end if;
  if array_length(changed, 1) > 0 then
    insert into public.lead_activity (lead_id, actor, action, detail) values (new.id, auth.uid(), kind, array_to_string(changed, '; '));
  end if;

  -- pursuit
  if new.rfp_status is distinct from old.rfp_status then pursuit := pursuit || ('RFP documents: ' || new.rfp_status); end if;
  if new.applied_on is distinct from old.applied_on then pursuit := pursuit || ('Applied on ' || coalesce(to_char(new.applied_on, 'DD Mon YYYY'), '—')); end if;
  if new.next_followup is distinct from old.next_followup then pursuit := pursuit || ('Next follow-up ' || coalesce(to_char(new.next_followup, 'DD Mon YYYY'), '—')); end if;
  if (new.contact_name, new.contact_role, new.contact_email, new.contact_phone) is distinct from (old.contact_name, old.contact_role, old.contact_email, old.contact_phone) then
    pursuit := pursuit || ('Client contact: ' || coalesce(nullif(new.contact_name, ''), '—') || coalesce(', ' || nullif(new.contact_role, ''), ''));
  end if;
  if new.pitch_summary is distinct from old.pitch_summary then pursuit := pursuit || 'pitch summary updated'::text; end if;
  if array_length(pursuit, 1) > 0 then
    insert into public.lead_activity (lead_id, actor, action, detail) values (new.id, auth.uid(), 'pursuit', array_to_string(pursuit, '; '));
  end if;
  return new;
end $$;

drop trigger if exists leads_before_update on public.leads;
create trigger leads_before_update before update on public.leads
  for each row execute function public.leads_before_update();
drop trigger if exists leads_after_change on public.leads;
create trigger leads_after_change after insert or update on public.leads
  for each row execute function public.leads_after_change();
