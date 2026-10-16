#!/usr/bin/env python3
"""
ReMeDi CRM knowledge-base ingestion (local, resumable).

Reads a folder of company documents WITHOUT changing them and writes, to a separate output folder:
  documents.jsonl        one provenance record per file (path, SHA-256, type, size, entity, category,
                         sensitivity, extraction outcome, dates, flags)
  manifest.csv           the same records as a spreadsheet-friendly table
  archive_manifest.csv   every member of every .zip that was opened (and why others were not)
  duplicates.csv         exact duplicates (same SHA-256) and likely versions (same normalised name)
  chunks-NNN.jsonl.gz    extracted text in small passages with a locator (page / sheet+rows / slide / paragraph)
                         -- only for documents whose sensitivity allows text to be kept (never "Excluded")
  review_queue.csv       everything a person must look at (failed extraction, OCR, PII hits, unresolved entity ...)
  state.json             resume state: a file is skipped on the next run if path+size+mtime are unchanged

Nothing is uploaded anywhere. No AI/LLM or embedding service is called. Load the results into Supabase
separately with load_supabase.py (which skips Excluded documents and never sends text to a third party).

Usage:
  python ingest.py --root "C:\\NCPL" --out "C:\\NCPL\\07_CRM_KNOWLEDGE_BASE\\ingest_YYYY-MM-DD" [--inventory files.json]
                   [--ocr/--no-ocr] [--max-ocr-pages 25] [--workers 2]

Optional tools: poppler (pdftotext, pdftoppm), tesseract (OCR), LibreOffice (old .doc/.xls).
Python packages: pypdf, python-docx, openpyxl, python-pptx (pip install -r requirements.txt).
"""
from __future__ import annotations
import argparse, csv, datetime as dt, gzip, hashlib, io, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed

PROCESSING_VERSION = "kb-ingest/1.0"
CHUNK_CHARS = 1200

DOC_EXT = {'.pdf', '.docx', '.doc', '.xlsx', '.xlsm', '.xls', '.pptx', '.ppt', '.csv', '.md', '.txt', '.rtf', '.odt', '.ods', '.odp', '.page', '.pptd'}
IMG_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp'}
ARC_EXT = {'.zip'}
MEDIA_EXT = {'.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.m4a'}
DESIGN_EXT = {'.svg', '.fig', '.psd', '.ai', '.sketch', '.xd', '.cdr', '.indd', '.dwg', '.step', '.stp', '.stl'}
SECRET_NAME = re.compile(r'(\.pem$|\.key$|\.p12$|\.pfx$|accesskeys|recovery-codes|credentials|(^|/)\.env$|id_rsa)', re.I)
CODE_DIR = re.compile(r'/(\.git|node_modules|__pycache__|\.venv|venv|neurokit2|site-packages)/', re.I)

