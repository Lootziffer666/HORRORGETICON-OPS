// Horrorgeticon Ops — QR-Code-Encoder (Byte-Modus, Fehlerkorrektur M)
// Zero-dependency: erzeugt den Beitritts-QR für die Crew komplett selbst,
// ohne Internet und ohne Fremdbibliothek. Ausgabe als SVG (scharf, beliebig skalierbar).
//
// Umfang: Versionen 1–10 (deckt URLs bis ~150 Zeichen ab), Level M,
// vollständige Maskenauswahl nach Penalty-Regeln der QR-Spezifikation.

// ─── Galois-Feld GF(256), primitives Polynom 0x11d ───────────────────────────
const EXP = new Array(512), LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// Reed-Solomon-Generatorpolynom für n EC-Codewörter
function rsGen(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j];
      ng[j + 1] ^= gmul(g[j], EXP[i]);
    }
    g = ng;
  }
  return g;
}
function rsEC(data, n) {
  const gen = rsGen(n);
  const res = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift(); res.push(0);
    if (factor !== 0) for (let i = 0; i < gen.length - 1; i++) res[i] ^= gmul(gen[i + 1], factor);
  }
  return res;
}

// ─── Kapazitätstabelle Level M: [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] ──
const EC_M = {
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function dataCodewords(v) { const [, b1, d1, b2, d2] = EC_M[v]; return b1 * d1 + b2 * d2; }

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const ccBits = v <= 9 ? 8 : 16;
    const need = 4 + ccBits + byteLen * 8;
    if (need <= dataCodewords(v) * 8) return v;
  }
  throw new Error('Inhalt zu lang für QR (max. Version 10)');
}

// ─── Bitstrom aus Daten (Byte-Modus) ─────────────────────────────────────────
function buildData(bytes, v) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                       // Modus: Byte
  push(bytes.length, v <= 9 ? 8 : 16);   // Zeichenanzahl
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(v) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // Terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const pad = [0xec, 0x11];
  let pi = 0;
  while (cw.length < dataCodewords(v)) cw.push(pad[pi++ % 2]);
  return cw;
}

// Daten- und EC-Codewörter blockweise verschränken
function interleave(cw, v) {
  const [ecLen, b1, d1, b2, d2] = EC_M[v];
  const blocks = [];
  let p = 0;
  for (let i = 0; i < b1; i++) { const d = cw.slice(p, p + d1); p += d1; blocks.push({ d, e: rsEC(d, ecLen) }); }
  for (let i = 0; i < b2; i++) { const d = cw.slice(p, p + d2); p += d2; blocks.push({ d, e: rsEC(d, ecLen) }); }
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ─── Matrix-Aufbau ───────────────────────────────────────────────────────────
function newMatrix(size) {
  const m = []; const reserved = [];
  for (let r = 0; r < size; r++) { m.push(new Array(size).fill(0)); reserved.push(new Array(size).fill(false)); }
  return { m, reserved, size };
}
function placeFinder(M, r, c) {
  for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= M.size || cc >= M.size) continue;
    const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
      && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
    const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
    M.m[rr][cc] = (inRing || inCore) ? 1 : 0;
    M.reserved[rr][cc] = true;
  }
}
function placeAlignment(M, v) {
  const pos = ALIGN[v];
  for (const r of pos) for (const c of pos) {
    // nicht über Finder-Patterns legen
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= M.size - 9) || (r >= M.size - 9 && c <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const isDark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      M.m[r + dr][c + dc] = isDark ? 1 : 0;
      M.reserved[r + dr][c + dc] = true;
    }
  }
}
function placeTiming(M) {
  for (let i = 8; i < M.size - 8; i++) {
    const bit = (i % 2 === 0) ? 1 : 0;
    if (!M.reserved[6][i]) { M.m[6][i] = bit; M.reserved[6][i] = true; }
    if (!M.reserved[i][6]) { M.m[i][6] = bit; M.reserved[i][6] = true; }
  }
}
function reserveFormat(M) {
  const s = M.size;
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { M.reserved[8][i] = true; M.reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) { M.reserved[8][s - 1 - i] = true; M.reserved[s - 1 - i][8] = true; }
  M.m[s - 8][8] = 1; M.reserved[s - 8][8] = true; // dunkles Modul
}
function reserveVersion(M, v) {
  if (v < 7) return;
  const s = M.size;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    M.reserved[i][s - 11 + j] = true; M.reserved[s - 11 + j][i] = true;
  }
}

