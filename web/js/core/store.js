// Zentraler Zustand + SSE-Anbindung.
// Views abonnieren Themen („topics“) und laden bei passenden Ereignissen neu —
// bewusst simpel gehalten: Server ist die Wahrheit, Client cached nur leicht.
import { getToken } from './api.js';

export const store = {
  me: null,          // { person, role, roles }
  settings: null,
  alarm: null,       // aktueller Vollbild-Alarm
  online: true,
  listeners: new Map(), // topic → Set<fn>
};

const TOPIC_BY_EVENT = {
  'people.changed': ['people', 'live'],
  'maze.changed': ['mazes', 'live'],
  'presence.changed': ['live'],
  'break.changed': ['breaks', 'live'],
  'incident.changed': ['incidents', 'live', 'feed'],
  'dnd.changed': ['dnd', 'live'],
  'announce.new': ['announce', 'feed'],
  'announce.read': ['announce'],
  'chat.message': ['chat'],
  'catering.wallet': ['catering'],
  'catering.redeemed': ['catering'],
  'catering.station': ['catering'],
  'carpool.changed': ['carpool', 'chat'],
  'task.changed': ['tasks', 'feed'],
  'checklist.changed': ['checklists'],
  'module.changed': ['modules'],
  'feed.item': ['feed'],
  'settings.changed': ['settings'],
  'db.changed': ['db', 'people', 'mazes', 'live'],
  'db.restored': ['db', 'people', 'mazes', 'live', 'catering', 'breaks', 'incidents'],
  'schedule.changed': ['schedule'],
  'tick': ['tick'],
};

export function on(topics, fn) {
  const list = Array.isArray(topics) ? topics : [topics];
  for (const t of list) {
    if (!store.listeners.has(t)) store.listeners.set(t, new Set());
    store.listeners.get(t).add(fn);
  }
  return () => { for (const t of list) store.listeners.get(t)?.delete(fn); };
}

export function emit(topic, data) {
  for (const fn of store.listeners.get(topic) || []) {
    try { fn(data); } catch (e) { console.error('[store]', topic, e); }
  }
}

let es = null;
let retryMs = 1500;

export function connectSSE() {
  if (es) es.close();
  const token = getToken();
  if (!token) return;
  es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  es.addEventListener('open', () => { retryMs = 1500; setOnline(true); });
  es.addEventListener('error', () => {
    setOnline(false);
    es.close(); es = null;
    setTimeout(connectSSE, retryMs);
    retryMs = Math.min(retryMs * 1.7, 15000);
  });
  es.addEventListener('ops', (e) => {
    let evt;
    try { evt = JSON.parse(e.data); } catch { return; }
    if (evt.type === 'alarm') { store.alarm = evt.data; emit('alarm', evt.data); }
    for (const t of TOPIC_BY_EVENT[evt.type] || []) emit(t, evt);
    emit('*', evt);
  });
}

export function disconnectSSE() { es?.close(); es = null; }

function setOnline(v) {
  if (store.online !== v) { store.online = v; emit('online', v); }
}

// Browser-Benachrichtigung (optional, QoL)
export async function notify(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/icons/icon-192.png' });
    }
  } catch { /* nicht kritisch */ }
}
