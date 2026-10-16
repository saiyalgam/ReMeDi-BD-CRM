#!/usr/bin/env python3
"""
Propose atomic, cited company claims from an ingest run, for people to confirm.

  python claims.py --out <ingest output folder> [--today 2026-10-16]

Writes claims.jsonl, claims.csv and conflicts.csv.

Rules:
- A claim is one sentence-sized statement copied from a source passage, with the document, locator and a short quote.
- Nothing is invented or paraphrased into a stronger statement. The statement is the source sentence (trimmed).
- Every claim starts with review_status = "pending". The script never marks a claim "validated".
- claim_status is a first guess from the source context:
    contracted  - the source is an MoU / agreement / work order
    submitted   - the source sits in a tender/proposal submission folder or says "submitted"
    proposed    - the source is a proposal, pitch, plan or quotation (an intention, not a fact)
    expired     - a validity/expiry date in the passage is before --today
    delivered   - the passage reports completed work ("conducted", "screened", "deployed", "completed")
    unverified  - anything else (brochures, profiles, decks)
- Claims inherit the document's sensitivity. Excluded documents produce no claims.
- When the same subject (e.g. turnover for one financial year, number of people screened) has different values
  in different documents, all versions are kept and grouped in conflicts.csv for a person to resolve.
"""
import argparse, collections, csv, datetime as dt, glob, gzip, hashlib, json, os, re

PATTERNS = [
    ('certification', re.compile(r'(?i)\b(ISO\s?13485|ISO\s?9001|ISO\s?27001|CE\s?(mark|certif\w*|marking)|CDSCO|manufactur\w*\s+licen[cs]e|MD-?\s?\d{1,2}\b|US\s?FDA|FDA\s?510|BIS\b|IEC\s?60601|IEC\s?62304|ISO\s?14971|NABL|GMP)')),
    ('registration', re.compile(r'(?i)\b(incorporated|CIN\b|udyam|MSME|DPIIT|startup india|12A\b|80G\b|CSR-?1\b|NGO\s?Darpan|FCRA|GSTIN|registered (as|under))')),
    ('financial', re.compile(r'(?i)\b(turnover|revenue|net worth|profit)\b[^.\n]{0,80}(₹|rs\.?|inr|crore|cr\b|lakh|lakhs|\d)')),
    ('reach', re.compile(r'(?i)\b(\d[\d,.]*\s*(\+|lakh|lakhs|million|crore|k\b)?\s*(patients|beneficiaries|people|consultations|screenings|ecgs|tests|villages|centres|centers|clinics|kiosks|health ?camps|districts|states|countries|hospitals|sites))\b')),
    ('performance', re.compile(r'(?i)\b(sensitivity|specificity|accuracy|auc|f1)\b[^.\n]{0,40}\d{1,3}(\.\d+)?\s?%')),
    ('partnership', re.compile(r'(?i)\b(MoU|memorandum of understanding|partnered with|in partnership with|collaboration with|letter of support|empanel\w*)\b')),
    ('deployment', re.compile(r'(?i)\b(deployed|implemented|installed|rolled out|operational|went live|work order|purchase order)\b')),
    ('award', re.compile(r'(?i)\b(award(ed)?|winner|won|grant(ed)? by|selected (for|by)|recogni[sz]ed by)\b')),
]
SUBJECT_KEYS = [
    ('turnover', re.compile(r'(?i)turnover[^.\n]{0,40}(FY|financial year|20\d\d)\s*[-–/]?\s*(\d{2,4})?')),
    ('patients', re.compile(r'(?i)(patients|beneficiaries|consultations|screenings)')),
    ('villages/centres', re.compile(r'(?i)(villages|centres|centers|clinics|kiosks)')),
    ('states', re.compile(r'(?i)\bstates\b')),
    ('countries', re.compile(r'(?i)\bcountries\b')),
]
NUM = re.compile(r'(\d[\d,]*(\.\d+)?)\s*(\+|lakh|lakhs|million|crore|cr|k)?', re.I)
DATE_ANY = re.compile(r'\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b')


def sentences(text):
    text = re.sub(r'\s+', ' ', text)
    return [s.strip() for s in re.split(r'(?<=[.;!?])\s+(?=[A-Z0-9•\-])|\s+•\s+|\s{2,}', text) if 20 <= len(s.strip()) <= 400]


def status_for(doc, passage):
    p = (doc.get('source_path', '') + ' ' + (doc.get('container_path') or '')).lower()
    low = passage.lower()
    if re.search(r'mou|agreement|work order|purchase order', p):
        return 'contracted'
    if re.search(r'bid submission|final docs|signed and stamped|submitted', p) or 'submitted' in low:
        return 'submitted'
    if re.search(r'proposal|pitch|plan|quotation|budget|application|deck', p):
        return 'proposed'
    if re.search(r'\b(conducted|screened|deployed|completed|served|treated|installed)\b', low):
        return 'delivered'
    return 'unverified'


