# ReMeDi Opportunity CRM

A team CRM for the leads your n8n crawler finds: tenders, RFPs and EOIs, grants and CSR calls, plus a daily sector-news feed.

- **Is the lead correct?** Each lead can be marked *Correct*, *Wrong lead* or *Duplicate*, with a reason. The overview turns this into a lead-accuracy score per source, so you can see which crawler sources pull good leads.
- **Who owns it?** Assign each lead to a teammate and move it through the stages New, Qualified, Preparing, Submitted, Won, Lost or Dropped. Every change and note is kept on the lead's history with the person's name.
- **Dashboards** cover the overview, a page for each lead type (Tenders, RFPs & EOIs, Grants, CSR calls), My leads, Needs checking, News, and Team & settings.
- **Hosting:** the app runs on Vercel, the database and sign-in on Supabase (Postgres). Both have free tiers.

## What's in this folder

| Path | What it is |
|---|---|
| `supabase/schema.sql` | Database tables, security rules and the starting news feeds. Run it once in Supabase. |
| `app/`, `components/`, `lib/` | The Next.js 16 app |
| `app/api/ingest` | Where the n8n crawler sends leads (`POST`), and where it checks which leads already exist (`GET`) |
| `app/api/cron/news` | The daily news pull (Vercel Cron, 7:00 IST) |
| `vercel.json` | The cron schedule, and the Mumbai region for server functions |
| `.env.example` | Every setting the app needs |

## Deploy (about 30 minutes)

### 1. Supabase (database and logins)

1. Create a project at supabase.com. Choose region **South Asia (Mumbai)**.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**.
3. The schema already allows everyone with an `@neurosynaptic.com` email. If some teammates use other addresses, run this once per person:
   ```sql
   insert into access_list (pattern, note) values ('name@gmail.com', 'Partner');
   ```
   Admins can also add people later on the Team page.
4. **Authentication → URL Configuration:** set *Site URL* to your Vercel URL (you get it in step 3; you can come back to this). Add `https://YOUR-APP.vercel.app/auth/confirm` under *Redirect URLs*.
5. **Authentication → Emails → Magic Link:** replace the link in the template with the line below. This lets the link work on any device, such as a link sent to a laptop but opened on a phone.
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">Sign in to the Opportunity CRM</a>
   ```
6. **Authentication → SMTP Settings:** turn on custom SMTP with any email provider (Resend, Brevo, Amazon SES or your company mail server). **This step is required.** Supabase's built-in email only sends to members of your Supabase organisation, and only 2 emails an hour.
7. From **Project Settings → API Keys**, copy the *Project URL*, the *publishable* key and a *secret* key.

### 2. GitHub

Create a private repository and upload this folder, without `node_modules` or `.next`.

### 3. Vercel (the app)

1. Go to **Add New → Project** and import the repository. Vercel detects Next.js.
2. Add these environment variables before the first deploy:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`) |
   | `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`). Keep it private. |
   | `INGEST_TOKEN` | A long random string you make up. The crawler uses it. |
   | `CRON_SECRET` | Another long random string. Vercel Cron sends it automatically. |
   | `NEXT_PUBLIC_SITE_URL` | Your app URL, e.g. `https://remedi-crm.vercel.app` (optional) |

   If you connect Supabase through Vercel's Marketplace instead, the app also accepts the variable names it creates (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
3. Click **Deploy**, then finish step 1.4 with the URL Vercel gives you.
4. Open the app and sign in with your work email. **The first approved person to sign in becomes admin.** Teammates appear on the Team page after their first sign-in.

### 4. Connect the n8n crawler

In the updated `remedi-opportunity-crawler.json`:

1. In **Config**, set `crmUrl: 'https://YOUR-APP.vercel.app'`.
2. Create a *Header Auth* credential with Name `Authorization` and Value `Bearer YOUR_INGEST_TOKEN`. Attach it to the **Read CRM Leads** and **Send to CRM** nodes.
3. Run the crawler once. New leads appear under Needs checking, and the overview shows "Last crawler delivery".

