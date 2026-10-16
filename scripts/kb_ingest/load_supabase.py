#!/usr/bin/env python3
"""
Load an ingest run into Supabase (kb_documents, kb_evidence, kb_claims). Run it on your own computer.

  set SUPABASE_URL=https://<project>.supabase.co
  set SUPABASE_SECRET_KEY=<service-role / secret key>      (never commit it, never paste it into the app)
  python load_supabase.py --out <ingest output folder> [--dry-run] [--only-approved-classes Internal,Confidential,Restricted]

What it does:
- Upserts one kb_documents row per document, keyed by the stable doc_uid. New rows are "Draft"; an approval that a
  person already gave in the CRM is never changed.
- Excluded documents (patient-identifiable data, secrets) are loaded as metadata only: Restricted, unsearchable, no text.
- Duplicate copies are loaded as metadata (pointing to the canonical copy) without text, so search shows one result.
- Replaces the text passages of each loaded document (kb_evidence) so a re-run reflects the latest extraction.
- Upserts claims by claim_uid; claims a person has already reviewed are left untouched.
Uses only the Python standard library and talks only to your Supabase project. No AI or embedding service is called.
"""
import argparse, glob, gzip, json, os, sys, urllib.error, urllib.request

DOC_TYPE = {
    'Statutory / registration': 'Registration', 'Financial': 'Financial', 'Proposal / funding': 'Proposal material',
    'Tender response': 'Proposal material', 'Marketing': 'Presentation', 'Product / technical': 'Product',
    'Project experience': 'Project reference', 'Partnership': 'Other', 'People / HR': 'Other', 'Other': 'Other',
}


def doc_type(r):
    if r.get('category') == 'Regulatory / quality':
        return 'Credential / certificate' if any(k in r['file_name'].lower() for k in ('licen', 'certific', 'iso', ' ce ', 'cdsco')) else 'Product'
    return DOC_TYPE.get(r.get('category') or 'Other', 'Other')


