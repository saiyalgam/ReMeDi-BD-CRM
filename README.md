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

## Using it day to day

- **Needs checking:** open each new lead and mark it *Correct* or *Wrong lead*, or use the ✓ / ✕ buttons in the list. Add a reason when it is wrong, such as "construction only" or "NGO-only". This is the data behind the accuracy table.
- **Assign:** pick an owner from the dropdown on the lead list or the lead page. My leads shows only yours.
- **Stage:** move a lead to *Qualified*, then *Preparing*, then *Submitted*, and finally *Won*, *Lost* or *Dropped*. A lead disappears from the open lists when its deadline passes or it is closed; use *Include closed* to see it again.
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

Then open http://localhost:3000. Demo mode loads the 67 leads from the two search rounds with a few sample teammates, skips login, and stores changes in a temp file on your computer. Never set `DEMO_MODE` on Vercel.

`npm test` runs the unit tests for lead-type detection, crawler-row cleaning and the news reader.

## Free-tier limits to know

- **Vercel Hobby:** runs cron jobs once a day (this app needs one). Its terms are for non-commercial use, so for company use, check whether you need the Pro plan.
- **Supabase Free:** pauses a project after a period of inactivity; daily crawler deliveries normally keep it active.
- Check both providers' current pricing pages, since limits change.
