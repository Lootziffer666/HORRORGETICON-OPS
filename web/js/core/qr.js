// Minimaler QR-Encoder (Byte-Modus, Fehlerkorrektur M, Version 1–5).
// Reicht für die Wallet-Codes (≈ 40 Zeichen) und ist komplett offline.
// Implementiert nach ISO/IEC 18004: RS-Fehlerkorrektur, Maskenwahl per Penalty.

const EC_M = { // version → { total, blocks: [ [count, totalCw, dataCw] … ] }
  1: { blocks: [[1, 26, 16]] },
  2: { blocks: [[1, 44, 28]] },
  3: { blocks: [[1, 70, 44]] },
  4: { blocks: [[2, 50, 32]] },
  5: { blocks: [[2, 67, 43]] },
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };
// Formatinfo (ECC M, Maske 0–7), MSB zuerst
const FORMAT_M = [
  '101010000010010', '101000100100101', '101111001111100', '101101101001011',
  '100010111111001', '100000011001110', '100111110010111', '100101010100000',
];

// GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

function rsGenerator(ec) {
  let g = [1];
  for (let i = 0; i < ec; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= gmul(g[j], EXP[i]);
      next[j + 1] ^= g[j];
    }
    g = next;
  }
  return g.reverse(); // höchster Grad zuerst
}

function rsEncode(data, ec) {
  const gen = rsGenerator(ec);
  const res = [...data, ...new Array(ec).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const f = res[i];
    if (!f) continue;
    for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], f);
  }
  return res.slice(data.length);
}

export function qrEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 5; v++) {
    const dataCw = EC_M[v].blocks.reduce((s, [n, , d]) => s + n * d, 0);
    if (4 + 8 + bytes.length * 8 <= dataCw * 8) { version = v; break; }
  }
  if (!version) throw new Error('Inhalt zu lang für QR (max ~84 Zeichen)');
  const size = 17 + version * 4;
  const { blocks } = EC_M[version];
  const totalData = blocks.reduce((s, [n, , d]) => s + n * d, 0);

  // ── Daten-Bitstrom ──
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, totalData * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < totalData; i++) data.push(PAD[i % 2]);

  // ── Blöcke + Reed-Solomon ──
  const dataBlocks = [], ecBlocks = [];
  let off = 0;
  for (const [count, totalCw, dataCw] of blocks) {
    for (let b = 0; b < count; b++) {
      const d = data.slice(off, off + dataCw); off += dataCw;
      dataBlocks.push(d);
      ecBlocks.push(rsEncode(d, totalCw - dataCw));
    }
  }
  const interleaved = [];
  const maxD = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxD; i++) for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]);
  const maxE = Math.max(...ecBlocks.map((b) => b.length));
  for (let i = 0; i < maxE; i++) for (const b of ecBlocks) if (i < b.length) interleaved.push(b[i]);

  // ── Matrix ──
  const M = Array.from({ length: size }, () => new Int8Array(size).fill(-1)); // -1 = frei
  const set = (r, c, v) => { M[r][c] = v ? 1 : 0; };
  const finder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const ring = inOuter && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      set(rr, cc, ring || core ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { if (M[6][i] === -1) set(6, i, i % 2 === 0); if (M[i][6] === -1) set(i, 6, i % 2 === 0); }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if (M[r][c] !== -1) continue; // überlappt Finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  set(size - 8, 8, 1); // dunkles Modul
  // Formatbereiche reservieren
  const fmtCells = [];
  for (let i = 0; i <= 5; i++) fmtCells.push([8, i], [i, 8]);
  fmtCells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 0; i < 7; i++) fmtCells.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) fmtCells.push([8, size - 8 + i]);
  for (const [r, c] of fmtCells) if (M[r][c] === -1) M[r][c] = 0;

  // ── Zickzack-Platzierung ──
  const cells = []; // Reihenfolge der Datenmodule
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    const rows = up ? range(size - 1, -1) : range(0, size);
    for (const r of rows) for (const c of [col, col - 1]) {
      if (M[r][c] === -1) cells.push([r, c]);
    }
    up = !up;
  }
  const allBits = [];
  for (const cw of interleaved) for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);
  cells.forEach(([r, c], i) => { M[r][c] = allBits[i] ?? 0; });

  // ── Maske wählen ──
  const maskFn = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const dataCellSet = new Set(cells.map(([r, c]) => r * size + c));
  let best = null, bestPen = Infinity;
  for (let m = 0; m < 8; m++) {
    const G = M.map((row) => Int8Array.from(row));
    for (const [r, c] of cells) if (maskFn[m](r, c)) G[r][c] ^= 1;
    writeFormat(G, size, m);
    const p = penalty(G, size);
    if (p < bestPen) { bestPen = p; best = G; }
  }
  return { size, modules: best, dataCellSet };
}

function writeFormat(G, size, mask) {
  const s = FORMAT_M[mask];
  // Platzierungsreihenfolge unten entspricht Bit 14→0, der String ist MSB-zuerst:
  const bit = (i) => Number(s[i]);
  const c1 = [];
  for (let i = 0; i <= 5; i++) c1.push([8, i]);
  c1.push([8, 7], [8, 8], [7, 8]);
  for (let i = 5; i >= 0; i--) c1.push([i, 8]);
  c1.forEach(([r, c], i) => { G[r][c] = bit(i); });
  const c2 = [];
  for (let i = 0; i < 7; i++) c2.push([size - 1 - i, 8]);
  for (let i = size - 8; i < size; i++) c2.push([8, i]);
  c2.forEach(([r, c], i) => { G[r][c] = bit(i); });
  G[size - 8][8] = 1; // dunkles Modul bleibt
}

function penalty(G, size) {
  let p = 0;
  const lineRuns = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) { run++; }
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      if (run >= 5) p += 3 + run - 5;
    }
  };
  lineRuns((r, c) => G[r][c]);
  lineRuns((c, r) => G[r][c]);
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = G[r][c];
    if (G[r][c + 1] === v && G[r + 1][c] === v && G[r + 1][c + 1] === v) p += 3;
  }
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const checkPattern = (get) => {
    for (let a = 0; a < size; a++) for (let b = 0; b <= size - 11; b++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        const v = get(a, b + k);
        if (v !== P1[k]) m1 = false;
        if (v !== P2[k]) m2 = false;
      }
      if (m1) p += 40;
      if (m2) p += 40;
    }
  };
  checkPattern((r, c) => G[r][c]);
  checkPattern((c, r) => G[r][c]);
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += G[r][c];
  p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return p;
}

function range(from, to) {
  const out = [];
  if (from < to) for (let i = from; i < to; i++) out.push(i);
  else for (let i = from; i > to; i--) out.push(i);
  return out;
}

// Rendert auf ein Canvas (4 Module Quiet-Zone)
export function qrCanvas(text, scale = 5) {
  const { size, modules } = qrEncode(text);
  const quiet = 4;
  const px = (size + quiet * 2) * scale;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#0D2847';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
  return cv;
}