class Api:
    def __init__(self, url, key, dry):
        self.url, self.key, self.dry = url.rstrip('/') + '/rest/v1/', key, dry

    def call(self, method, path, body=None, prefer=None):
        if self.dry and method != 'GET':
            return []
        req = urllib.request.Request(self.url + path, method=method, data=None if body is None else json.dumps(body).encode())
        req.add_header('apikey', self.key); req.add_header('Authorization', 'Bearer ' + self.key)
        req.add_header('Content-Type', 'application/json')
        if prefer:
            req.add_header('Prefer', prefer)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                t = res.read().decode()
                return json.loads(t) if t else []
        except urllib.error.HTTPError as e:
            raise SystemExit(f'{method} {path[:80]} failed: {e.code} {e.read().decode()[:400]}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--classes', default='Internal,Confidential,Restricted', help='sensitivity classes whose TEXT is loaded')
    a = ap.parse_args()
    url, key = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL'), os.environ.get('SUPABASE_SECRET_KEY')
    if not (url and key) and not a.dry_run:
        raise SystemExit('Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment (not in a file inside the repo).')
    api = Api(url or 'http://dry-run', key or '', a.dry_run)
    text_classes = set(a.classes.split(','))
    recs = {}
    for ln in open(os.path.join(a.out, 'documents.jsonl'), encoding='utf-8'):
        r = json.loads(ln); recs[r['doc_uid']] = r
    # canonical copy per SHA-256
    canon = {}
    for r in sorted(recs.values(), key=lambda r: (bool(r.get('container_path')), '07_CRM_KNOWLEDGE_BASE' in r['source_path'], len(r['source_path']))):
        if r.get('sha256') and r['sha256'] not in canon:
            canon[r['sha256']] = r['doc_uid']
    rows, text_ok = [], set()
    for r in recs.values():
        sens = r.get('sensitivity') or 'Restricted'
        excluded = sens == 'Excluded'
        dup = r.get('sha256') and canon.get(r['sha256']) != r['doc_uid']
        conf = 'Restricted' if excluded else sens
        rows.append(dict(
            doc_uid=r['doc_uid'], name=r['file_name'][:300], entity=r.get('entity') or 'Unresolved', doc_type=doc_type(r),
            confidentiality=conf, version=r.get('version'), expiry_text=r.get('expiry_text'),
            location=(r.get('container_path') + ' :: ' if r.get('container_path') else '') + r['source_path'],
            source_path=r['source_path'], container_path=r.get('container_path'), file_name=r['file_name'], file_type=r.get('file_type'),
            size_bytes=r.get('size_bytes'), sha256=r.get('sha256'), category=r.get('category'), sensitivity_reason=r.get('sensitivity_reason'),
            extraction_status=r.get('extraction_status'), extraction_notes='; '.join(r.get('extraction_notes') or [])[:2000] or None,
            processing_version=r.get('processing_version'), processed_at=r.get('processed_at'), review_flags=r.get('review_flags') or [],
            duplicate_of_uid=canon.get(r['sha256']) if dup else None, searchable=not excluded and not dup,
            excluded_reason=(r.get('sensitivity_reason') or 'excluded') if excluded else None))
        if not excluded and not dup and sens in text_classes:
            text_ok.add(r['doc_uid'])
    print(f'{len(rows)} documents; text will be loaded for {len(text_ok)}', file=sys.stderr)
    ids = {}
    for i in range(0, len(rows), 200):
        res = api.call('POST', 'kb_documents?on_conflict=doc_uid&select=id,doc_uid', rows[i:i + 200], 'resolution=merge-duplicates,return=representation')
        for x in res or []:
            ids[x['doc_uid']] = x['id']
    if a.dry_run:
        ids = {u: n for n, u in enumerate(recs, 1)}
    # evidence
    by_doc = {}
    for f in sorted(glob.glob(os.path.join(a.out, 'chunks-*.jsonl.gz'))):
        for ln in gzip.open(f, 'rt', encoding='utf-8'):
            c = json.loads(ln)
            if c['doc_uid'] in text_ok:
                by_doc.setdefault(c['doc_uid'], []).append(c)
    n = 0
    batch = []
    for uid, cs in by_doc.items():
        did = ids.get(uid)
        if not did:
            continue
        api.call('DELETE', f'kb_evidence?document_id=eq.{did}')
        ocr = any('ocr' in (recs[uid].get('extraction_status') or '') for _ in [0])
        for c in cs:
            batch.append(dict(document_id=did, locator=c['locator'][:300], body=c['text'], confidentiality=recs[uid]['sensitivity'], ocr=ocr))
            if len(batch) >= 500:
                api.call('POST', 'kb_evidence', batch, 'return=minimal'); n += len(batch); batch = []
    if batch:
        api.call('POST', 'kb_evidence', batch, 'return=minimal'); n += len(batch)
    print(f'{n} evidence passages loaded', file=sys.stderr)
    # claims (skip ones a person already reviewed)
    cp = os.path.join(a.out, 'claims.jsonl')
    if os.path.exists(cp):
        reviewed = set()
        if not a.dry_run:
            off = 0
            while True:
                part = api.call('GET', f'kb_claims?select=claim_uid&review_status=neq.pending&limit=1000&offset={off}')
                reviewed |= {x['claim_uid'] for x in part}
                if len(part) < 1000:
                    break
                off += 1000
        out = []
        for ln in open(cp, encoding='utf-8'):
            c = json.loads(ln)
            if c['claim_uid'] in reviewed or c['doc_uid'] not in ids or c['doc_uid'] not in text_ok:
                continue
            out.append(dict(claim_uid=c['claim_uid'], document_id=ids[c['doc_uid']], claim_type=c['claim_type'], statement=c['statement'][:1000],
                            claim_status=c['claim_status'], review_status='pending', entity=c.get('entity'),
                            confidentiality=c.get('sensitivity') if c.get('sensitivity') in ('Internal', 'Confidential', 'Restricted') else 'Restricted',
                            locator=c.get('locator'), quote=(c.get('quote') or '')[:300], subject=c.get('subject') or None, value=c.get('value'),
                            conflict_group=c.get('conflict_group'), confidence=c.get('confidence')))
        for i in range(0, len(out), 500):
            api.call('POST', 'kb_claims?on_conflict=claim_uid', out[i:i + 500], 'resolution=merge-duplicates,return=minimal')
        print(f'{len(out)} claims loaded ({len(reviewed)} already reviewed and left unchanged)', file=sys.stderr)
    print('dry run: nothing was sent' if a.dry_run else 'done', file=sys.stderr)


if __name__ == '__main__':
    main()
