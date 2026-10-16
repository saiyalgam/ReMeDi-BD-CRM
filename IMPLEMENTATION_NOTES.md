# ReMeDi Opportunity CRM — update 3 implementation notes

Prepared 15 October 2026 for Neurosynaptic Communications Pvt. Ltd. (NCPL). Read this with `README.md` (deployment) and `supabase/update-3.sql` (database).

## 1. What existed and what was reused

**Stack (verified in the repository):** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres, row-level security, magic-link sign-in), n8n crawler posting to `/api/ingest`, daily news cron on Vercel. No new framework or ORM was added and no new npm dependency.

| Area | Before | Now |
|---|---|---|
| Data layer `lib/data.ts` | Leads, members, activity, news, ingest, demo mode | Kept and extended: permission-aware session, field-level permission checks mirroring the database, amendment-safe ingest |
| Lead table + history triggers | Verification, 7 stages, Go/No-go, pursuit, edit history | Kept; added reference numbers, 11 stages, reviewed eligibility, recommendation/approval, duplicate link, value band |
| Overview page | KPIs, source accuracy, follow-ups, No-go reasons, news | Rebuilt as the CEO dashboard; source accuracy and No-go reasons moved to Reports |
| Leads list, lead page | Filters, verify/assign, single long page | Pipeline with saved views, flags, bulk actions, pagination; tabbed opportunity record |
| Team page | Members, access list, feeds | Kept as “Users & access”, plus organisation roles |
| Strategy page | Value bands, partner placeholder | Kept; fixed a TypeScript error that broke `next build`; links to the new partner directory |
| Design-source ZIP (`*.dc.html`) | Static mockups | Used as the visual and flow spec: dashboard, pipeline, review queue, eligibility review, action drawers, team activity, my leads, partners |
| Figma link | — | Not accessible from this session (Figma is not available here); the ZIP and the brief were used instead |

**Missing before, built now:** review queue, crawler intake with duplicate merge, clause-level requirements, risk items, configurable scorecards, deadline amendment records, tender documents and request drafts, tasks, partner directory, knowledge base, personal relationships, team activity, reports, roles & permissions, integrations screen, spreadsheet import, loading / empty / error / permission-denied states.

## 2. Screen and flow map

```
Dashboard ──► Review queue ──► Opportunity › Eligibility (clause + evidence side by side)
   │              │                    │
   │              │                    ├─► Fit & risk (risk items, scorecard)
   │              │                    ├─► Go / No-go: recommend ──► approve / return (approvers)
   │              │                    │                                   │
   │              │                    │                     Go ──► Stage: Partnering / In preparation
   │              │                    ├─► Partners (gap → partner, with evidence)
   │              │                    ├─► Tasks (assign, or leave available to claim) ──► Tasks page
   │              │                    ├─► Documents (missing → request draft → person sends)
   │              │                    └─► Proposal (response checklist from evidence) ──► Submitted ──► Won / Lost
   │              └─► Source & amendments (verify / reject a new deadline)
   ├─► Pipeline (every KPI opens its filtered list)   ├─► Crawler intake (verify, merge duplicates)
   ├─► My leads & relationships (private; meetings)   ├─► Team activity (filter by person → opportunity)
   └─► Partners · Knowledge base · Reports · Settings (permissions, scoring, integrations, import)
```

Every dashboard number links to the matching filtered list (for example *Tenders / RFPs in preparation* → `/leads?type=tender,rfp&stage=Partnering,In+preparation`).

## 3. Design system

