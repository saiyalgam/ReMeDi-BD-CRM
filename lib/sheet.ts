// Read .xlsx and .csv files without extra dependencies (works in the browser and in Node 18+).
// XLSX is a zip of XML files: we read the central directory, inflate with DecompressionStream and pick out
// the shared strings and each worksheet's cells. Formulas are read as their last saved value.

export interface Sheet { name: string; rows: string[][] }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(name)) continue;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    files.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return files;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1]!)).join('');

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, ''); let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const get = (n: string) => (files.has(n) ? dec.decode(files.get(n)!) : '');
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]!));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1]!, m[2]!]));
  const relsAlt = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)].map(m => [m[2]!, m[1]!]));
  const sheets: Sheet[] = [];
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\s[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = (rels.get(m[2]!) || relsAlt.get(m[2]!) || '').replace(/^\/?xl\//, '');
    const xml = get('xl/' + target);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\s[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const ri = Number(r[1]) - 1; const cells: string[] = [];
      for (const c of r[2]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!; const body = c[2] || '';
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue;
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 's' && v != null) val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(body);
        else if (v != null) val = unesc(v);
        cells[colIndex(ref)] = val;
      }
      rows[ri] = Array.from(cells, x => x ?? '');
    }
    sheets.push({ name: unesc(m[1]!), rows: Array.from(rows, x => x ?? []) });
  }
  return sheets;
}

export function readCsv(text: string): Sheet[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const delim = (text.split('\n')[0]!.match(/;/g)?.length || 0) > (text.split('\n')[0]!.match(/,/g)?.length || 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name: 'CSV', rows }];
}

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) return readCsv(await file.text());
  if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
  throw new Error('Choose an .xlsx or .csv file. (Old .xls files: open in Excel and save as .xlsx.)');
}
