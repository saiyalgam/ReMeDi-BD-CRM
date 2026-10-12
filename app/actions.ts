'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as data from '@/lib/data';
import { DECISIONS, RFP_STATUSES, STAGES, VERIFICATIONS, type Decision, type Relevance, type Stage, type Verification } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const done = () => revalidatePath('/', 'layout');

export async function verifyAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const v = str(fd, 'verification') as Verification;
  if (!id || !(VERIFICATIONS as string[]).includes(v)) return;
  const note = fd.has('note') ? str(fd, 'note') || null : undefined;
  await data.updateLead(id, { verification: v, ...(note !== undefined ? { verification_note: note } : {}) });
  done();
}

export async function assignAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await data.updateLead(id, { assigned_to: str(fd, 'assigned_to') || null });
  done();
}

export async function stageAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const stage = str(fd, 'stage') as Stage;
  if (!id || !(STAGES as string[]).includes(stage)) return;
  await data.updateLead(id, { stage });
  done();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: string) => (ISO.test(v) ? v : null);
const back = (id: number, msg: string, err = false) => redirect(`/leads/${id}?${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

export async function decisionAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const decision = str(fd, 'decision') as Decision;
  if (!id || !(DECISIONS as string[]).includes(decision)) return;
  const reason = str(fd, 'reason').slice(0, 1000) || null;
  if (decision === 'No-go' && !reason) back(id, 'Please write why it is a No-go. The crawler learns from these reasons.', true);
  await data.updateLead(id, { decision, decision_reason: decision === 'Undecided' ? null : reason });
  done();
  back(id, decision === 'Undecided' ? 'Decision cleared.' : `Saved: ${decision}.`);
}

export async function detailsAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  const title = str(fd, 'title').slice(0, 500);
  if (!title) back(id, 'The title cannot be empty.', true);
  const url = str(fd, 'url');
  if (url && !/^https?:\/\/\S+$/i.test(url)) back(id, 'The link must start with https://', true);
  await data.updateLead(id, {
    title, funder_buyer: str(fd, 'funder_buyer') || null, country: str(fd, 'country') || null,
    deadline: dateOrNull(str(fd, 'deadline')), deadline_note: str(fd, 'deadline_note').slice(0, 300) || null,
    amount: str(fd, 'amount') || null, ref_no: str(fd, 'ref_no') || null, url: url || null, summary: str(fd, 'summary').slice(0, 2000) || null
  });
  done();
  back(id, 'Details saved.');
}

export async function pursuitAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  const rfp = str(fd, 'rfp_status');
  const email = str(fd, 'contact_email');
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) back(id, 'Check the contact email.', true);
  await data.updateLead(id, {
    rfp_status: RFP_STATUSES.includes(rfp) ? rfp : 'Unknown',
    applied_on: dateOrNull(str(fd, 'applied_on')), next_followup: dateOrNull(str(fd, 'next_followup')),
    contact_name: str(fd, 'contact_name') || null, contact_role: str(fd, 'contact_role') || null,
    contact_email: email || null, contact_phone: str(fd, 'contact_phone') || null,
    pitch_summary: str(fd, 'pitch_summary').slice(0, 3000) || null
  });
  done();
  back(id, 'Pursuit details saved.');
}

export async function createLeadAction(fd: FormData) {
  let id = 0, err = '';
  try {
    id = await data.createLead({
      title: str(fd, 'title'), lead_type: str(fd, 'lead_type'), category: str(fd, 'category'),
      funder_buyer: str(fd, 'funder_buyer'), country: str(fd, 'country'), deadline: str(fd, 'deadline'),
      amount: str(fd, 'amount'), ref_no: str(fd, 'ref_no'), url: str(fd, 'url'), summary: str(fd, 'summary'),
      source: str(fd, 'source'), rfp_status: str(fd, 'url') ? 'Available' : 'Unknown'
    });
  } catch (e) { err = (e as Error).message; }
  done();
  if (err) redirect('/leads/new?err=' + encodeURIComponent(err));
  redirect(`/leads/${id}?msg=` + encodeURIComponent('Lead added. Check it and pick an owner.'));
}

export async function commentAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await data.addComment(id, str(fd, 'comment'));
  done();
}

export async function newsAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const r = str(fd, 'relevance') as Relevance;
  if (!id || !['Unreviewed', 'Relevant', 'Not relevant'].includes(r)) return;
  await data.markNews(id, r);
  done();
}

export async function refreshNewsAction() {
  let msg: string;
  try {
    const r = await data.refreshNewsAsAdmin();
    msg = `Checked ${r.feeds} feeds: ${r.inserted} new stories.` + (r.errors.length ? ` ${r.errors.length} feed(s) failed: ${r.errors.join('; ')}` : '');
  } catch (e) { msg = (e as Error).message; }
  done();
  redirect('/news?msg=' + encodeURIComponent(msg));
}

// ----- Team page (admin) -----
async function teamAction(fn: () => Promise<void>, ok: string) {
  let target = '/team?msg=' + encodeURIComponent(ok);
  try { await fn(); } catch (e) { target = '/team?err=' + encodeURIComponent((e as Error).message); }
  done();
  redirect(target);
}

export async function nameAction(fd: FormData) { await teamAction(() => data.updateMyName(str(fd, 'full_name')), 'Name saved.'); }
export async function roleAction(fd: FormData) {
  const role = str(fd, 'role') === 'admin' ? 'admin' : 'member';
  await teamAction(() => data.setRole(str(fd, 'id'), role), 'Role updated.');
}
export async function accessAddAction(fd: FormData) { await teamAction(() => data.addAccess(str(fd, 'pattern'), str(fd, 'note')), 'Access added.'); }
export async function accessRemoveAction(fd: FormData) { await teamAction(() => data.removeAccess(str(fd, 'pattern')), 'Access removed.'); }
export async function feedAddAction(fd: FormData) { await teamAction(() => data.addFeed(str(fd, 'name'), str(fd, 'url'), str(fd, 'topic')), 'Feed added.'); }
export async function feedRemoveAction(fd: FormData) { await teamAction(() => data.removeFeed(Number(str(fd, 'id'))), 'Feed removed.'); }
