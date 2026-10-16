#!/usr/bin/env python3
"""
Build the human-readable outputs from an ingest run (documents.jsonl, archive_rows.jsonl):
  manifest.csv, archive_manifest.csv, duplicates.csv, review_queue.csv, summary.md

  python report.py --out <ingest output folder> [--inventory full_inventory.json]

--inventory (optional) is the complete file listing (including files that were deliberately not processed:
code, media, secrets, oversized archives). Those appear in manifest.csv with their reason, so the manifest
accounts for every file and never claims that a skipped file was reviewed.
"""
import argparse, collections, csv, json, os, re


def norm_name(name):
    n = os.path.splitext(name.lower())[0]
    n = re.sub(r'\(\d+\)|copy of|- copy|copy|[_\- ]v\d+(\.\d+)?|rev[\s\-_]*\d+|final|updated|_shoaib reviewed|shoaib reviewed', ' ', n)
    return re.sub(r'[^a-z0-9]+', ' ', n).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--inventory')
    a = ap.parse_args()
    recs = {}
    for ln in open(os.path.join(a.out, 'documents.jsonl'), encoding='utf-8'):
        r = json.loads(ln)
        recs[r['doc_uid']] = r  # last record wins (re-runs)
    rows = list(recs.values())
    top = [r for r in rows if not r.get('container_path')]
    by_path = {r['source_path']: r for r in top}

    # files that were inventoried but not processed
    extra = []
    if a.inventory:
        for it in json.load(open(a.inventory, encoding='utf-8')):
            p = it['path']
            if p in by_path:
                continue
            extra.append(dict(doc_uid='', source_path=p, file_name=os.path.basename(p), file_type=os.path.splitext(p)[1].lstrip('.'),
                              size_bytes=it.get('size'), sha256=it.get('sha256_from', ''), extraction_status=it.get('status', 'not_processed'),
                              sensitivity=it.get('sensitivity', ''), entity='', category=it.get('scope', ''),
                              review_flags=[it.get('reason', '')] if it.get('reason') else []))

    cols = ['doc_uid', 'source_path', 'container_path', 'file_name', 'file_type', 'size_bytes', 'sha256', 'entity', 'category',
            'sensitivity', 'sensitivity_reason', 'crm_visibility', 'extraction_status', 'chars', 'locators', 'version', 'expiry_text',
            'dates_found', 'duplicate_of', 'review_flags', 'extraction_notes', 'processing_version', 'processed_at']

    # exact duplicates by sha256 (only among files actually hashed)
    groups = collections.defaultdict(list)
    for r in rows:
        if r.get('sha256'):
            groups[r['sha256']].append(r)
    dup_rows = []
    for h, g in groups.items():
        if len(g) > 1:
            g.sort(key=lambda r: (bool(r.get('container_path')), '07_CRM_KNOWLEDGE_BASE' in r['source_path'], len(r['source_path'])))
            canon = g[0]
            for r in g[1:]:
                r['duplicate_of'] = canon['doc_uid']
                dup_rows.append(dict(kind='exact (same SHA-256)', canonical=canon['source_path'], canonical_container=canon.get('container_path') or '',
                                     duplicate=r['source_path'], duplicate_container=r.get('container_path') or '', sha256=h, note=''))
    # likely versions: same normalised name, different content
    by_norm = collections.defaultdict(list)
    for r in rows:
        if r.get('sha256'):
            by_norm[(norm_name(r['file_name']), r.get('file_type'))].append(r)
    for k, g in by_norm.items():
        hashes = {r['sha256'] for r in g}
        if len(hashes) > 1 and k[0] and len(k[0]) > 6:
            g.sort(key=lambda r: r['source_path'])
            for r in g[1:]:
                dup_rows.append(dict(kind='possible version (similar name, different content)', canonical=g[0]['source_path'], canonical_container=g[0].get('container_path') or '',
                                     duplicate=r['source_path'], duplicate_container=r.get('container_path') or '', sha256=r['sha256'],
                                     note='Keep both. A person should mark which is current; do not assume the newest name is the approved one.'))
    # name+size inferred duplicates (files not staged because an identical name+size copy was processed)
    if a.inventory:
        for it in json.load(open(a.inventory, encoding='utf-8')):
            if it.get('rep') and it['rep'] in by_path:
                dup_rows.append(dict(kind='likely exact (same name and size; not hashed separately)', canonical=it['rep'], canonical_container='',
                                     duplicate=it['path'], duplicate_container='', sha256=by_path[it['rep']].get('sha256', ''),
                                     note='Hash of this copy was not computed; re-run ingest on the computer to confirm.'))

    def w(name, data, fields):
        with open(os.path.join(a.out, name), 'w', newline='', encoding='utf-8-sig') as f:
            wr = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
            wr.writeheader()
            for d in data:
                d = {k: ('; '.join(map(str, v)) if isinstance(v, list) else v) for k, v in d.items()}
                wr.writerow(d)
    w('manifest.csv', rows + extra, cols)
    w('duplicates.csv', dup_rows, ['kind', 'canonical', 'canonical_container', 'duplicate', 'duplicate_container', 'sha256', 'note'])
    arch = [json.loads(l) for l in open(os.path.join(a.out, 'archive_rows.jsonl'), encoding='utf-8')] if os.path.exists(os.path.join(a.out, 'archive_rows.jsonl')) else []
    w('archive_manifest.csv', arch, ['archive', 'member', 'size', 'status', 'doc_uid'])

    rq = []
    for r in rows:
        fl = r.get('review_flags') or []
        reasons = []
        if r.get('extraction_status') in ('failed', 'no_text', 'not_extracted'):
            reasons.append('text not extracted: ' + '; '.join(r.get('extraction_notes') or [r.get('extraction_status')]))
        if 'ocr_text' in fl:
            reasons.append('OCR text: verify figures against the original')
        if any(f.startswith('pii:') for f in fl):
            reasons.append('identifiers detected (' + [f for f in fl if f.startswith('pii:')][0][4:] + ')')
        if r.get('sensitivity') == 'Excluded':
            reasons.append('Excluded from CRM search: ' + (r.get('sensitivity_reason') or ''))
        if 'entity_unresolved' in fl:
            reasons.append('owning entity not resolved')
        if r.get('expiry_text'):
            reasons.append('validity/expiry stated: ' + r['expiry_text'])
        if reasons:
            rq.append(dict(doc_uid=r['doc_uid'], source_path=r['source_path'], container_path=r.get('container_path') or '',
                           sensitivity=r.get('sensitivity'), reasons=' | '.join(reasons)))
    w('review_queue.csv', rq, ['doc_uid', 'source_path', 'container_path', 'sensitivity', 'reasons'])

    c = lambda key, data: collections.Counter(d.get(key) or '' for d in data)
    md = ['# Knowledge-base ingest summary', '',
          f'- Documents processed (incl. files inside archives): **{len(rows)}** ({len(top)} top-level, {len(rows) - len(top)} inside archives)',
          f'- Inventoried but deliberately not processed: **{len(extra)}** (see manifest.csv, extraction_status column)',
          f'- Exact duplicate copies: **{sum(1 for d in dup_rows if d["kind"].startswith("exact"))}**; likely name+size duplicates not hashed: **{sum(1 for d in dup_rows if d["kind"].startswith("likely"))}**; possible versions: **{sum(1 for d in dup_rows if d["kind"].startswith("possible"))}**',
          f'- Items needing a person: **{len(rq)}** (review_queue.csv)', '',
          '## Extraction outcome', '', '| Status | Count |', '|---|---|'] + [f'| {k} | {v} |' for k, v in c('extraction_status', rows).most_common()] + \
         ['', '## Sensitivity', '', '| Class | Count | Who can see it in the CRM |', '|---|---|---|'] + \
         [f'| {k} | {v} | {dict(Internal="all CRM members", Confidential="all CRM members (internal only)", Restricted="only roles with kb.read_restricted", Excluded="nobody — not loaded").get(k, "")} |' for k, v in c('sensitivity', rows).most_common()] + \
         ['', '## Owning entity', '', '| Entity | Count |', '|---|---|'] + [f'| {k} | {v} |' for k, v in c('entity', rows).most_common()] + \
         ['', '## Not processed (by reason)', '', '| Reason | Count |', '|---|---|'] + [f'| {k} | {v} |' for k, v in c('extraction_status', extra).most_common()] + \
         ['', 'This summary counts what the script did. It does **not** mean every document was reviewed by a person: '
          'claims and classifications are machine-proposed and stay "pending review" until someone confirms them in the CRM.']
    open(os.path.join(a.out, 'summary.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    main()
