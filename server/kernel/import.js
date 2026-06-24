// Horrorgeticon Ops — Universal-Import
// Wandelt praktisch jede Quelle in ein einheitliches { header, rows } um:
//   • Excel (.xlsx)          — direkt geparst (ZIP + XML), ohne Fremdbibliothek
//   • Excel-Copy/Paste (TSV) — Tab-getrennt
//   • CSV (; oder ,) · Pipe  — Trennzeichen wird automatisch erkannt
//   • HTML-Tabellen          — aus Webseite/E-Mail kopiert
//   • E-Mail (.eml) & Freitext — Namen, E-Mails, Telefonnummern werden heuristisch extrahiert
import zlib from 'node:zlib';
import { parseCsv } from './csv.js';

// ─── XML-Helfer ──────────────────────────────────────────────────────────────
function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
function stripTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(td|th|tr|p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

// ─── ZIP-Leser (Central Directory) — nur was wir brauchen ──────────────────────
function readZipEntries(buf) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine ZIP-/XLSX-Struktur erkannt');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Nur die XML-Teile, die wir auswerten — spart Speicher bei großen Dateien
    if (/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/.+\.xml)$/.test(name)) {
      const lhNameLen = buf.readUInt16LE(localOff + 26);
      const lhExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      try {
        entries[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
      } catch { /* einzelnen Teil überspringen */ }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function colToIndex(ref) {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  const out = [];
  const reSi = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = reSi.exec(xml))) {
    let text = '';
    const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = reT.exec(m[1]))) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

function parseSheet(xml, shared) {
  const grid = [];
  const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let r;
  while ((r = reRow.exec(xml))) {
    const cells = [];
    const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c, auto = 0;
    while ((c = reC.exec(r[1]))) {
      const attrs = c[1] || '', body = c[2] || '';
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      const col = refM ? colToIndex(refM[1]) : auto;
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let val = '';
      if (type === 's') {
        const vi = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        val = vi != null ? (shared[Number(vi)] ?? '') : '';
      } else if (type === 'inlineStr') {
        let t; const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        while ((t = reT.exec(body))) val += t[1];
        val = decodeXml(val);
      } else {
        val = decodeXml((body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1] || '');
      }
      cells[col] = val;
      auto = col + 1;
    }
    grid.push(cells);
  }
  return grid;
}

function gridToHeaderRows(grid) {
  // sparse → dicht, führende Leerzeilen weg, erste belegte Zeile = Kopf
  const dense = grid.map((row) => {
    const out = [];
    for (let i = 0; i < row.length; i++) out.push((row[i] ?? '').toString());
    return out;
  });
  const width = dense.reduce((w, r) => Math.max(w, r.length), 0);
  const norm = dense.map((r) => { while (r.length < width) r.push(''); return r; })
    .filter((r) => r.some((c) => c.trim() !== ''));
  const header = (norm.shift() || []).map((h) => h.trim());
  return { header, rows: norm };
}

export function parseXlsx(buf) {
  const entries = readZipEntries(buf);
  const shared = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8') || '');
  const sheetKey = Object.keys(entries).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k))
    || Object.keys(entries).find((k) => /^xl\/worksheets\/.+\.xml$/.test(k));
  if (!sheetKey) throw new Error('Keine Tabelle in der Excel-Datei gefunden');
  const grid = parseSheet(entries[sheetKey].toString('utf8'), shared);
  return gridToHeaderRows(grid);
}

// ─── HTML-Tabelle ──────────────────────────────────────────────────────────────
export function parseHtmlTable(html) {
  const tableM = html.match(/<table\b[\s\S]*?<\/table>/i);
  const table = tableM ? tableM[0] : html;
  const rows = [];
  const reTr = /<tr\b[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = reTr.exec(table))) {
    const cells = [];
    const reTd = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let td;
    while ((td = reTd.exec(tr[0]))) cells.push(stripTags(decodeXml(td[2])).trim());
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  const header = (rows.shift() || []).map((h) => h.trim());
  return { header, rows };
}

// ─── Freitext / E-Mail-Körper ───────────────────────────────────────────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s/().-]{6,}\d)/;

