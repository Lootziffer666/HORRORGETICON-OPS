// Formatierung (deutsch)
export const hhmm = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function ago(t) {
  if (!t) return '—';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  return `vor ${h}:${String(m % 60).padStart(2, '0')} h`;
}

export function minSince(t) { return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null; }

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function dur(hFrom, hTo) { return `${hFrom} – ${hTo}`; }

export function shiftProgress(startHHMM, endHHMM) {
  const today = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  let s = today(startHHMM), e = today(endHHMM);
  if (e <= s) e += 24 * 3600e3;                 // über Mitternacht
  if (Date.now() < s - 12 * 3600e3) { s -= 24 * 3600e3; e -= 24 * 3600e3; }
  const pct = Math.max(0, Math.min(100, ((Date.now() - s) / (e - s)) * 100));
  const leftMin = Math.max(0, Math.round((e - Date.now()) / 60000));
  return { pct, left: `${Math.floor(leftMin / 60)}:${String(leftMin % 60).padStart(2, '0')} h` };
}
