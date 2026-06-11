// Vollbild-Alarm (Mockup: „Erscheint als Vollbild-Alarm auf allen Actor-Geräten —
// mit Lesebestätigung“). Notfall-Durchsagen → alle Empfänger; Hoch-Prio-Vorfälle
// → nur Leitstand/Lead (Actors sollen weiterspielen, bis eine Anweisung kommt).
import { h, ic } from '../core/dom.js';
import { on, store } from '../core/store.js';
import { post } from '../core/api.js';

let layer = null;
let lastShownId = null;

export function mountAlarmLayer() {
  on('alarm', (data) => show(data));
}

function isOps() {
  const roles = new Set([store.me.role, ...(store.me.roles || [])]);
  return roles.has('management') || roles.has('lead');
}

function show(data) {
  const key = data.announcementId || data.incidentId;
  if (key && key === lastShownId) return;
  // Vorfalls-Alarme nur für Leitstand/Lead, Durchsagen-Alarme für die Empfänger
  if (data.incidentId && !isOps()) return;
  lastShownId = key;
  hide();
  vibrate();
  const ack = async () => {
    if (data.announcementId) {
      try { await post(`/api/announcements/${data.announcementId}/read`); } catch { /* zählt später über Liste */ }
    }
    hide();
  };
  layer = h('div', { class: 'alarm-ov' },
    h('span', { style: { fontSize: '42px' } }, data.incidentId ? '🚨' : '📢'),
    h('span', { class: 'who' },
      `${data.incidentId ? 'VORFALL · PRIORITÄT HOCH' : 'NOTFALL-DURCHSAGE'} · ${data.time || ''}${data.by ? ' · ' + data.by : ''}`),
    h('span', { class: 'big' }, data.text),
    data.ort && h('span', { class: 'who' }, ic('pin', 14), ` ${data.ort}`),
    h('button', { class: 'btn', onclick: ack },
      data.announcementId ? 'Verstanden — Lesebestätigung senden' : 'Gesehen'),
    h('span', { class: 'who', style: { opacity: 0.6 } },
      data.announcementId ? 'Der Leitstand sieht, wer bestätigt hat.' : 'Details unter Meldungen.'));
  document.body.appendChild(layer);
}

function hide() { layer?.remove(); layer = null; }

function vibrate() {
  try { navigator.vibrate?.([220, 90, 220, 90, 400]); } catch { /* kein Vibrationsmotor */ }
}
