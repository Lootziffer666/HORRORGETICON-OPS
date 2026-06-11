// Catering-Station (Tablet) — Mockup CateringStation:
// Station wählen → Code scannen/eintippen → Person + Guthaben → Marken entwerten.
// Kamera-Scan über BarcodeDetector (falls vorhanden), sonst manuelle Eingabe.
import { h, ic, ghostMark, badge, av, mount } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { guardedView, toast, sheet } from '../core/ui.js';
import { hhmm } from '../core/fmt.js';
import { logout, switchRole } from '../app.js';
import { chatView } from '../views/chat.js';
import { kpi } from '../views/shared.js';

let stationId = localStorage.getItem('hgo.station') || null;
let scanned = null; // { check, qr? , personCode?, code? }
let tab = 'einloesen';

export function renderStation(root) {
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  const liveClock = h('span', { class: 'live-dot' }, h('i'), `LIVE · ${hhmm(Date.now())}`);
  setInterval(() => { liveClock.lastChild.textContent = `LIVE · ${hhmm(Date.now())}`; }, 15000);
  const stationLabel = h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '17px' } }, 'Catering-Station');
  const tabRow = h('div', { class: 'row', style: { gap: '6px' } });

  let guard = null;
  const cleanups = [];
  const route = () => {
    tabRow.replaceChildren(
      h('span', { class: 'chip' + (tab === 'einloesen' ? ' active' : ''), onclick: () => { tab = 'einloesen'; route(); } }, ic('qr', 13), 'Einlösen'),
      h('span', { class: 'chip' + (tab === 'abschluss' ? ' active' : ''), onclick: () => { tab = 'abschluss'; route(); } }, ic('list', 13), 'Tagesabschluss'),
      h('span', { class: 'chip' + (tab === 'chat' ? ' active' : ''), onclick: () => { tab = 'chat'; route(); } }, ic('chat', 13), 'Chat'));
    guard?.stop();
    for (const fn of cleanups.splice(0)) fn();
    const ctx = { params: new URLSearchParams(), onCleanup: (fn) => cleanups.push(fn), refresh: () => guard.refresh() };
    const views = {
      einloesen: () => redeemView(ctx, stationLabel),
      abschluss: () => closingView(ctx),
      chat: () => chatView(ctx),
    };
    guard = guardedView(body, views[tab]);
  };

  mount(root, h('div', { class: 'theme app-frame' },
    h('div', { class: 'row', style: { padding: '10px 18px', gap: '12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' } },
      ghostMark(34),
      h('div', { class: 'col', style: { gap: 0 } },
        stationLabel,
        h('span', { class: 'sub' }, `Einlöse-Modus · ${store.me.person.name}`)),
      liveClock, badge('ok', 'Online', { dot: true }),
      h('div', { style: { flex: 1 } }),
      tabRow,
      h('span', { style: { cursor: 'pointer', color: 'var(--fg-muted)' }, title: 'Rolle wechseln', onclick: switchRole }, ic('user', 18)),
      h('span', { style: { cursor: 'pointer', color: 'var(--fg-muted)' }, title: 'Abmelden', onclick: logout }, ic('out', 18))),
    body));
  route();
}

