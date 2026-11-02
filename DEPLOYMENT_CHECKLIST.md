# Deployment checklist — update 7 (product tour, uploads, JSON files)

- [ ] Supabase → SQL Editor → run `supabase/update-7.sql`. Check: `user_onboarding` exists with RLS on and three "own row" policies.
- [ ] Push and let Vercel deploy.
- [ ] Sign in: the product tour appears once. Skip it, reload: it does not come back. Account menu → "Take the product tour again" replays it.
- [ ] Events → Upload from Excel → choose `CBR_AI_Conclave_Leads.xlsx` → it says "list of people met", header row 4, new event "CBR AI Conclave" → Import 6 → Open the event.
- [ ] Settings → Import → Upload a lead file (.json) → `crm-update-2026-11-02b.json` → import.

---

# Deployment checklist — update 6 (PIN unlock)

- [ ] Update 5 below is done.
- [ ] Supabase → SQL Editor → run `supabase/update-6.sql`. Check: Table Editor shows `user_pins` with RLS enabled and **no** policies.
- [ ] Vercel → Environment Variables → add `PIN_COOKIE_SECRET` (32+ random characters, Sensitive). Never put it in `.env.example` or Git.
- [ ] Push and let Vercel deploy.
- [ ] Sign in with your email link → you are asked to create a PIN. Close the browser, open the CRM again → PIN screen, not the email page.
- [ ] Enter a wrong PIN once → "4 attempts left". Lock icon → Lock now → PIN screen.
- [ ] Tell the team: create a PIN on the next visit; "Forgot PIN" = sign in with email again.

---

# Deployment checklist — update 5 (Lead Tracker, events, outreach)

- [ ] Update 4 below is already done (`update-4.sql` has been run).
- [ ] Vercel has **no** `DEMO_MODE` variable.
- [ ] Supabase → SQL Editor → paste `supabase/update-5.sql` → Run (rerunnable, never deletes data).
- [ ] Check: Table Editor shows `bd_events`, `bd_contacts`, `bd_learnings`, `pre_leads`, `cohorts`, each with RLS enabled.
- [ ] Push this folder to GitHub (`main`); Vercel deploys.
- [ ] As CEO: `/tracker` shows the board; drag a test lead and move it back; open **Events → + Add event**, add a [Sample] event, upload a small contacts sheet on its Contacts tab with round-robin.
- [ ] As a BD Executive: the assign and round-robin controls are absent, and changing another person's contact owner is refused.
- [ ] **Settings → Roles & permissions**: confirm the three "Events & outreach" rows, including the open question on BD Executives assigning others.
- [ ] Do not upload sheets holding patient data. Contact sheets carry personal data: keep the source Excel files out of the Git folder.

---

# Deployment checklist — update 4

Tick each line in order. Nothing in this release sends email, posts to Google Chat, creates Meet links or changes Google Drive sharing.

## 1. Before you start

- [ ] Supabase backup or point-in-time recovery is available (Supabase → Database → Backups).
- [ ] `schema.sql`, `update-2.sql` and `update-3.sql` have already been run on this project.
- [ ] Vercel has **no** `DEMO_MODE` variable (demo mode must stay off in production).

## 2. Database

- [ ] Supabase → SQL Editor → paste `supabase/update-4.sql` → Run. It is rerunnable; if it stops part-way, fix the cause and run the whole file again (forward recovery — it never deletes data).
- [ ] Check: Table Editor shows `kb_evidence`, `kb_claims`, `google_connections`, `integration_settings`, `opportunity_drive_folders`, `opportunity_drive_files`.
- [ ] Check: Authentication → Policies shows **no** policy on `google_connections` (service role only).

## 3. Code

- [ ] Push this folder to GitHub (`main`). Vercel builds and deploys.
- [ ] Open the CRM, sign in, open **Knowledge base**: the page loads (empty search is fine before loading).
- [ ] **Settings → Roles & permissions**: review the new rows — "Confirm or reject extracted company claims", "Connect Google Drive …", "Create the Drive folder …", "Link or copy Drive files …". They are *Proposed* until leadership confirms them.

## 4. Knowledge base (optional, on a company computer)

- [ ] Run `scripts/kb_ingest` steps 1–3 (see its README). Output goes to `C:\NCPL\07_CRM_KNOWLEDGE_BASE\ingest_YYYY-MM-DD`, not to Git.
- [ ] A person reads `review_queue.csv` and `summary.md`. Excluded and Restricted classes look right.
- [ ] `load_supabase.py --dry-run`, then without `--dry-run`. The service-role key is typed into that terminal only.
- [ ] In the CRM, as a BD Executive: Restricted documents are hidden and the page says how many. As CEO: they are visible.

## 5. Google Drive (optional)

- [ ] Google Cloud project with the Drive API; OAuth client (Web) with redirect `https://YOUR-APP/api/google/drive/callback`; consent screen Internal; scopes `openid email drive.file`.
- [ ] Vercel env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY` (32 bytes base64), `NEXT_PUBLIC_SITE_URL`. Redeploy.
- [ ] Settings → Integrations shows "Not connected" (not "Not configured"). Connect with the folder-owning account.
- [ ] Set the root folder; badge shows "Connected".
- [ ] On one test opportunity: Documents tab → **Create Go / No-go Drive folder** → six subfolders appear in Drive; press it again → nothing duplicated.
- [ ] Link one Internal file; it shows "checked in Drive" or "not verified" honestly.
- [ ] Disconnect works (status "Revoked") and reconnect works.

## 6. What is NOT live in this release

- Google Meet automation and Google Chat notifications: shown as **Planned**.
- AI / embedding search: off (`ai_provider = none`).
- Google Picker: not built; root folder is created by the CRM or pasted.
