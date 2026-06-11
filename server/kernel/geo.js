// Horrorgeticon Ops — Mini-Geodaten für die Fahrgruppen-Bildung.
// Orte rund um das (fiktive) Eventgelände „Gut Schauerfeld“. Eigene Orte können
// über die Einstellungen bzw. DB-Pflege ergänzt werden (Collection „orte“).
export const EVENT_SITE = { name: 'Gut Schauerfeld (Eventgelände)', lat: 51.5000, lon: 9.5000 };

export const DEFAULT_ORTE = [
  { name: 'Schauerfeld',   lat: 51.5080, lon: 9.5120 },
  { name: 'Nebelbach',     lat: 51.5430, lon: 9.4310 },
  { name: 'Rabenstein',    lat: 51.4620, lon: 9.5890 },
  { name: 'Grauenthal',    lat: 51.5710, lon: 9.5560 },
  { name: 'Moorlinde',     lat: 51.4380, lon: 9.4120 },
  { name: 'Finsterloh',    lat: 51.5950, lon: 9.4730 },
  { name: 'Eulenbruch',    lat: 51.4150, lon: 9.5470 },
  { name: 'Wolfshagen',    lat: 51.5520, lon: 9.6240 },
  { name: 'Dornfelde',     lat: 51.4790, lon: 9.3560 },
  { name: 'Kaltenborn',    lat: 51.6120, lon: 9.5990 },
  { name: 'Aschenrode',    lat: 51.3920, lon: 9.4660 },
  { name: 'Mitternfurt',   lat: 51.5260, lon: 9.3140 },
];

const R = 6371; // km
export function distKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function lookupOrt(db, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  const custom = db.all('orte').find((o) => o.name.toLowerCase() === n);
  if (custom) return custom;
  return DEFAULT_ORTE.find((o) => o.name.toLowerCase() === n) || null;
}