The crawler still writes to the Google Sheet as well. If you only want the CRM, deactivate the **Append Opportunities** node.

To test the connection without n8n:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/ingest \
  -H "Authorization: Bearer YOUR_INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"leads":[{"uid":"test-1","title":"Test lead: telemedicine kiosks","category":"Govt Tender - India","deadline":"2026-12-31","fit_score":70}]}'
```

## Update 2 (October 2026): team review changes

What changed:

- **Go / No-go** on every lead, separate from Correct / Wrong. A No-go needs a reason. The last 40 reasons (and wrong-lead notes) are sent to the crawler, which applies them when scoring similar leads.
- **Pursuit card**: RFP documents (Requested / Received), applied date, client contact, next follow-up date and pitch summary. The overview lists follow-ups due this week and the latest No-go reasons.
- **Edit details** (deadline, deadline note, value, link, reference, summary) and an **Add lead** form for leads found outside the crawler. Every change is written to the lead's history.
- **Deadline extensions**: when the crawler sees a known lead with a later closing date, it sends the new date; the CRM moves the deadline (never earlier) and notes where it came from.
- **Assessment fields**: business-only eligibility with the reason, partner needed for scope gaps, business model (Opex / Capex / BOOT), scope type, whether our product is used, device-regulation risk and red flags.
- Days-left is always computed live; "12 days left" text written by the AI on the day a lead was found is removed.

To install it on a live CRM:

1. Supabase → SQL Editor → run `supabase/update-2.sql` (safe to run twice).
2. Upload this folder to the same GitHub repository again (Add file → Upload files, drag everything in). Vercel redeploys in about 2 minutes.
3. Import the new `remedi-opportunity-crawler.json` into n8n, pick the three credentials again on the same nodes as before, copy your `sheetId` and `crmUrl` into Config, click **Publish**, and unpublish or delete the old workflow.
4. Optional: in the Google Sheet's Opportunities tab, add the new column headers after `notes` (`eligibility_reason` … `red_flags`) so the sheet also keeps them. Run Log gains `crm_updated`.

To load a reviewed JSON file that updates existing leads (it contains `"mode": "update"`):

```
Invoke-RestMethod -Method Post -Uri "https://YOUR-APP.vercel.app/api/ingest" -Headers @{ Authorization = "Bearer YOUR_INGEST_TOKEN" } -ContentType "application/json; charset=utf-8" -InFile "crm-update-2026-10-12.json"
```

In update mode the file refreshes scores and assessment fields and sets the deadlines it gives, but it never changes Correct / Wrong, owner, stage, pursuit progress or a Go / No-go the team already made. Sending the same file twice changes nothing.

## Update 3 (October 2026): opportunity workflow

What changed (details, permission matrix and open decisions: `IMPLEMENTATION_NOTES.md`):

- **Stable reference numbers** (`OPP-2026-0042`) on every opportunity, never reused, also for wrong or duplicate leads.
- **Four separate fields**: lead verification, reviewed eligibility (the crawler's guess is kept apart), Go / No-go (recommend → approve), and the 11-stage pipeline (Identified … Won, Lost, Dropped, Banked). Old stages are mapped: New → Identified, Qualified → Under consideration, Preparing → In preparation.
- **Eligibility, clause by clause**: tender wording, source page, company evidence, status, confidence and the exact open question. "Meets directly" is blocked while a mandatory clause is open.
- **Deadlines and amendments** as dated records. A later date from the crawler waits in the Review queue and moves the deadline only when someone verifies it.
- **New screens**: dashboard, review queue, crawler intake (verify + merge duplicates), opportunity tabs (overview, source & amendments, eligibility, fit & risk, Go / No-go, partners, documents, tasks, proposal, activity), tasks, my leads & relationships, team activity, partners, knowledge base, reports, settings (roles & permissions, scoring, integrations, spreadsheet import).
- **Roles & permissions** (CEO, CTO, VP, GM, BD Executive) enforced by the database. Open policy questions are marked in the matrix.
- **Google Calendar** meetings open in the person's own Google account. (Google Chat notices were removed in update 4 and are now marked Planned.)

To install it on a live CRM:

1. Supabase → SQL Editor → run `supabase/update-3.sql` (after `schema.sql`; safe to run twice).
2. Upload this folder to the GitHub repository again; Vercel redeploys.
3. Sign in as an admin, open **Settings → Roles & permissions**, and give each person their organisation role. Until then, admins can do everything and everyone else is treated as BD Executive.
4. Review the open policy questions on that screen with leadership.
6. Optional: import the Excel pipeline under **Settings → Spreadsheet import**.

New installs: run `schema.sql`, `update-2.sql`, `update-3.sql`, then `update-4.sql`.

## Update 4 (October 2026): knowledge base, evidence and Google Drive

What changed (permissions and open questions: `IMPLEMENTATION_NOTES.md`; go-live steps: `DEPLOYMENT_CHECKLIST.md`):

- **Knowledge base with provenance.** Every document record can carry a stable document ID, source path (and the archive it came from), SHA-256, file type and size, owning entity, category, sensitivity, extraction outcome and flags. Duplicate copies point to the original.
- **Search with citations.** Postgres full-text search over extracted passages (`kb_search`). Every result names the document and the page, sheet + rows, slide or section. Restricted passages are searched only for roles with "See financial, statutory, banking and personal documents".
- **Claims to review.** One sentence per claim, copied from a document, with a claim status (proposed, submitted, contracted, delivered, validated, expired, unverified) and a separate review status. Nothing is "validated" until a reviewer confirms it. Where documents disagree, all versions are kept in a conflict group.
- **Evidence beside each eligibility clause.** A requirement can cite a claim; the Eligibility tab shows the quote and its location next to the tender wording and flags missing, expired and unconfirmed evidence.
- **Google Drive folders.** "Create Go / No-go Drive folder" on the Documents tab builds `CRM Opportunities/OPP-YYYY-NNNN - Short title/` with six subfolders (00 Source and amendments … 05 Submission and outcome). It works before the final decision, is safe to press twice, and never changes sharing. Files can be linked, or copied when the admin's copy policy allows (never Restricted files).
- **Google Meet and Chat are "Planned".** This release makes no Chat or Meet API calls and holds no credentials for them; the earlier Chat webhook sender was removed. The Calendar hand-off (opens Google Calendar in the person's own account) is unchanged.
- **No AI by default.** No document text is sent to any AI or embedding provider. `integration_settings.ai_provider` is `none`.
- **Brand colours** follow the brief: ReMeDi blue `#0E4C92`, ink `#0A3A70`, teal `#0A7F7A`; amber for uncertainty, red for errors and No-go.