# ---------------------------------------------------------------- classification rules
# Order matters: the first matching rule wins for each axis. Rules look at the relative path (lower case)
# and, for sensitivity, also at the extracted text. They are deliberately conservative.
ENTITY_RULES = [
    (r'rkf|raj kumari|deedpublictrust|ngodarpan|odishaofficeproof|board of trustees|aarohan|arohan', 'RKF'),
    (r'remedi foundation|remedi_foundation', 'ReMeDi Foundation'),
    (r'partner_documents|partner documents|/mou[ _-]|mou_|letters of support', 'Partner'),
    (r'neurosynaptic|ncpl|company_docs|company docs|01_products|03_quality|cardivu|remedi nova|remedi_nova|product tech file|spirometer|nur|stethe?scope|optical reader', 'NCPL'),
]
CATEGORY_RULES = [
    (r'tender|rfp|eoi|annexure|bid submission|gem|cppp', 'Tender response'),
    (r'proposal|funding|grant|csr|pitch|business_development|business development', 'Proposal / funding'),
    (r'financial|turnover|audit report|balance sheet|budget|sanction letter|cheque|banking', 'Financial'),
    (r'gst|pan|udyam|incorporation|epfo|esic|darpan|deed|registration|statutory|resolution', 'Statutory / registration'),
    (r'licen[cs]e|ce certificate|iso 13485|cdsco|regulatory|qms|quality|dhf|risk management|verification|validation|usability|gspr|ifu', 'Regulatory / quality'),
    (r'cv|resume|degree|marks ?card|team cvs|photograph|personnel', 'People / HR'),
    (r'mou|agreement|letter of support|partner', 'Partnership'),
    (r'brochure|flyer|marketing|presentation|deck|slides|annual_day|images', 'Marketing'),
    (r'architecture|hld|api|sdk|technical|design|srs|urd|software', 'Product / technical'),
    (r'project experience|case stud|report|deployment|camp', 'Project experience'),
]
SENS_PATH_RULES = [
    # Excluded: never keep text, never index
    (r'patient informed consent|icf\)|mock ecg|tricog|mimic|ecgrawdata|ecgvalue|patient data|clinical study plan, hospital approval', 'Excluded', 'patient-related clinical material'),
    # Restricted: banking, statutory identifiers, financial statements, people/HR, partner-confidential agreements
    (r'cheque|bank detail|bank account|banking|bank statement|ifsc|sanction letter|authori[sz]ed signatory|mandate ?form', 'Restricted', 'banking'),
    (r'turnover|audit report|auditor|balance sheet|financial statement|itr|financial informations|financial_proposal|financial proposal|detailed budget|project budget|financial model', 'Restricted', 'financial'),
    (r'gst|(^|[^a-z])pan([^a-z]|$)|pancertificate|udyam|incorporation|epfo|esic|darpan|deed|resolution of board|statutory|stamp paper|indemnity|office ?proof', 'Restricted', 'statutory / identity'),
    (r'(^|[^a-z])cv([^a-z]|$)|resume|degree|marks ?card|team cvs|photograph|qualified personnel|whatsapp image .*rkf|applicant team', 'Restricted', 'personal / HR'),
    (r'mou|memorandum of understanding|agreement|letter of support|ear agreement', 'Restricted', 'partner-confidential agreement'),
    # Confidential: internal business material that is not for every partner but fine for the CRM team
    (r'proposal|pitch|business plan|pricing|quotation|commercial|strategy|dhf|risk|technical file|srs|architecture|qms|validation|verification|design', 'Confidential', 'internal business / technical'),
]
TEXT_PII = {
    'aadhaar': re.compile(r'\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b'),
    'pan': re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b'),
    'ifsc': re.compile(r'\b[A-Z]{4}0[A-Z0-9]{6}\b'),
    'bank_account': re.compile(r'(?i)\b(a/?c|account)\s*(no\.?|number)?\s*[:\-]?\s*\d{9,18}\b'),
    'abha': re.compile(r'(?i)\babha\b[^\n]{0,30}\d{2}-\d{4}-\d{4}-\d{4}'),
    'private_key': re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    'aws_key': re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
}
PATIENT_TEXT = re.compile(r'(?i)(patient\s*name\s*[:\-]\s*[A-Z][a-z]+|uhid\s*[:\-]?\s*\d|mrn\s*[:\-]?\s*\d|date of birth\s*[:\-]\s*\d)')
DATE_RE = re.compile(r'\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|19\d{2})\b')
EXPIRY_RE = re.compile(r'(?i)(valid\s*(up\s*to|upto|till|until|thru|through)|expir(y|es|ation)\s*(date)?|date of expiry)\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9},?\s+[0-9]{4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})')
VERSION_RE = re.compile(r'(?i)\b(rev[\s\-_]*\d{1,3}|v\s?\d+(\.\d+)*|version\s*\d+(\.\d+)*)\b')


def first_match(rules, s):
    for pat, val, *rest in rules:
        if re.search(pat, s, re.I):
            return (val, rest[0] if rest else '')
    return (None, '')


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def stable_id(rel):
    return 'DOC-' + hashlib.sha1(rel.replace('\\', '/').lower().encode()).hexdigest()[:12].upper()


def norm_name(name):
    n = os.path.splitext(name.lower())[0]
    n = re.sub(r'\(\d+\)|copy of|copy|[_\-]?v\d+(\.\d+)?|rev[\s\-_]*\d+|final|updated|\s+', ' ', n)
    return re.sub(r'[^a-z0-9]+', ' ', n).strip()

# ---------------------------------------------------------------- extractors -> list of (locator, text)

def run(cmd, timeout=180):
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def ocr_png(png):
    r = run(['tesseract', png, '-', '--psm', '3', '-l', 'eng'], timeout=120)
    return r.stdout.decode('utf-8', 'ignore')