// BCH für Formatinfo (15 bit) und Versionsinfo (18 bit)
function bch(data, gen, len) {
  let d = data << (len);
  const bitlen = (n) => { let b = 0; while (n) { n >>= 1; b++; } return b; };
  while (bitlen(d) - 1 >= bitlen(gen) - 1 + 0 && (d >> (len)) !== 0) {
    // wird unten direkt berechnet
    break;
  }
  return d;
}
function formatBits(maskIdx) {
  // Level M = 0b00, kombiniert mit Maske
  const data = (0b00 << 3) | maskIdx; // 5 Bit
  let rem = data << 10;
  const g = 0b10100110111;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
  let bits = ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
  return bits & 0x7fff; // 15 Bit
}
function versionBits(v) {
  let rem = v << 12;
  const g = 0b1111100100101;
  for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= g << (i - 12);
  return ((v << 12) | (rem & 0xfff)) & 0x3ffff; // 18 Bit
}

function placeFormat(M, maskIdx) {
  const bits = formatBits(maskIdx); // 15 Bit, bit14 = MSB
  const s = M.size;
  const get = (i) => (bits >> i) & 1;
  // Kopie 1 (ums obere linke Finder): MSB zuerst entlang der Sequenz
  const coords1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let i = 0; i < 15; i++) { const [r, c] = coords1[i]; M.m[r][c] = get(14 - i); }
  // Kopie 2: vertikal unten (Bits 14..8) + horizontal rechts (Bits 7..0)
  for (let k = 0; k < 7; k++) M.m[s - 1 - k][8] = get(14 - k);
  for (let k = 0; k < 8; k++) M.m[8][s - 8 + k] = get(7 - k);
  M.m[s - 8][8] = 1; // immer dunkles Modul
}
function placeVersionInfo(M, v) {
  if (v < 7) return;
  const bits = versionBits(v);
  const s = M.size;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    M.m[r][s - 11 + c] = bit;
    M.m[s - 11 + c][r] = bit;
  }
}

const MASK = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(M, codewords) {
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  let idx = 0;
  const s = M.size;
  let up = true;
  for (let col = s - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Timing-Spalte überspringen
    for (let i = 0; i < s; i++) {
      const row = up ? s - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (!M.reserved[row][c]) {
          M.m[row][c] = idx < bits.length ? bits[idx++] : 0;
        }
      }
    }
    up = !up;
  }
}

function applyMask(M, maskIdx) {
  const fn = MASK[maskIdx];
  const out = M.m.map((row) => row.slice());
  for (let r = 0; r < M.size; r++) for (let c = 0; c < M.size; c++) {
    if (!M.reserved[r][c] && fn(r, c)) out[r][c] ^= 1;
  }
  return out;
}

function penalty(grid) {
  const n = grid.length; let p = 0;
  // Regel 1: ≥5 gleiche in Reihe/Spalte
  for (let r = 0; r < n; r++) for (const line of [grid[r], grid.map((row) => row[r])]) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (line[c] === line[c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
      else run = 1;
    }
  }
  // Regel 2: 2x2-Blöcke
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = grid[r][c];
    if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) p += 3;
  }
  // Regel 3: Finder-ähnliches Muster
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match = (line, i, pat) => pat.every((v, k) => line[i + k] === v);
  for (let r = 0; r < n; r++) {
    const rowL = grid[r], colL = grid.map((row) => row[r]);
    for (let c = 0; c <= n - 11; c++) {
      if (match(rowL, c, pat1) || match(rowL, c, pat2)) p += 40;
      if (match(colL, c, pat1) || match(colL, c, pat2)) p += 40;
    }
  }
  // Regel 4: Dunkelanteil
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += grid[r][c];
  const ratio = (dark * 100) / (n * n);
  p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return p;
}

// Öffentliche API: liefert die Modul-Matrix (true = dunkel)
export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const v = pickVersion(bytes.length);
  const size = 17 + 4 * v;
  const codewords = interleave(buildData(bytes, v), v);

  const base = newMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  // Separatoren (weiß) sind durch Finder bereits reserviert/0 — explizit absichern
  placeAlignment(base, v);
  placeTiming(base);
  reserveFormat(base);
  reserveVersion(base, v);
  placeData(base, codewords);

  let best = null, bestPen = Infinity, bestMask = 0;
  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const masked = applyMask(base, maskIdx);
    const pen = penalty(masked);
    if (pen < bestPen) { bestPen = pen; best = masked; bestMask = maskIdx; }
  }
  // Format- und Versionsinfo auf die gewählte Maske schreiben
  const finalM = { m: best, reserved: base.reserved, size };
  placeFormat(finalM, bestMask);
  placeVersionInfo(finalM, v);
  return finalM.m.map((row) => row.map((x) => x === 1));
}

// Öffentliche API: QR als SVG-String (scharf skalierbar, ideal für Anzeige & Druck)
export function qrSvg(text, { scale = 6, margin = 4, dark = '#0d1b2a', light = '#ffffff' } = {}) {
  const mat = qrMatrix(text);
  const n = mat.length;
  const dim = (n + margin * 2) * scale;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (mat[r][c]) rects += `<rect x="${(c + margin) * scale}" y="${(r + margin) * scale}" width="${scale}" height="${scale}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<g fill="${dark}">${rects}</g></svg>`;
}
