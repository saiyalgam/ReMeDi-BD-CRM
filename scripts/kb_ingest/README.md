# Knowledge-base ingestion (runs on your own computer)

These scripts read company documents **without changing them**, and write results to a separate output folder
(for example `C:\NCPL\07_CRM_KNOWLEDGE_BASE\ingest_2026-10-16`). Never put the output folder, source documents,
extracted text or keys in this Git repository or in `public/`. `.gitignore` already excludes `kb-output/`.

No AI or embedding service is called. Text stays on your computer until you load it into your own Supabase project.

## Setup

- Python 3.10+: `pip install -r requirements.txt`
- Optional but recommended: Poppler (`pdftotext`, `pdftoppm`) and Tesseract OCR for scanned PDFs and images;
  LibreOffice for old `.doc` / `.xls`. Without them those files are recorded as "not extracted" — never silently skipped.

## Steps

1. **Ingest** (resumable: re-running skips files whose size and date did not change)
   ```
   python ingest.py --root "C:\NCPL" --out "C:\NCPL\07_CRM_KNOWLEDGE_BASE\ingest_YYYY-MM-DD"
   ```
   Folders `.git`, `node_modules`, `__pycache__`, `.venv` are skipped. Key and credential files (`.pem`, `*accessKeys*`,
   recovery codes, `.env`) are listed but **never opened**.
2. **Reports**: `python report.py --out <same folder>` → `manifest.csv`, `archive_manifest.csv`, `duplicates.csv`,
   `review_queue.csv`, `summary.md`.
3. **Claims**: `python claims.py --out <same folder>` → `claims.csv`, `conflicts.csv` (all pending review).
4. **Pipeline workbooks** (read-only): `python compare_pipelines.py --old "...10 July 2026.xlsx" --new "...29 Sep 2026.xlsx" --out <folder>`
5. **Load into Supabase** (after `supabase/update-4.sql`):
   ```
   set SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   set SUPABASE_SECRET_KEY=...        (in this terminal only; never in a file in the repo)
   python load_supabase.py --out <same folder> --dry-run
   python load_supabase.py --out <same folder>
   ```

## Sensitivity classes

| Class | Examples | In the CRM |
|---|---|---|
| Internal | brochures, manuals, product descriptions | all members |
| Confidential | proposals, pricing, technical / regulatory files, business plans | all members (internal only) |
| Restricted | banking, cheques, PAN/GST/registration certificates, turnover, audits, CVs and photos of people, MoUs and agreements | only roles with `kb.read_restricted` |
| Excluded | patient consent forms, patient/ECG data, secrets detected in text | metadata only; no text stored, searched or sent anywhere |

The rules are path- and pattern-based and deliberately conservative. A person must review `review_queue.csv` and can change
a document's class in the CRM. The classification is a proposal, not a guarantee.