async function redeemView({ onCleanup, refresh }, stationLabel) {
  const stations = await get('/api/catering/stations');
  onCleanup(on(['catering'], refresh));

  // Station wählen, falls noch keine
  const myStation = stations.find((s) => s.id === stationId);
  if (!myStation) {
    return h('div', { class: 'col', style: { gap: '12px', padding: '20px', maxWidth: '560px', margin: '0 auto', width: '100%' } },
      h('span', { class: 'overline' }, 'Schritt 1 · Station wählen'),
      ...stations.map((s) => h('div', {
        class: 'card pad row role-card', style: { gap: '12px', padding: '16px' },
        onclick: () => act(async () => {
          await post(`/api/catering/stations/${s.id}/select`);
          stationId = s.id;
          localStorage.setItem('hgo.station', s.id);
          refresh();
        }, `${s.name} übernommen`),
      },
        h('span', { class: 'av lg navy', style: { borderRadius: '12px' } }, ic('cup', 20)),
        h('div', { class: 'col grow', style: { gap: '2px' } },
          h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '15px' } }, s.name),
          h('span', { class: 'sub' }, `${s.place || 'Gelände'} · ${s.online ? `besetzt von ${s.operator}` : 'frei'}`)),
        ic('chev', 16, { color: 'var(--fg-muted)' }))));
  }
  stationLabel.textContent = myStation.name;

  const today = await get('/api/catering/closing');
  let drinks = 1, meals = 0;

  // ── rechte Spalte: Zähler + letzte Einlösungen ──
  const ovData = await get('/api/catering/overview');
  const right = h('div', { class: 'col', style: { gap: '12px', minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '10px' } },
      kpi(String(today.drinks), 'Getränke heute', `${today.einloesungen} Einlösungen gesamt`),
      kpi(String(today.meals), 'Essen heute', `Ausgabe bis ${store.settings?.catering?.ausgabeBis || '23:00'}`),
      kpi(String(today.abgelehnt), 'Abgelehnt', { text: 'Code bereits benutzt', tone: 'var(--color-error)' }, { tone: today.abgelehnt ? 'var(--color-error)' : undefined })),
    h('div', { class: 'panel grow', style: { minHeight: 0, overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'panel-h' }, ic('clock', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Letzte Einlösungen')),
      h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } },
        ovData.letzte.slice(0, 12).map((r) => h('div', { class: 'prow', style: { gap: '10px' } },
          h('span', { class: 'f-time', style: { width: '38px', fontSize: '11px', color: 'var(--fg-muted)' } }, r.time),
          av(r.personName),
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { class: 'nm', style: { fontSize: '13px' } }, r.personName),
            h('span', { class: 'mt' }, r.einsatz || r.stationName)),
          badge('plain', [r.drinks ? `${r.drinks} Getränk${r.drinks > 1 ? 'e' : ''}` : null, r.meals ? `${r.meals} Essen` : null].filter(Boolean).join(' · ') || '—'))))),
    h('div', { class: 'card pad row', style: { gap: '10px', background: 'var(--bg-muted)', boxShadow: 'none', padding: '11px' } },
      ic('shield', 16, { color: 'var(--fg-muted)' }),
      h('span', { class: 'sub', style: { fontSize: '12px' } },
        'Jede Einlösung wird sofort verbucht — derselbe Code funktioniert an keiner anderen Station erneut.')));

  // ── linke Spalte: Scan/Eingabe ODER gescannte Person ──
  const left = h('div', { class: 'col', style: { gap: '12px', minHeight: 0 } });

  const drawScanInput = () => {
    const personCode = h('input', { placeholder: 'LK-0427', autocapitalize: 'characters', style: { textTransform: 'uppercase' } });
    const code = h('input', { placeholder: '9F3K', autocapitalize: 'characters', style: { textTransform: 'uppercase', letterSpacing: '0.2em' } });
    const check = () => act(async () => {
      const r = await post('/api/catering/check', { personCode: personCode.value.trim(), code: code.value.trim() });
      scanned = { check: r, personCode: personCode.value.trim(), code: code.value.trim() };
      drinks = 1; meals = 0;
      drawPerson();
    });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    mount(left,
      h('div', { class: 'card pad col', style: { gap: '14px', padding: '18px', alignItems: 'center' } },
        h('span', { style: { width: '54px', height: '54px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-info-light)', color: 'var(--color-info)' } }, ic('qr', 26)),
        h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '17px' } }, 'Marken-Code prüfen'),
        h('span', { class: 'sub', style: { textAlign: 'center' } }, 'QR der Crew scannen — oder Personal-Code + 4er-Code aus der Wallet eintippen.'),
        ('BarcodeDetector' in window) && h('button', { class: 'btn lg orange', onclick: () => cameraScan() }, ic('camera', 18), 'Kamera-Scan starten'),
        h('div', { class: 'grid2', style: { width: '100%' } },
          h('label', { class: 'fld' }, 'Personal-Code', h('div', { class: 'inp' }, ic('user', 16), personCode)),
          h('label', { class: 'fld' }, 'Marken-Code', h('div', { class: 'inp' }, ic('qr', 16), code))),
        h('button', { class: 'btn lg', onclick: check }, ic('check', 17), 'Code prüfen')));
  };

  const cameraScan = async () => {
    let stream = null, raf = null;
    const video = h('video', { autoplay: true, playsinline: true, style: { width: '100%', borderRadius: '10px', background: '#000', maxHeight: '50vh' } });
    const s = sheet({
      title: 'Kamera-Scan', icon: 'camera', tone: 'info', center: true,
      sub: 'QR aus der Crew-Wallet vor die Kamera halten',
      content: (close) => h('div', { class: 'col', style: { gap: '10px' } }, video,
        h('button', { class: 'btn quiet', onclick: () => { stop(); close(); } }, 'Abbrechen')),
    });
    const stop = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((c) => c.rawValue?.startsWith('HGO1|'));
          if (hit) {
            stop(); s.close();
            await act(async () => {
              const r = await post('/api/catering/check', { qr: hit.rawValue });
              scanned = { check: r, qr: hit.rawValue };
              drinks = 1; meals = 0;
              drawPerson();
            });
            return;
          }
        } catch { /* Frame nicht lesbar */ }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      stop(); s.close();
      toast('Kamera nicht verfügbar — bitte Code eintippen', 'err');
    }
  };

  const drawPerson = () => {
    const c = scanned.check;
    const dRest = c.wallet.drinks.total - c.wallet.drinks.used;
    const mRest = c.wallet.meals.total - c.wallet.meals.used;
    const counter = (label, icon, rest, val, set) => {
      const valEl = h('span', { class: 'num', style: { fontSize: '20px', width: '28px', textAlign: 'center', color: val ? 'var(--fg-primary)' : 'var(--fg-muted)' } }, String(val));
      return h('div', { class: 'card pad col grow', style: { gap: '8px', alignItems: 'center', padding: '14px', borderColor: val ? 'var(--color-secondary)' : undefined, boxShadow: val ? '0 0 0 1px var(--color-secondary), var(--shadow-1)' : undefined } },
        h('span', { style: { width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: rest ? 'var(--color-success-light)' : 'var(--bg-muted)', color: rest ? 'var(--color-success)' : 'var(--fg-secondary)' } }, ic(icon, 19)),
        h('span', { style: { fontSize: '13.5px', fontWeight: 700 } }, label),
        h('span', { class: 'sub' }, `Rest: ${rest}`),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('button', { class: 'btn sm quiet', style: { width: '40px', minHeight: '40px' }, onclick: () => { set(Math.max(0, val - 1)); drawPerson(); } }, '−'),
          valEl,
          h('button', { class: 'btn sm quiet', style: { width: '40px', minHeight: '40px' }, onclick: () => { set(Math.min(rest, val + 1)); drawPerson(); } }, '+')));
    };
    const total = drinks + meals;
    mount(left,
      h('div', { class: 'card pad row', style: { gap: '12px', padding: '14px' } },
        h('span', { style: { width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.alreadyUsed ? 'var(--color-error-light)' : 'var(--color-success-light)', color: c.alreadyUsed ? 'var(--color-error)' : 'var(--color-success)' } }, ic('qr', 22)),
        h('div', { class: 'col grow', style: { gap: '1px' } },
          h('span', { style: { fontSize: '14.5px', fontWeight: 800, fontFamily: 'var(--font-display)' } },
            c.alreadyUsed ? 'Code in diesem Zeitfenster schon benutzt' : 'Code gescannt — gültig'),
          h('span', { class: 'sub' }, `${c.person.code} · geprüft ${hhmm(Date.now())}`)),
        badge(c.alreadyUsed ? 'err' : 'ok', c.alreadyUsed ? 'Abgelehnt' : 'Verifiziert', { dot: true })),
      h('div', { class: 'panel grow', style: { minHeight: 0 } },
        h('div', { class: 'panel-h' },
          av(c.person.name, { tone: 'navy' }),
          h('div', { class: 'col', style: { gap: 0 } },
            h('span', { class: 't', style: { fontSize: '14.5px' } }, c.person.name),
            h('span', { class: 'sub', style: { fontSize: '11px' } }, c.person.einsatz)),
          c.person.inPause ? badge('info', 'In Pause', { style: { marginLeft: 'auto' } })
            : badge(c.person.eingecheckt ? 'ok' : 'plain', c.person.eingecheckt ? 'Eingecheckt' : 'Nicht eingecheckt', { style: { marginLeft: 'auto' } })),
        h('div', { class: 'panel-b', style: { gap: '12px', flex: 1 } },
          h('span', { class: 'overline' }, 'Guthaben auswählen'),
          h('div', { class: 'row', style: { gap: '10px' } },
            counter('Getränk', 'cup', dRest, drinks, (v) => { drinks = v; }),
            counter('Essen', 'door', mRest, meals, (v) => { meals = v; })),
          h('div', { style: { flex: 1 } }),
          h('button', {
            class: 'btn lg orange', style: { minHeight: '54px', fontSize: '16px' },
            disabled: total === 0 || c.alreadyUsed,
            onclick: () => act(async () => {
              const body = scanned.qr ? { qr: scanned.qr } : { personCode: scanned.personCode, code: scanned.code };
              await post('/api/catering/redeem', { ...body, stationId, drinks, meals });
              scanned = null;
              refresh();
            }, `${total} Marke${total > 1 ? 'n' : ''} eingelöst`),
          }, ic('check', 18), total === 0 ? 'Marken wählen'
            : `${[drinks ? `${drinks} Getränkemarke${drinks > 1 ? 'n' : ''}` : null, meals ? `${meals} Essensmarke${meals > 1 ? 'n' : ''}` : null].filter(Boolean).join(' + ')} einlösen`),
          h('button', { class: 'btn ghost', style: { alignSelf: 'center' }, onclick: () => { scanned = null; drawScanInput(); } },
            'Abbrechen — Guthaben bleibt unangetastet'))));
  };

  if (scanned) drawPerson(); else drawScanInput();

  return h('div', { style: { flex: 1, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '14px', padding: '16px', minHeight: 0 } }, left, right);
}