def to_num(s):
    m = NUM.search(s)
    if not m:
        return None
    v = float(m.group(1).replace(',', ''))
    mult = {'lakh': 1e5, 'lakhs': 1e5, 'million': 1e6, 'crore': 1e7, 'cr': 1e7, 'k': 1e3}.get((m.group(3) or '').lower(), 1)
    return v * mult


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--today', default=dt.date.today().isoformat())
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today)
    docs = {}
    for ln in open(os.path.join(a.out, 'documents.jsonl'), encoding='utf-8'):
        r = json.loads(ln); docs[r['doc_uid']] = r
    dupes = set()
    seen_hash = {}
    for r in docs.values():
        h = r.get('sha256')
        if h:
            if h in seen_hash:
                dupes.add(r['doc_uid'])
            else:
                seen_hash[h] = r['doc_uid']
    claims, seen = [], set()
    for f in sorted(glob.glob(os.path.join(a.out, 'chunks-*.jsonl.gz'))):
        for ln in gzip.open(f, 'rt', encoding='utf-8'):
            ch = json.loads(ln)
            d = docs.get(ch['doc_uid'])
            if not d or d.get('sensitivity') == 'Excluded' or ch['doc_uid'] in dupes:
                continue
            if d.get('category') in ('People / HR',):
                continue  # CVs and personal documents are not company claims
            for s in sentences(ch['text']):
                for ctype, rx in PATTERNS:
                    if not rx.search(s):
                        continue
                    key = (ctype, re.sub(r'\W+', ' ', s.lower())[:160])
                    if key in seen:
                        break
                    seen.add(key)
                    st = status_for(d, s)
                    for dd, mm, yy in DATE_ANY.findall(s):
                        try:
                            if re.search(r'(?i)valid|expir|upto|till|until', s) and dt.date(int(yy), int(mm), int(dd)) < today:
                                st = 'expired'
                        except ValueError:
                            pass
                    subj = ''
                    for sk, srx in SUBJECT_KEYS:
                        if ctype in ('financial', 'reach') and srx.search(s):
                            subj = sk
                            if sk == 'turnover':
                                y = re.search(r'(20\d\d)\s*[-–/]\s*(\d{2,4})', s)
                                subj = 'turnover ' + (y.group(0) if y else '?')
                            break
                    cid = 'CLM-' + hashlib.sha1((ch['doc_uid'] + ch['locator'] + s).encode()).hexdigest()[:10].upper()
                    claims.append(dict(claim_uid=cid, claim_type=ctype, statement=s, claim_status=st, review_status='pending',
                                       entity=d.get('entity'), sensitivity=d.get('sensitivity'), doc_uid=ch['doc_uid'],
                                       source_path=d['source_path'], container_path=d.get('container_path'), locator=ch['locator'],
                                       quote=s[:240], subject=subj, value=to_num(s) if subj else None,
                                       confidence='low' if 'ocr' in (d.get('extraction_status') or '') else 'medium'))
                    break
    # conflicts: same entity + subject, different values from different documents
    grp = collections.defaultdict(list)
    for c in claims:
        if c['subject'] and c['value']:
            grp[(c['entity'], c['subject'])].append(c)
    conf_rows = []
    for (ent, subj), g in grp.items():
        vals = {round(c['value'], 2) for c in g}
        docs_in = {c['doc_uid'] for c in g}
        if len(vals) > 1 and len(docs_in) > 1:
            gid = 'CNF-' + hashlib.sha1(f'{ent}|{subj}'.encode()).hexdigest()[:8].upper()
            for c in g:
                c['conflict_group'] = gid
                conf_rows.append(dict(conflict_group=gid, entity=ent, subject=subj, value=c['value'], statement=c['statement'],
                                      source_path=c['source_path'], locator=c['locator'], claim_status=c['claim_status'], sensitivity=c['sensitivity']))
    with open(os.path.join(a.out, 'claims.jsonl'), 'w', encoding='utf-8') as f:
        for c in claims:
            f.write(json.dumps(c, ensure_ascii=False) + '\n')
    cols = ['claim_uid', 'claim_type', 'claim_status', 'review_status', 'entity', 'sensitivity', 'subject', 'value', 'statement', 'source_path', 'container_path', 'locator', 'confidence', 'conflict_group']
    with open(os.path.join(a.out, 'claims.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore'); w.writeheader(); [w.writerow(c) for c in claims]
    with open(os.path.join(a.out, 'conflicts.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['conflict_group', 'entity', 'subject', 'value', 'statement', 'source_path', 'locator', 'claim_status', 'sensitivity'])
        w.writeheader(); [w.writerow(r) for r in sorted(conf_rows, key=lambda r: (r['conflict_group'], r['value']))]
    print(f'{len(claims)} claims, {len({r["conflict_group"] for r in conf_rows})} conflict groups', collections.Counter(c['claim_type'] for c in claims))


if __name__ == '__main__':
    main()
