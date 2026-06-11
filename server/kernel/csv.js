// Horrorgeticon Ops — CSV: robust gegen Excel-Eigenheiten (; oder , · BOM · Anführungszeichen)
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  if (!text.trim()) return { header: [], rows: [], sep: ';' };
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const sep = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';

  const rows = [];
  let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === sep) {
      cur.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((f) => f.trim() !== '')) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((f) => f.trim() !== '')) rows.push(cur);

  const header = (rows.shift() || []).map((h) => h.trim());
  return { header, rows, sep };
}

export function toCsv(header, rows, sep = ';') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";,\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.map(esc).join(sep), ...rows.map((r) => r.map(esc).join(sep))];
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM + CRLF: öffnet sauber in Excel
}

// Header-Zuordnung: findet Spalten über Synonyme (deutsch, tolerant)
export function mapHeader(header, synonyms) {
  const norm = (s) => s.toLowerCase().replace(/[^a-zäöüß]/g, '');
  const idx = {};
  for (const [field, names] of Object.entries(synonyms)) {
    const i = header.findIndex((h) => names.some((n) => norm(h) === norm(n) || norm(h).includes(norm(n))));
    if (i >= 0) idx[field] = i;
  }
  return idx;
}