- **Colour tokens** (`app/globals.css`, `:root`): `--brand #264e94` (sampled from the supplied ReMeDi wordmark; the brief's `#0E4C92` is close), `--brand-ink #1b3a73`, `--teal #0a7f7a` / `--teal-tint #e2f3f1` for progress and Go/Won, amber `--warning-text #874a00` with a dashed `--uncertain` outline for anything unresolved, red `--critical-text #a3231a` for errors, overdue and No-go. Ink `#102a43`; cool surfaces `#f0f4f8` with a faint dot grid; white work surfaces. Dark-mode values included.
- **Type:** Plus Jakarta Sans — 800 for page and section titles, 200 for large KPI figures, 14.5 px body; IBM Plex Mono for reference numbers only.
- **Status badges** always carry a symbol and a word (✓ ✕ ◐ ? ○ ◆ ▲ ■ ▼), never colour alone. The four decision fields each have their own badge component (`components/ui.tsx`).
- **Components:** brand rail with the supplied logos on a white tile (not recoloured or distorted), page header with breadcrumbs, KPI tiles, record header with stage stepper, record tabs, dense tables, saved-view pills, filter chips, flags, `<details>` drawers (keyboard accessible without JavaScript), verdict panels, side-by-side clause/evidence, feeds, empty / loading (skeleton) / error / permission-denied / saved notes.
- **Motion:** sections rise in with a 50 ms stagger, table rows fade in, cards lift 2 px on hover; everything is off under `prefers-reduced-motion`.
- **Layout:** desktop first; tablet (≤1180 px) stacks the side panels; ≤900 px the rail becomes a compact top bar; data-heavy tabs use the full width.

## 4. Permissions matrix (defaults seeded by `update-3.sql`)

Enforced in the database (`has_perm()`, row-level security and the `leads_before_update` trigger) and mirrored in server actions for clear messages. Admins edit it at **Settings → Roles & permissions**. System admins (`profiles.role = 'admin'`) pass every check; people without an organisation role are treated as BD Executive.

✓ allowed · — not allowed · **?** open policy question (default applied until decided). Nothing is marked “Confirmed”: all values are proposed defaults.

| Area | Permission | Kind | CEO | CTO | VP | GM | BD Executive |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| Opportunities | See opportunities (`opp.read`) | Read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Opportunities | Add opportunities and import spreadsheets (`opp.create`) | Create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Opportunities | Edit details, stage and pursuit (`opp.edit`) | Edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Opportunities | Mark leads Correct / Incorrect / Duplicate (`opp.verify`) | Edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Opportunities | Give an unassigned opportunity an owner (`opp.assign`) | Assign | ✓ | ✓ | ✓ | ✓ | — |
| Opportunities | Move an opportunity from one owner to another (`opp.reassign`) | Assign | ✓ | ✓ | ✓ **?** | — **?** | — **?** |
| Opportunities | Take an unassigned opportunity for yourself (`opp.claim`) | Assign | ✓ | ✓ | ✓ | ✓ | ✓ **?** |
| Opportunities | Export lists (`opp.export`) | Export | ✓ | ✓ | ✓ | ✓ | — |
| Opportunities | Delete opportunities (references are never reused) (`opp.delete`) | Administer | — | — | — | — | — |
| Deadlines | Verify amendments and change the active deadline (`deadline.verify`) | Approve | ✓ | ✓ | ✓ | ✓ | — |
| Pursuit decision | Recommend Go / No-go (`decision.recommend`) | Edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pursuit decision | Approve Go / No-go (`decision.approve`) | Approve | ✓ | ✓ | ✓ **?** | — **?** | — |
| Eligibility & assessment | Edit requirements, risks, scores, partner gaps (`assess.edit`) | Edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tender documents | See tender documents (`docs.read`) | Read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tender documents | Add documents and draft requests (`docs.edit`) | Edit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tender documents | See restricted tender documents (`docs.read_restricted`) | Read | ✓ | ✓ | — **?** | — | — |
| Tasks | Create tasks (`tasks.create`) | Create | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tasks | Assign tasks to others (`tasks.assign`) | Assign | ✓ | ✓ | ✓ | ✓ | — |
| Tasks | Take available shared tasks (`tasks.claim`) | Assign | ✓ | ✓ | ✓ | ✓ | ✓ **?** |
| Knowledge base | See company evidence (`kb.read`) | Read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Knowledge base | Add and edit evidence records (`kb.edit`) | Edit | ✓ | ✓ | ✓ | ✓ | — |
| Knowledge base | Approve evidence for use in bids (`kb.approve`) | Approve | ✓ | ✓ | ✓ | — | — |
| Knowledge base | See financial, statutory, banking and personal documents (`kb.read_restricted`) | Read | ✓ | ✓ | — **?** | — | — |
| Partners | See the partner directory (`partners.read`) | Read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Partners | Edit partners (`partners.edit`) | Edit | ✓ | ✓ | ✓ | ✓ | — |
| Partners | See partner contacts, due diligence and restrictions (`partners.read_sensitive`) | Read | ✓ | ✓ | — **?** | — | — |
| Relationships | See relationships others shared with leadership (`relationships.read_shared`) | Read | ✓ | ✓ | ✓ | — | — |
| Reports & audit | See reports (`reports.read`) | Read | ✓ | ✓ | ✓ | ✓ | — |
| Reports & audit | See the audit log and integration history (`audit.read`) | Read | ✓ | ✓ | ✓ | ✓ | — |
| Integrations | Prepare meetings and notifications (`integrations.use`) | Create | ✓ | ✓ | ✓ | ✓ | ✓ |

**Open policy questions (need a leadership decision):**

1. VP authority relative to CEO/CTO: approving Go / No-go (default: allowed), seeing restricted financial/statutory documents and sensitive partner data (default: not allowed), moving work between people (default: allowed).
2. GM: approving Go / No-go (default: not allowed) and reassigning work (default: not allowed; GM can assign unassigned work).
3. BD executives: taking unassigned opportunities and tasks themselves (default: allowed) and reassigning (default: not allowed).
4. Who may see private relationship notes: implemented as owner only, always. “Shared with leadership” reveals organisation, status and follow-up date — never contacts or notes.

## 5. Google Workspace prerequisites

| Feature | Works now? | What is needed |
|---|---|---|
| Schedule a meeting (Calendar + Meet) | Yes — opens Google Calendar’s create page in the person’s own account with title, time, attendees and agenda filled in | Nothing. The person is the organiser and sees attendees before saving; Meet is added there (or automatically if the Workspace setting “Automatically add video calls” is on). Recorded in the delivery log as “Opened in Google”. |
| Create events directly from the CRM | Not built | Google Cloud project, Calendar API enabled, OAuth web client, scope `calendar.events` only, admin approval under API controls, per-user consent, encrypted token storage. No domain-wide delegation needed. |
| Chat notice on assignment / reassignment / approval needed | Built, off by default | Admin allows incoming webhooks; add a webhook (“ReMeDi CRM”) in the team space; set `GOOGLE_CHAT_WEBHOOK_URL` and `CHAT_NOTIFICATIONS=on` in Vercel. Messages are bot messages, logged with success/failure; a failure never blocks the change. Off in demo mode. |
| Chat direct messages to individuals | Not built | A full Chat app (Chat API, app configuration, admin availability). |
| Email | Not used for sending | Requests for documents are drafts a person sends from their own mailbox. A licensed “noreply” user is not needed; if automatic email is added later, a sending alias or shared mailbox is usually enough. |

## 6. Assumptions and unverified information

- **Partners:** 19 names were seeded from `BusinessPipeline 29 Sep 2026.xlsx` and the brief, each with the source of the mention, as *Needs confirmation* or *Unidentified*, relationship *To confirm*. No capabilities, contacts or relationships were invented. TDH, CBR and Marina need their exact entity confirmed; Gurumauli Foundation is unverified; the London-based organisation for the Mozambique project is *Unidentified — needs confirmation*.
- **Personal contacts** in the workbooks (Personal Leads, AVPN meetings) were **not** copied into the code or seeds. Import them through the import screen if wanted; they then follow the CRM's permissions.
- **Scorecards:** the default criteria and weights are a proposed starting point, not company policy.
- **Value bands** follow the workbook buckets (up to ₹50 lakh, ₹50 lakh–₹2 crore, above ₹2 crore).
- **Stage mapping on import:** In Process → In preparation, Negotiation → Clarification, Tanked/No-Go → Dropped. Go / No-go is never imported.
- **AI drafting** of proposal text is not switched on; the proposal tab builds a response checklist from cited evidence and states that drafts must cite sources.
- **Document storage:** the knowledge base records where a file lives (path or link); file upload to Supabase Storage is not built.
- **Demo data:** crawler leads are the real crawler rounds already in the repo; everything else is marked [Sample] or “Demo …”.

## 7. Files changed

New: `supabase/update-3.sql`, `lib/perm.ts`, `lib/data-ext.ts`, `lib/google.ts`, `lib/import.ts`, `lib/sheet.ts`, `public/brand/remedi-wordmark.png`, `public/brand/neurosynaptic-logo.png`, `app/(crm)/loading.tsx`, `app/(crm)/leads/[id]/tabs.tsx`, `app/(crm)/review/page.tsx`, `app/(crm)/intake/page.tsx`, `app/(crm)/tasks/page.tsx`, `app/(crm)/my/page.tsx`, `app/(crm)/activity/page.tsx`, `app/(crm)/partners/page.tsx`, `app/(crm)/partners/[id]/page.tsx`, `app/(crm)/knowledge/page.tsx`, `app/(crm)/reports/page.tsx`, `app/(crm)/settings/page.tsx`, `app/(crm)/settings/permissions/page.tsx`, `app/(crm)/settings/scoring/page.tsx`, `app/(crm)/settings/integrations/page.tsx`, `app/(crm)/settings/import/page.tsx`, `app/(crm)/settings/import/ImportClient.tsx`, `IMPLEMENTATION_NOTES.md`.

Changed: `app/actions.ts`, `app/globals.css`, `app/layout.tsx`, `app/(crm)/layout.tsx`, `app/(crm)/page.tsx`, `app/(crm)/error.tsx`, `app/(crm)/leads/page.tsx`, `app/(crm)/leads/[id]/page.tsx`, `app/(crm)/leads/new/page.tsx`, `app/(crm)/team/page.tsx`, `app/(crm)/strategy/page.tsx`, `components/ui.tsx`, `components/NavLinks.tsx`, `lib/data.ts`, `lib/types.ts`, `lib/views.ts`, `lib/demo.ts`, `lib/defaults.ts`, `README.md`, `.env.example`.

Unchanged: `supabase/schema.sql`, `supabase/update-2.sql`, `lib/leadtype.ts`, the ingest and cron routes, auth, `proxy.ts`, the n8n workflow, tests.

### Exports (follow-up)

New: `lib/xlsx-write.ts` (dependency-free .xlsx/.csv writer), `lib/exports.ts` (one builder per screen; permission checks plus logging), `app/export/[kind]/route.ts` (downloads; outside `/api` so the sign-in proxy covers it), `components/Export.tsx`, `components/PrintButton.tsx`.
Changed: `supabase/update-3.sql` (the audit_log policy "log own exports": the caller can only insert `table_name='export'`, `op='EXPORT'`, `actor = auth.uid()`, and only with `opp.export`), `components/ui.tsx` (`PageHead` `tools` slot), `app/globals.css` (menu and `@media print`), `app/(crm)/layout.tsx` (print header), and the nine screens that show the menu.

## 8. How to run

```bash
npm install
DEMO_MODE=1 npm run dev        # Windows PowerShell: $env:DEMO_MODE=1; npm run dev
```

Open http://localhost:3000 and use **Demo: view as** (bottom of the menu) to switch between the sample CEO, CTO, VP, GM and BD executives. Production: see README “Update 3”.

## 9. Verification performed

- `supabase/schema.sql` + `update-2.sql` + `update-3.sql` (run twice) on PostgreSQL 16 with Supabase `auth` stubs; checked as a BD executive and a CEO that: reference numbers are assigned, BD can recommend but not approve or reassign or change the deadline, an unverified amendment does not move the deadline and a verified one does, restricted evidence is hidden, history rows are written.
- `tsc --noEmit` clean; `next build` succeeds; existing `npm test` passes (6/6).
- In the browser (demo mode): every page and every opportunity tab loads; recommend → approve; the “Meets directly” guard; amendment verification from the review queue; the “In preparation needs Go” guard; task create → claim → completion note required; permission edit; import of `BusinessPipeline 29 Sep 2026.xlsx` (15 rows; a second import skips all 15 as duplicates); meeting hand-off to Google Calendar.
- Not verified: a live Supabase project, real sign-in, the n8n crawler end to end, Google Chat delivery (no credentials in this session).
- Exports: as CEO every kind returns a workbook that opens in openpyxl and LibreOffice, with sheets, a frozen header and filters. As a BD executive every download returns 403 and the menu offers print only. As GM, the partner export leaves out contact, email, phone, due diligence and restrictions. The CSV respects the screen filters, an unknown kind returns 404, and each download appears in the audit log. On Postgres, a GM can log their own export but cannot forge a non-export audit row or log one as someone else; a BD executive cannot insert at all. Print-to-PDF was rendered in Chromium for Pipeline, Dashboard, an opportunity record and Reports.

---

## Update 4 (16 Oct 2026): knowledge base, evidence and Google Drive

### New permissions (seeded as *Proposed*)

| Permission | CEO | CTO | VP | GM | BD Executive |
|---|---|---|---|---|---|
| `kb.review_claims` — confirm or reject extracted claims | ✓ | ✓ | ✓ | – | – |
| `drive.admin` — connect Drive, root folder, copy policy | ✓ | ✓ | – | – | – |
| `drive.folder` — create an opportunity's Drive folder | ✓ | ✓ | ✓ | ✓ | – (*Open question*) |
| `drive.link` — link / copy Drive files | ✓ | ✓ | ✓ | ✓ | ✓ |

### Design decisions

- **Sensitivity**: Internal / Confidential / Restricted are stored in `kb_documents.confidentiality`. *Excluded* (patient-identifiable data, secrets) is stored as Restricted + `searchable = false` + `excluded_reason`, with no text. A check constraint enforces that.
- **Claims** keep two fields apart: `claim_status` (what the source says: proposed / submitted / contracted / delivered / validated / expired / unverified) and `review_status` (what a person decided). A trigger refuses `validated` without `confirmed`.
- **Conflicts** are never resolved automatically; disagreeing claims share `conflict_group`.
- **Drive** uses one organisation connection with the `drive.file` scope. Folder lookup uses `appProperties` (`crmRef`, `crmKind`, `crmSub`) so creation is idempotent. The CRM never calls the permissions API.
- **Tokens**: AES-256-GCM in the app; ciphertext in `google_connections` (RLS on, no policies → service role only). Status is exposed through `google_connection_status()` without the token.
- **Chat / Meet**: the update-3 webhook sender was removed (`postChat` is a stub). The settings page shows *Planned*.
- **AI**: `integration_settings.ai_provider` only allows `none` in this release.

### Open questions for leadership

1. Should BD executives create Drive folders (`drive.folder`)?
2. Which account owns the folders: a Shared Drive (recommended) or a person's My Drive?
3. Is copying Internal/Confidential files into opportunity folders allowed (`copy_internal`), or link only?
4. Who confirms claims about turnover and registrations (restricted)? Today: CEO and CTO only, because VP has no restricted access by default.
