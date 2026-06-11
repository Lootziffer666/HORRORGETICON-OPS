// API-Client: Token-Verwaltung, Fehlerbehandlung, Modul-Aus-Erkennung
import { toast } from './ui.js';

const LS_TOKEN = 'hgo.token';

export const getToken = () => localStorage.getItem(LS_TOKEN);
export const setToken = (t) => t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN);

export class ModuleOffError extends Error {
  constructor(msg, module) { super(msg); this.module = module; this.moduleDisabled = true; }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Keine Verbindung zum Server');
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = data?.error || `Fehler ${res.status}`;
    if (res.status === 401 && getToken()) {
      setToken(null);
      location.hash = '';
      location.reload();
      throw new Error(msg);
    }
    if (data?.moduleDisabled) throw new ModuleOffError(msg, data.module);
    throw new Error(msg);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

// Aktion mit Toast-Fehlerbehandlung („darf nie die App reißen“)
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  }
}

// Download mit Auth-Token (CSV/JSON-Exporte)
export function download(path) {
  const a = document.createElement('a');
  a.href = `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
