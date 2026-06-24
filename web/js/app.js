// Horrorgeticon Ops — App-Einstieg
// Ablauf: Token? → /auth/me → Rolle wählen (falls mehrere) → passende Shell.
// Shells: Desktop (Management) · Tablet (Lead) · Station (Catering) · Phone (Actor).
import { h, mount } from './core/dom.js';
import { get, post, getToken, setToken } from './core/api.js';
import { store, on, connectSSE, emit, notify } from './core/store.js';
import { toast } from './core/ui.js';
import { initOfflineBanner, initLageBanner } from './core/offline-banner.js';
import { renderLogin, renderRoleSelect } from './shell/login.js';
import { renderDesktop } from './shell/desktop.js';
import { renderTablet } from './shell/tablet.js';
import { renderPhone } from './shell/phone.js';
import { renderStation } from './shell/station.js';
import { mountAlarmLayer } from './views/alarm.js';

const app = document.getElementById('app');

// gemerkte Darstellung (Dark Mode) sofort anwenden
const savedTheme = localStorage.getItem('hgo.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline-Komfort, kein Muss */ });
  }
  if (!getToken()) return showLogin();
  try {
    const me = await get('/api/auth/me');
    store.me = me;
    store.settings = await get('/api/settings').catch(() => null);
    enterApp();
  } catch (e) {
    setToken(null);
    showLogin();
  }
}

function showLogin() {
  mount(app, renderLogin(async (loginResult) => {
    setToken(loginResult.token);
    store.me = { person: loginResult.person, role: loginResult.role, roles: loginResult.roles };
    store.settings = await get('/api/settings').catch(() => null);
    if ((loginResult.roles || []).length > 1) showRoleSelect();
    else enterApp();
  }));
}

function showRoleSelect() {
  mount(app, renderRoleSelect(store.me, async (role) => {
    await post('/api/auth/role', { role });
    store.me.role = role;
    enterApp();
  }, logout));
}

export async function logout() {
  try { await post('/api/auth/logout'); } catch { /* Sitzung ist eh weg */ }
  setToken(null);
  location.hash = '';
  location.reload();
}

export function switchRole() { showRoleSelect(); }

function enterApp() {
  connectSSE();
  initOfflineBanner();
  initLageBanner();
  mountAlarmLayer();
  startHeartbeat();
  wireGlobalEvents();
  const role = store.me.role;
  if (role === 'management') renderDesktop(app);
  else if (role === 'lead') renderTablet(app);
  else if (role === 'catering') renderStation(app);
  else renderPhone(app);
}

// ── Heartbeat: hält das Live-Tracking frisch, solange eingecheckt ──
let hbTimer = null;
function startHeartbeat() {
  clearInterval(hbTimer);
  const send = async () => {
    try {
      const battery = await batteryLevel();
      await post('/api/live/heartbeat', { battery });
    } catch { /* offline — SSE-Reconnect kümmert sich */ }
  };
  send();
  hbTimer = setInterval(send, 25000);
}
async function batteryLevel() {
  try {
    if (navigator.getBattery) { const b = await navigator.getBattery(); return Math.round(b.level * 100); }
  } catch { /* egal */ }
  return null;
}

function wireGlobalEvents() {
  on('chat.message', () => {});
  on('*', (evt) => {
    if (evt.type === 'chat.message' && evt.data.byPersonId !== store.me.person.id) {
      notify(`💬 ${evt.data.byName}`, evt.data.text);
    }
    if (evt.type === 'announce.new' && evt.data.byPersonId !== store.me.person.id && evt.data.level !== 'notfall') {
      toast(`📢 ${evt.data.text}`, '');
      notify('📢 Durchsage', evt.data.text);
    }
  });

  on('settings.changed', async () => {
    store.settings = await get('/api/settings').catch(() => store.settings);
    emit('shell.refresh');
  });
}

boot();