def extract_pdf(p, use_ocr, max_ocr):
    parts, notes = [], []
    pages = None
    if shutil.which('pdftotext'):
        r = run(['pdftotext', '-layout', '-enc', 'UTF-8', p, '-'])
        if r.returncode == 0:
            pages = r.stdout.decode('utf-8', 'ignore').split('\f')
            if pages and not pages[-1].strip():
                pages = pages[:-1]
        else:
            notes.append('pdftotext failed: ' + r.stderr.decode('utf-8', 'ignore')[:120])
    if pages is None:
        from pypdf import PdfReader
        rd = PdfReader(p)
        if rd.is_encrypted:
            try:
                rd.decrypt('')
            except Exception:
                return [], ['encrypted PDF'], 'failed'
        pages = [(pg.extract_text() or '') for pg in rd.pages]
    ocr_done = 0
    method = 'text'
    for i, t in enumerate(pages, 1):
        if len(t.strip()) < 40 and use_ocr and shutil.which('pdftoppm') and shutil.which('tesseract'):
            if ocr_done < max_ocr:
                with tempfile.TemporaryDirectory() as td:
                    base = os.path.join(td, 'pg')
                    run(['pdftoppm', '-f', str(i), '-l', str(i), '-r', '150', '-png', p, base])
                    pngs = [os.path.join(td, f) for f in os.listdir(td) if f.endswith('.png')]
                    if pngs:
                        t = ocr_png(pngs[0]); ocr_done += 1; method = 'text+ocr'
            else:
                notes.append(f'page {i}: no text layer and OCR page limit reached')
        if t.strip():
            parts.append((f'page {i}', t))
    if ocr_done:
        notes.append(f'OCR used on {ocr_done} page(s): check accuracy before relying on figures')
    return parts, notes, method if parts else ('no_text' if pages else 'failed')


def extract_docx(p):
    import docx
    d = docx.Document(p)
    parts, buf, head, n = [], [], 'start', 0
    for para in d.paragraphs:
        t = para.text.strip()
        if not t:
            continue
        n += 1
        if para.style is not None and para.style.name.lower().startswith('heading'):
            if buf:
                parts.append((f'section "{head[:60]}"', '\n'.join(buf))); buf = []
            head = t
        buf.append(t)
    if buf:
        parts.append((f'section "{head[:60]}"', '\n'.join(buf)))
    for ti, tbl in enumerate(d.tables, 1):
        rows = []
        for r in tbl.rows:
            cells = []
            for c in r.cells:
                v = c.text.strip()
                if not cells or cells[-1] != v:
                    cells.append(v)
            rows.append(' | '.join(cells))
        if rows:
            parts.append((f'table {ti}', '\n'.join(rows)))
    return parts, [], 'text' if parts else 'no_text'


def extract_xlsx(p):
    import openpyxl
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    parts = []
    for ws in wb.worksheets:
        rows, start = [], None
        for ri, row in enumerate(ws.iter_rows(values_only=True), 1):
            vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
            if not vals:
                continue
            start = start or ri
            rows.append(f'r{ri}: ' + ' | '.join(vals))
            if sum(len(x) for x in rows) > CHUNK_CHARS * 4:
                parts.append((f'sheet "{ws.title}" rows {start}-{ri}', '\n'.join(rows))); rows, start = [], None
        if rows:
            parts.append((f'sheet "{ws.title}" rows {start}-{ri}', '\n'.join(rows)))
    return parts, [], 'text' if parts else 'no_text'


def extract_pptx(p):
    from pptx import Presentation
    pr = Presentation(p)
    parts = []
    for si, s in enumerate(pr.slides, 1):
        txt = []
        for sh in s.shapes:
            if sh.has_text_frame:
                txt.append(sh.text_frame.text)
            if getattr(sh, 'has_table', False) and sh.has_table:
                for r in sh.table.rows:
                    txt.append(' | '.join(c.text for c in r.cells))
        if s.has_notes_slide and s.notes_slide.notes_text_frame is not None:
            nt = s.notes_slide.notes_text_frame.text.strip()
            if nt:
                txt.append('[notes] ' + nt)
        t = '\n'.join(x for x in txt if x.strip())
        if t:
            parts.append((f'slide {si}', t))
    return parts, [], 'text' if parts else 'no_text'


def extract_plain(p):
    with open(p, 'rb') as f:
        raw = f.read(5_000_000)
    t = raw.decode('utf-8', 'ignore')
    lines = t.splitlines()
    parts, buf, start = [], [], 1
    for i, ln in enumerate(lines, 1):
        buf.append(ln)
        if sum(len(x) for x in buf) > CHUNK_CHARS:
            parts.append((f'lines {start}-{i}', '\n'.join(buf))); buf, start = [], i + 1
    if buf and ''.join(buf).strip():
        parts.append((f'lines {start}-{len(lines)}', '\n'.join(buf)))
    return parts, [], 'text' if parts else 'no_text'


