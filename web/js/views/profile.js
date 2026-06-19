// Profil (Phone) — eigenes Profil pflegen, Verknüpfung mit der Verwaltung,
// Fahrgemeinschaft (anbieten/suchen + Gruppenstatus), PIN, Abmelden.
import { h, ic, badge, av } from '../core/dom.js';
import { get, post, del, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';
import { logout, switchRole } from '../app.js';

export async function profileView({ onCleanup, refresh }) {
  const [me, carpool, orte, dndState] = await Promise.all([
    get('/api/auth/me'), get('/api/carpool/state').catch(() => null), get('/api/auth/orte'),
    get('/api/dnd/status').catch(() => ({ active: false, manual: false, auto: false })),
  ]);
  store.me.person = me.person;
  onCleanup(on(['people', 'carpool', 'dnd'], refresh));
  const p = me.person;

  const row = (icon, label, value, onclick = null, tone = null) => h('div', { class: 'prow' + (onclick ? ' click' : ''), onclick },
    h('span', { class: 'av', style: { borderRadius: '10px' } }, ic(icon, 15)),
    h('div', { class: 'col grow', style: { gap: 0 } },
      h('span', { class: 'nm', style: { fontSize: '13px' } }, label),
      h('span', { class: 'mt', style: tone ? { color: tone } : null }, value)),
    onclick && ic('chev', 15, { color: 'var(--fg-muted)' }));

  return h('div', { class: 'col scroll-y', style: { gap: '12px', flex: 1 } },
    h('div', { class: 'card pad row', style: { gap: '12px', padding: '16px' } },
      av(p.name, { tone: 'navy', size: 'lg' }),
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '16px' } }, p.name),
        h('span', { class: 'sub' }, `Personal-Code ${p.code} · Saison ${p.season || ''}`)),
      p.selfCreated ? badge('warn', 'Unverknüpft', { dot: true }) : badge('ok', 'Verknüpft', { dot: true })),

    p.selfCreated && h('div', { class: 'panel', style: { borderColor: 'var(--color-warning)' } },
      h('div', { class: 'panel-h' }, ic('link', 16, { color: '#b8901c' }), h('span', { class: 't' }, 'Mit der Verwaltung verknüpfen')),
      h('div', { class: 'panel-b', style: { gap: '10px' } },
        h('span', { class: 'sub' },
          'Dein Profil ist noch nicht mit dem Verwaltungs-Datensatz verbunden. Hol dir den Verknüpfungscode vom Crew-Büro — erst danach zählen Check-in und Tracking richtig.'),
        h('button', { class: 'btn orange', onclick: () => linkSheet(refresh) }, ic('link', 16), 'Verknüpfungscode eingeben'))),

    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('user', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Meine Daten'),
        h('span', { class: 'link', onclick: () => editSheet(p, orte, refresh) }, 'Bearbeiten')),
      h('div', { class: 'panel-b', style: { gap: 0, paddingTop: '2px' } },
        row('send', 'Kontakt', p.kontakt || '—'),
        row('radio', 'Telefon', p.telefon || '—'),
        row('pin', 'Wohnort', p.ort || '— (wichtig für Fahrgruppen)'),
        row('alert', 'Notfallkontakt', p.notfallKontakt || '—'),
        row('walk', 'Kostüm/Rolle', p.kostuem || '—'),
        row('cup', 'Essenswunsch', p.essenswunsch || '—'))),

    dndPanel(dndState, refresh),

    carpool && carpoolPanel(carpool, orte, refresh),

    h('div', { class: 'panel' },
      h('div', { class: 'panel-h' }, ic('gear', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Konto')),
      h('div', { class: 'panel-b', style: { gap: 0, paddingTop: '2px' } },
        row('shield', 'PIN ändern', 'Login-PIN für dieses Konto', () => pinSheet()),
        (store.me.roles || []).length > 1 && row('users', 'Rolle wechseln', `Aktiv: ${store.me.role}`, switchRole),
        row('out', 'Abmelden', 'Sitzung auf diesem Gerät beenden', logout, 'var(--color-error)'))),
    h('span', { class: 'sub', style: { textAlign: 'center' } }, 'Horrorgeticon Ops · v1.0'));
}

function linkSheet(refresh) {
  const code = h('input', { placeholder: 'XXXX-XXXX', autocapitalize: 'characters', style: { textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', fontWeight: 700 } });
  sheet({
    title: 'Profil verknüpfen', icon: 'link', tone: 'ok',
    sub: 'Code vom Crew-Büro eingeben — dein Login und Tracking laufen danach auf dem offiziellen Datensatz.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'inp', style: { justifyContent: 'center' } }, code),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => {
          const r = await post('/api/auth/link', { code: code.value.trim() });
          store.me.person = r.person;
          store.me.roles = r.roles;
          close();
          toast(`Verknüpft! Du bist jetzt ${r.person.name} (${r.person.code}).`, 'ok');
          refresh();
        }),
      }, ic('check', 17), 'Verknüpfen')),
  });
}