export function parseFreeText(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const email = (line.match(EMAIL_RE) || [])[0] || '';
    let rest = email ? line.replace(email, ' ') : line;
    // <max@x.de> Klammern entfernen
    rest = rest.replace(/[<>]/g, ' ');
    const phone = (rest.match(PHONE_RE) || [])[0] || '';
    if (phone) rest = rest.replace(phone, ' ');
    // Label-/Satzzeilen ohne Kontaktdaten überspringen (z. B. „Hier die Leute:")
    if (!email && !phone && /:\s*$/.test(line)) continue;
    let name = rest.replace(/[;,|\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!name && email) name = email.split('@')[0].replace(/[._]+/g, ' ').trim();
    if (!name && !email && !phone) continue;
    rows.push([name, email, phone.replace(/\s+/g, ' ').trim()]);
  }
  return { header: ['Name', 'Kontakt', 'Telefon'], rows };
}

// ─── Erkennung ──────────────────────────────────────────────────────────────────
function looksLikeHtml(s) {
  return /<table\b/i.test(s) || /<\/tr>/i.test(s) || /<!doctype html|<html\b/i.test(s);
}
function isEmail(s) {
  return /^(from|to|subject|date|cc|reply-to)\s*:/im.test(s.slice(0, 2000)) && /\r?\n\r?\n/.test(s);
}
function emailBody(s) {
  const sep = s.search(/\r?\n\r?\n/);
  return sep >= 0 ? s.slice(sep).trim() : s;
}
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (!lines.length) return null;
  const seps = ['\t', ';', '|', ','];
  let best = null, bestScore = 0;
  for (const sep of seps) {
    const counts = lines.map((l) => (l.split(sep).length - 1));
    const withSep = counts.filter((c) => c > 0).length;
    if (!withSep) continue;
    // Konsistenz über Zeilen belohnen
    const score = withSep + counts.reduce((a, c) => a + c, 0) / lines.length;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return best;
}

const FMT_LABEL = {
  '\t': 'Tabelle (Tab-getrennt · Excel-Einfügung)',
  ';': 'CSV (Semikolon)',
  ',': 'CSV (Komma)',
  '|': 'Tabelle (Pipe-getrennt)',
};

// Hauptfunktion: nimmt Text ODER base64-Datei und liefert { format, header, rows, notes, text }
export function universalParse({ text = '', base64 = '', filename = '' } = {}) {
  const name = String(filename || '').toLowerCase();
  const buf = base64 ? Buffer.from(base64, 'base64') : null;
  const isZip = buf && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);

  // 1) Excel .xlsx
  if (name.endsWith('.xlsx') || (isZip && !name.endsWith('.zip') && !name.endsWith('.docx'))) {
    try {
      const { header, rows } = parseXlsx(buf);
      return { format: 'xlsx', header, rows, text: '', notes: [`Excel-Datei erkannt · ${rows.length} Datenzeile(n)`] };
    } catch { /* kein gültiges xlsx → als Text behandeln */ }
  }
  // 2) Altes Binärformat .xls — nicht unterstützt, klarer Hinweis
  if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    return { format: 'unsupported', header: [], rows: [], text: '',
      notes: ['Altes .xls-Format kann nicht direkt gelesen werden — bitte in Excel als „.xlsx" oder „CSV" speichern.'] };
  }

  // Textinhalt gewinnen (BOM weg)
  let content = (text || (buf ? buf.toString('utf8') : '')).replace(/^\uFEFF/, '');

  // 3) E-Mail (.eml oder erkennbare Header) → Körper extrahieren
  let fromEmail = false;
  if (name.endsWith('.eml') || isEmail(content)) { content = emailBody(content); fromEmail = true; }

  // 4) HTML-Tabelle
  if (looksLikeHtml(content)) {
    const { header, rows } = parseHtmlTable(content);
    if (header.length) {
      return { format: 'html', header, rows, text: content,
        notes: [`HTML-Tabelle erkannt${fromEmail ? ' (aus E-Mail)' : ''} · ${rows.length} Zeile(n)`] };
    }
  }

  // 5) Trennzeichen-getrennt (Tab/;/,/|)
  const sep = detectDelimiter(content);
  if (sep) {
    const { header, rows } = parseCsv(content, sep);
    return { format: 'delimited', sep, header, rows, text: content,
      notes: [`${FMT_LABEL[sep]} · ${rows.length} Zeile(n)`] };
  }

  // 6) Freitext-Fallback
  const { header, rows } = parseFreeText(content);
  return { format: 'freitext', header, rows, text: content,
    notes: [`Freitext erkannt${fromEmail ? ' (aus E-Mail)' : ''} · ${rows.length} Name(n)/Kontakt(e) extrahiert`] };
}