def convert_with_soffice(p, fmt):
    office = shutil.which('soffice') or shutil.which('libreoffice')
    if not office:
        return None
    td = tempfile.mkdtemp()
    run([office, '--headless', '--convert-to', fmt, '--outdir', td, p], timeout=240)
    out = [os.path.join(td, f) for f in os.listdir(td)]
    return out[0] if out else None


def extract_image(p, use_ocr):
    if not (use_ocr and shutil.which('tesseract')):
        return [], ['image: OCR not available'], 'not_extracted'
    if os.path.getsize(p) > 8_000_000:
        return [], ['large image (likely photograph): OCR skipped'], 'not_extracted'
    t = ocr_png(p)
    if len(t.strip()) < 25:
        return [], ['image: no readable text found by OCR'], 'no_text'
    return [('image (OCR)', t)], ['OCR text: check accuracy'], 'ocr'


def extract_any(p, ext, use_ocr, max_ocr):
    if ext == '.pdf':
        return extract_pdf(p, use_ocr, max_ocr)
    if ext == '.docx':
        return extract_docx(p)
    if ext in ('.xlsx', '.xlsm'):
        return extract_xlsx(p)
    if ext == '.pptx':
        return extract_pptx(p)
    if ext in ('.doc', '.rtf', '.odt'):
        c = convert_with_soffice(p, 'docx')
        if not c:
            return [], [f'{ext}: LibreOffice not available'], 'not_extracted'
        r = extract_docx(c); r[1].append(f'converted from {ext} with LibreOffice'); return r
    if ext in ('.xls', '.ods'):
        c = convert_with_soffice(p, 'xlsx')
        if not c:
            return [], [f'{ext}: LibreOffice not available'], 'not_extracted'
        r = extract_xlsx(c); r[1].append(f'converted from {ext} with LibreOffice'); return r
    if ext in ('.ppt', '.odp'):
        c = convert_with_soffice(p, 'pptx')
        if not c:
            return [], [f'{ext}: LibreOffice not available'], 'not_extracted'
        return extract_pptx(c)
    if ext in ('.csv', '.md', '.txt', '.page', '.pptd', ''):
        return extract_plain(p)
    if ext in IMG_EXT:
        return extract_image(p, use_ocr)
    return [], [f'{ext or "no extension"}: no extractor'], 'not_extracted'

# ---------------------------------------------------------------- one file

def classify(rel, text):
    low = rel.lower().replace('\\', '/')
    entity, _ = first_match(ENTITY_RULES, low)
    if not entity and text:
        tl = text[:20000].lower()
        if 'neurosynaptic' in tl:
            entity = 'NCPL'
        elif 'remedi foundation' in tl:
            entity = 'ReMeDi Foundation'
    category, _ = first_match(CATEGORY_RULES, low)
    sens, why = first_match(SENS_PATH_RULES, low)
    flags = []
    pii = {}
    if text:
        for k, rx in TEXT_PII.items():
            c = len(rx.findall(text))
            if c:
                pii[k] = c
        if PATIENT_TEXT.search(text):
            pii['patient_identifier_pattern'] = 1
    if pii.get('private_key') or pii.get('aws_key'):
        sens, why = 'Excluded', 'secret material detected in text'
    elif pii.get('patient_identifier_pattern') or pii.get('abha'):
        sens, why = 'Excluded', 'possible patient-identifiable data detected'
    elif (pii.get('aadhaar') or pii.get('bank_account') or pii.get('ifsc')) and sens not in ('Excluded',):
        sens, why = 'Restricted', why or 'personal / banking identifiers detected in text'
    elif pii.get('pan') and sens not in ('Excluded', 'Restricted'):
        sens, why = 'Restricted', 'PAN-like identifier detected in text'
    if not sens:
        sens, why = 'Internal', 'default'
    if pii:
        flags.append('pii:' + ','.join(f'{k}={v}' for k, v in sorted(pii.items())))
    if not entity:
        entity = 'Unresolved'; flags.append('entity_unresolved')
    return entity, category or 'Other', sens, why, flags