function editSheet(p, orte, refresh) {
  const f = {
    kontakt: h('input', { value: p.kontakt || '' }),
    telefon: h('input', { value: p.telefon || '' }),
    ort: h('select', {}, h('option', { value: '' }, '— Ort wählen —'),
      ...orte.map((o) => h('option', { value: o, selected: o === p.ort }, o))),
    notfallKontakt: h('input', { value: p.notfallKontakt || '', placeholder: 'Name + Nummer' }),
    kostuem: h('input', { value: p.kostuem || '', placeholder: 'z. B. Patient 13, eigene Maske' }),
    essenswunsch: h('input', { value: p.essenswunsch || '', placeholder: 'z. B. vegetarisch' }),
  };
  sheet({
    title: 'Meine Daten', icon: 'user', tone: 'info',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Kontakt', h('div', { class: 'inp' }, f.kontakt)),
      h('label', { class: 'fld' }, 'Telefon', h('div', { class: 'inp' }, f.telefon)),
      h('label', { class: 'fld' }, 'Wohnort', h('div', { class: 'inp' }, f.ort)),
      h('label', { class: 'fld' }, 'Notfallkontakt', h('div', { class: 'inp' }, f.notfallKontakt)),
      h('label', { class: 'fld' }, 'Kostüm/Rolle', h('div', { class: 'inp' }, f.kostuem)),
      h('label', { class: 'fld' }, 'Essenswunsch', h('div', { class: 'inp' }, f.essenswunsch)),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => {
          await post('/api/auth/profile', {
            kontakt: f.kontakt.value, telefon: f.telefon.value, ort: f.ort.value,
            notfallKontakt: f.notfallKontakt.value, kostuem: f.kostuem.value, essenswunsch: f.essenswunsch.value,
          });
          close(); refresh();
        }, 'Gespeichert'),
      }, 'Speichern')),
  });
}

function pinSheet() {
  const alt = h('input', { type: 'password', placeholder: 'aktuelle PIN', inputmode: 'numeric' });
  const neu = h('input', { type: 'password', placeholder: 'neue PIN (mind. 4)', inputmode: 'numeric' });
  sheet({
    title: 'PIN ändern', icon: 'shield', tone: 'info',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Aktuelle PIN', h('div', { class: 'inp' }, alt)),
      h('label', { class: 'fld' }, 'Neue PIN', h('div', { class: 'inp' }, neu)),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => { await post('/api/auth/pin', { alt: alt.value, neu: neu.value }); close(); }, 'PIN geändert'),
      }, 'Ändern')),
  });
}

// ───────── Nicht stören (DND) ─────────
function dndPanel(dndState, refresh) {
  let statusBadge, statusText, actionEl;

  if (dndState.auto && !dndState.manual) {
    statusBadge = badge('ok', 'Automatisch aktiv');
    statusText = 'Aktiv weil du auf Position bist (Live-Phase)';
    actionEl = h('span', { class: 'sub', style: { fontStyle: 'italic' } },
      'DND ist automatisch aktiv. Du kannst es auch manuell ein-/ausschalten.');
  } else if (dndState.manual) {
    statusBadge = badge('warn', 'Manuell aktiviert');
    statusText = 'Du hast DND selbst aktiviert';
    actionEl = h('button', {
      class: 'btn sm orange',
      onclick: () => act(async () => { await post('/api/dnd/disable'); refresh(); }, 'DND deaktiviert'),
    }, ic('check', 14), 'DND deaktivieren');
  } else {
    statusBadge = badge('plain', 'Aus');
    statusText = 'Alle Durchsagen kommen durch';
    actionEl = h('button', {
      class: 'btn sm orange',
      onclick: () => act(async () => { await post('/api/dnd/enable'); refresh(); }, 'DND aktiviert'),
    }, ic('pause', 14), 'DND aktivieren');
  }

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-h' }, ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Nicht stören (DND)')),
    h('div', { class: 'panel-b', style: { gap: '10px' } },
      h('div', { class: 'row', style: { gap: '8px' } }, statusBadge, h('span', { class: 'sub' }, statusText)),
      actionEl,
      h('span', { class: 'sub', style: { fontSize: '12px', lineHeight: 1.4 } },
        'Wenn DND aktiv ist, kommen nur Notfall-Durchsagen durch. Normale Durchsagen werden stumm gehalten.')));
}