To install on a live CRM:

1. Supabase → SQL Editor → run `supabase/update-4.sql` (after `update-3.sql`; safe to run twice).
2. Push this folder to GitHub; Vercel redeploys.
3. Optional, on your own computer: build and load the knowledge base (`scripts/kb_ingest/README.md`). The service-role key stays on that computer.
4. Optional: Google Drive (below).

### Google Drive setup (administrator)

1. Google Cloud Console → create or pick a project → enable the **Google Drive API**.
2. OAuth consent screen: Internal (Workspace) app; scopes `openid`, `email`, `.../auth/drive.file`.
3. Credentials → OAuth client ID → Web application. Authorised redirect URI: `https://YOUR-APP.vercel.app/api/google/drive/callback`.
4. Vercel → Environment variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY` (32 random bytes, base64), `NEXT_PUBLIC_SITE_URL`. Redeploy.
5. In the CRM, **Settings → Integrations → Connect Google Drive** with the account that should own the folders (ideally one that can create folders in a Shared Drive already shared with the team).
6. Set the root folder: leave the box empty to create "CRM Opportunities" in that account's My Drive, or paste a folder link and choose "create inside it". With the `drive.file` scope the CRM sees only folders it created (or picked with the Google Picker), so it cannot browse the rest of anyone's Drive.
7. Choose the copy policy (default: link only).

The refresh token is encrypted (AES-256-GCM) and readable only by server code with the service-role key; it never reaches the browser. **Disconnect** revokes it at Google and deletes it.

## Exports and printing (October 2026)

Every list screen has an **Export** menu: Pipeline, Review queue, Tasks, Partners, Knowledge base, Team activity and Reports, plus **Export record** on each opportunity and **Export / print** on the dashboard.

- **Excel workbook (.xlsx)** and **CSV**: what the screen shows, with the same filters applied. A workbook has a bold, frozen header row and filters. Multi-sheet exports (Reports, a single opportunity) offer one CSV per sheet.
- **Print / Save as PDF**: prints the page without the menu, buttons and forms, with a ReMeDi header and who printed it and when. Choose "Save as PDF" in the print dialog.
- Downloads need the **Export lists** permission (`opp.export`; by default leadership and GM, not BD executives). Printing is open to everyone, because it shows only what they can already see.
- Exports never include data the role cannot see. Partner contacts and due diligence need "see sensitive partner fields"; restricted evidence is left out; reports need "see reports".
- Each download is written to the audit log (who, what, which filters, how many rows). It shows under Team activity → Audit.
- Cells that start with `= + - @` are prefixed with an apostrophe, so a spreadsheet never runs them as formulas.
- Existing installs: re-run `supabase/update-3.sql` once to add the "log own exports" policy. It is safe to run again.

## Using it day to day

- **Crawler intake:** open each new lead and mark it *Correct* or *Incorrect* (with a reason), or merge it into an existing opportunity when it is a duplicate. Add a reason when it is wrong, such as "construction only" or "NGO-only". This is the data behind the accuracy table.
- **Assign:** pick an owner from the dropdown on the lead list or the lead page. My leads shows only yours.
- **Stage:** Identified → Screening → Under consideration → Partnering → In preparation (needs an approved Go) → Submitted → Clarification → Won, Lost, Dropped or Banked. A lead disappears from the open lists when its deadline passes or it is closed; use *Include closed* to see it again.
- **News:** each morning's stories are sorted with the most likely relevant first. Mark each one *Relevant* or *Not relevant*. Admins can press *Fetch news now* and can add or remove feeds on the Team page; any Google News search URL works as a feed.

## Security

- Only emails or domains on the access list can sign in. The database refuses every read and write from anyone else, whatever the app does.
- Members can read and update leads and add notes. Only admins can change roles, the access list, news feeds, or delete leads.
- The crawler and the news job use `SUPABASE_SECRET_KEY` on the server only; it is never sent to browsers.
- Lead history is written by the database itself, so it can't be skipped or edited from the app.

## Preview locally with sample data

```bash
npm install
DEMO_MODE=1 npm run dev        # Windows PowerShell: $env:DEMO_MODE=1; npm run dev
```

Then open http://localhost:3000. Demo mode loads the 67 leads from the two search rounds with sample teammates in each role (use “Demo: view as” at the bottom of the menu to see how permissions change the screens), skips login, and stores changes in a temp file on your computer. Entries marked [Sample] are fictional. Never set `DEMO_MODE` on Vercel.

`npm test` runs the unit tests for lead-type detection, crawler-row cleaning and the news reader.

## Free-tier limits to know

- **Vercel Hobby:** runs cron jobs once a day (this app needs one). Its terms are for non-commercial use, so for company use, check whether you need the Pro plan.
- **Supabase Free:** pauses a project after a period of inactivity; daily crawler deliveries normally keep it active.
- Check both providers' current pricing pages, since limits change.