async function closingView({ onCleanup, refresh }) {
  const c = await get('/api/catering/closing');
  onCleanup(on(['catering'], refresh));
  return h('div', { class: 'col scroll-y', style: { gap: '14px', padding: '16px', maxWidth: '720px', width: '100%', margin: '0 auto' } },
    h('span', { class: 'overline' }, `Tagesabschluss · Stand ${c.stand}`),
    h('div', { class: 'row', style: { gap: '10px' } },
      kpi(String(c.einloesungen), 'Einlösungen', null),
      kpi(String(c.drinks), 'Getränke', null),
      kpi(String(c.meals), 'Essen', null),
      kpi(String(c.abgelehnt), 'Abgelehnt', null, { tone: c.abgelehnt ? 'var(--color-error)' : undefined })),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('list', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pro Station')),
      h('div', { class: 'panel-b', style: { padding: 0 } },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Station'), h('th', {}, 'Einlösungen'), h('th', {}, 'Getränke'), h('th', {}, 'Essen'))),
          h('tbody', {}, c.proStation.map((s) => h('tr', {},
            h('td', { class: 'b' }, s.station), h('td', {}, s.n), h('td', {}, s.drinks), h('td', {}, s.meals))))))),
    h('button', { class: 'btn quiet', onclick: () => window.print() }, ic('doc', 15), 'Drucken / als PDF sichern'));
}
