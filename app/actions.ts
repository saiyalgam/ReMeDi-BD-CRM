'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as data from '@/lib/data';
import { STAGES, VERIFICATIONS, type Relevance, type Stage, type Verification } from '@/lib/types';

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