def doc_meta(rel, text):
    m = {}
    v = VERSION_RE.search(os.path.basename(rel)) or (VERSION_RE.search(text[:3000]) if text else None)
    if v:
        m['version'] = v.group(0)
    if text:
        e = EXPIRY_RE.search(text)
        if e:
            m['expiry_text'] = e.group(5)
        ds = []
        for d, mo, y in DATE_RE.findall(text[:30000]):
            try:
                ds.append(dt.date(int(y), int(mo), int(d)).isoformat())
            except ValueError:
                pass
        if ds:
            m['dates_found'] = sorted(set(ds))[:12]
    return m


def process_file(abs_path, rel, opts, container=None):
    ext = os.path.splitext(rel)[1].lower()
    rec = dict(doc_uid=stable_id((container + '::' if container else '') + rel), source_path=rel,
               container_path=container, file_name=os.path.basename(rel), file_type=ext.lstrip('.') or 'none',
               size_bytes=None, sha256=None, processing_version=PROCESSING_VERSION,
               processed_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'))
    if SECRET_NAME.search(rel.replace('\\', '/')):
        rec.update(extraction_status='skipped_secret', sensitivity='Excluded', sensitivity_reason='credential / key file: never opened',
                   entity='Unresolved', category='Secret', review_flags=['secret_file_not_opened'])
        return rec, []
    try:
        rec['size_bytes'] = os.path.getsize(abs_path)
        rec['sha256'] = sha256_file(abs_path)
    except OSError as e:
        rec.update(extraction_status='failed', error=str(e)[:200], review_flags=['unreadable'])
        return rec, []
    parts, notes, status = [], [], 'not_extracted'
    if ext in ARC_EXT:
        status = 'archive'
    elif ext in MEDIA_EXT:
        notes.append('audio/video: not transcribed'); status = 'skipped_media'
    elif ext in DESIGN_EXT:
        notes.append('design file: listed only'); status = 'design_reference'
    else:
        try:
            parts, notes, status = extract_any(abs_path, ext, opts['ocr'], opts['max_ocr'])
        except Exception as e:  # keep going; record the failure honestly
            status, notes = 'failed', [f'{type(e).__name__}: {str(e)[:160]}']
    text = '\n'.join(t for _, t in parts)
    entity, category, sens, why, flags = classify(rel if not container else container + '/' + rel, text)
    rec.update(entity=entity, category=category, sensitivity=sens, sensitivity_reason=why,
               extraction_status=status, extraction_notes=notes, chars=len(text), locators=len(parts), **doc_meta(rel, text))
    if status in ('failed', 'no_text'):
        flags.append('needs_manual_review')
    if any('OCR' in n for n in notes):
        flags.append('ocr_text')
    rec['review_flags'] = flags
    rec['crm_visibility'] = {'Internal': 'all_members', 'Confidential': 'all_members', 'Restricted': 'kb.read_restricted', 'Excluded': 'none'}[sens]
    chunks = []
    if sens != 'Excluded':
        for loc, t in parts:
            t = re.sub(r'[ \t]+', ' ', t).strip()
            for i in range(0, len(t), CHUNK_CHARS):
                piece = t[i:i + CHUNK_CHARS]
                if piece.strip():
                    chunks.append(dict(doc_uid=rec['doc_uid'], locator=loc + (f' (part {i // CHUNK_CHARS + 1})' if len(t) > CHUNK_CHARS else ''),
                                       text=piece, sensitivity=sens))
    return rec, chunks


def process_archive(abs_path, rel, opts, out_rows):
    """Open a zip, record every member, extract and process document members. Returns list of (rec, chunks)."""
    results = []
    try:
        zf = zipfile.ZipFile(abs_path)
    except Exception as e:
        out_rows.append(dict(archive=rel, member='', size=0, status='failed: ' + str(e)[:100]))
        return results
    with tempfile.TemporaryDirectory() as td:
        for zi in zf.infolist():
            if zi.is_dir():
                continue
            name = zi.filename
            ext = os.path.splitext(name)[1].lower()
            row = dict(archive=rel, member=name, size=zi.file_size, status='')
            if SECRET_NAME.search(name):
                row['status'] = 'secret: not extracted'
            elif ext in MEDIA_EXT or CODE_DIR.search('/' + name):
                row['status'] = 'listed only (media/code)'
            elif zi.file_size > 200_000_000:
                row['status'] = 'listed only (over 200 MB)'
            elif ext in DOC_EXT | IMG_EXT:
                safe = os.path.join(td, hashlib.sha1(name.encode()).hexdigest() + ext)
                with zf.open(zi) as src, open(safe, 'wb') as dst:
                    shutil.copyfileobj(src, dst)
                rec, ch = process_file(safe, name, opts, container=rel)
                os.remove(safe)
                row['status'] = 'processed: ' + rec.get('extraction_status', '')
                row['doc_uid'] = rec['doc_uid']
                results.append((rec, ch))
            else:
                row['status'] = 'listed only (type not extracted)'
            out_rows.append(row)
    return results


def _worker(args):
    abs_path, rel, opts = args
    ext = os.path.splitext(rel)[1].lower()
    arch_rows = []
    rec, ch = process_file(abs_path, rel, opts)
    inner = []
    if ext in ARC_EXT and rec.get('sha256') and rec.get('sensitivity') != 'Excluded':
        inner = process_archive(abs_path, rel, opts, arch_rows)
        rec['archive_members'] = len(arch_rows)
    elif ext in ARC_EXT:
        arch_rows.append(dict(archive=rel, member='', size=0, status='archive not opened: ' + rec.get('sensitivity_reason', '')))
    return rec, ch, inner, arch_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--inventory', help='JSON list of {"path": relative path, ...}; default: walk --root')
    ap.add_argument('--ocr', dest='ocr', action='store_true', default=True)
    ap.add_argument('--no-ocr', dest='ocr', action='store_false')
    ap.add_argument('--max-ocr-pages', type=int, default=25)
    ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    opts = dict(ocr=a.ocr, max_ocr=a.max_ocr_pages)
    state_p = os.path.join(a.out, 'state.json')
    state = json.load(open(state_p)) if os.path.exists(state_p) else {}
    if a.inventory:
        rels = [r['path'] if isinstance(r, dict) else r for r in json.load(open(a.inventory, encoding='utf-8'))]
    else:
        rels = []
        for d, dirs, fs in os.walk(a.root):
            dirs[:] = [x for x in dirs if x not in ('.git', 'node_modules', '__pycache__', '.venv')]
            for f in fs:
                rels.append(os.path.relpath(os.path.join(d, f), a.root).replace('\\', '/'))
    recs_p = os.path.join(a.out, 'documents.jsonl')
    arch_p = os.path.join(a.out, 'archive_rows.jsonl')
    todo = []
    for rel in rels:
        ap_ = os.path.join(a.root, rel)
        if not os.path.exists(ap_):
            continue
        st = os.stat(ap_)
        key = f'{st.st_size}:{int(st.st_mtime)}'
        if state.get(rel) == key:
            continue
        todo.append((ap_, rel, opts, key))
    print(f'{len(rels)} files listed, {len(todo)} to process', file=sys.stderr)
    chunk_idx = len([f for f in os.listdir(a.out) if f.startswith('chunks-')])
    cbuf, done = [], 0

    def flush(force=False):
        nonlocal cbuf, chunk_idx
        if cbuf and (force or len(cbuf) >= 20000):
            with gzip.open(os.path.join(a.out, f'chunks-{chunk_idx:03d}.jsonl.gz'), 'wt', encoding='utf-8') as f:
                for c in cbuf:
                    f.write(json.dumps(c, ensure_ascii=False) + '\n')
            chunk_idx += 1; cbuf = []
            json.dump(state, open(state_p, 'w'))
    with ProcessPoolExecutor(max_workers=a.workers) as ex, open(recs_p, 'a', encoding='utf-8') as rf, open(arch_p, 'a', encoding='utf-8') as af:
        futs = {ex.submit(_worker, t[:3]): t for t in todo}
        for fu in as_completed(futs):
            t = futs[fu]
            try:
                rec, ch, inner, arows = fu.result()
            except Exception as e:
                rec, ch, inner, arows = dict(doc_uid=stable_id(t[1]), source_path=t[1], extraction_status='failed', error=str(e)[:200], review_flags=['worker_failed']), [], [], []
            rf.write(json.dumps(rec, ensure_ascii=False) + '\n'); cbuf += ch
            for r2, c2 in inner:
                rf.write(json.dumps(r2, ensure_ascii=False) + '\n'); cbuf += c2
            for r3 in arows:
                af.write(json.dumps(r3, ensure_ascii=False) + '\n')
            state[t[1]] = t[3]
            done += 1
            if done % 25 == 0:
                rf.flush(); af.flush(); print(f'  {done}/{len(todo)}', file=sys.stderr)
                flush()
                json.dump(state, open(state_p, 'w'))
    flush(force=True)
    json.dump(state, open(state_p, 'w'))
    print('done; run report.py next', file=sys.stderr)


if __name__ == '__main__':
    main()