// ───────── Fahrgemeinschaft (eigener Bereich) ─────────
function carpoolPanel(state, orte, refresh) {
  const mine = state.mine;
  const myGroups = mine.groups || [];

  const groupRow = (g) => {
    const meId = store.me.person.id;
    const myResp = g.responses?.[meId];
    const isDriver = g.driverId === meId;
    return h('div', { class: 'card pad col', style: { gap: '8px', background: 'var(--bg-muted)', boxShadow: 'none' } },
      h('div', { class: 'row', style: { gap: '8px' } },
        ic('car', 16, { color: 'var(--fg-muted)' }),
        h('span', { class: 'grow', style: { fontSize: '13px', fontWeight: 700 } },
          isDriver ? `Du fährst ab ${g.ort} (${g.departAt})` : `${g.driverName} fährt ab ${g.ort} (${g.departAt})`),
        badge(g.status === 'fix' ? 'ok' : g.status === 'angefragt' ? 'info' : 'plain',
          g.status === 'fix' ? 'Fix' : g.status === 'angefragt' ? 'Anfrage läuft' : 'Vorschlag')),
      h('span', { class: 'sub' }, `Mit dabei: ${g.riderNames.join(', ') || 'noch niemand'}`),
      !isDriver && g.status === 'angefragt' && !myResp && h('div', { class: 'row', style: { gap: '8px' } },
        h('button', {
          class: 'btn sm grow',
          onclick: () => act(async () => { await post(`/api/carpool/groups/${g.id}/respond`, { accept: true }); refresh(); }, 'Zugesagt ✓'),
        }, ic('check', 13), 'Zusagen'),
        h('button', {
          class: 'btn sm quiet grow',
          onclick: () => act(async () => { await post(`/api/carpool/groups/${g.id}/respond`, { accept: false }); refresh(); }, 'Abgesagt'),
        }, ic('x', 13), 'Absagen')),
      myResp && h('span', { class: 'sub', style: { fontWeight: 700, color: myResp === 'zugesagt' ? '#1e7d49' : 'var(--color-error)' } },
        myResp === 'zugesagt' ? '✓ Du hast zugesagt' : '✗ Du hast abgesagt'));
  };

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-h' }, ic('car', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Fahrgemeinschaft'),
      (mine.offer || mine.request) && badge('ok', mine.offer ? `Du bietest ${mine.offer.seats} Plätze` : 'Du suchst einen Platz', { dot: true })),
    h('div', { class: 'panel-b', style: { gap: '10px' } },
      myGroups.length > 0 && h('div', { class: 'col', style: { gap: '8px' } }, myGroups.map(groupRow)),
      h('span', { class: 'sub' },
        'Sag dem System, ob du fährst oder mitfahren willst — das Management bildet daraus die besten Gruppen, du bekommst den Vorschlag direkt in den Chat.'),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn sm grow' + (mine.offer ? ' quiet' : ''), onclick: () => offerSheet(mine.offer, orte, refresh) },
          ic('car', 14), mine.offer ? 'Angebot ändern' : 'Ich fahre'),
        h('button', { class: 'btn sm grow' + (mine.request ? ' quiet' : ''), onclick: () => requestSheet(mine.request, orte, refresh) },
          ic('users', 14), mine.request ? 'Gesuch ändern' : 'Ich suche')),
      (mine.offer || mine.request) && h('button', {
        class: 'btn sm ghost danger-text',
        onclick: () => act(async () => {
          if (mine.offer) await del('/api/carpool/offer');
          if (mine.request) await del('/api/carpool/request');
          refresh();
        }, 'Zurückgezogen'),
      }, 'Zurückziehen')));
}

function offerSheet(existing, orte, refresh) {
  const ort = h('select', {}, ...orte.map((o) => h('option', { value: o, selected: o === (existing?.ort || store.me.person.ort) }, o)));
  const seats = h('input', { type: 'number', value: existing?.seats ?? 3, min: 1, max: 8 });
  const departAt = h('input', { type: 'time', value: existing?.departAt || '16:30' });
  const note = h('input', { value: existing?.note || '', placeholder: 'z. B. Kombi, Platz für Requisiten' });
  sheet({
    title: 'Ich fahre — Plätze anbieten', icon: 'car', tone: 'ok',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Abfahrtsort', h('div', { class: 'inp' }, ort)),
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Freie Plätze', h('div', { class: 'inp' }, seats)),
        h('label', { class: 'fld' }, 'Abfahrt (hin)', h('div', { class: 'inp' }, departAt))),
      h('label', { class: 'fld' }, 'Notiz', h('div', { class: 'inp' }, note)),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => {
          await post('/api/carpool/offer', { ort: ort.value, seats: Number(seats.value), departAt: departAt.value, note: note.value });
          close(); refresh();
        }, 'Fahrangebot steht — danke! 🚗'),
      }, 'Angebot speichern')),
  });
}

function requestSheet(existing, orte, refresh) {
  const ort = h('select', {}, ...orte.map((o) => h('option', { value: o, selected: o === (existing?.ort || store.me.person.ort) }, o)));
  const departAt = h('input', { type: 'time', value: existing?.departAt || '16:30' });
  const flex = h('input', { type: 'number', value: existing?.flexMin ?? 30, min: 0 });
  sheet({
    title: 'Ich suche eine Mitfahrt', icon: 'users', tone: 'info',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Abfahrtsort', h('div', { class: 'inp' }, ort)),
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Wunsch-Abfahrt', h('div', { class: 'inp' }, departAt)),
        h('label', { class: 'fld' }, 'Flexibel (± min)', h('div', { class: 'inp' }, flex))),
      h('button', {
        class: 'btn lg orange',
        onclick: () => act(async () => {
          await post('/api/carpool/request', { ort: ort.value, departAt: departAt.value, flexMin: Number(flex.value) });
          close(); refresh();
        }, 'Gesuch gespeichert — du bekommst einen Vorschlag'),
      }, 'Gesuch speichern')),
  });
}
