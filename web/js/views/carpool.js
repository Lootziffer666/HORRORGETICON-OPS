// Management · Fahrgruppen — Angebote/Gesuche, automatisches Matching
// („Beste Option“), Vorschlag mit vorgefertigter Nachricht senden, Status.
import { h, ic, badge, av, panel } from '../core/dom.js';
import { get, post, act, download } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet } from '../core/ui.js';

const gStatus = { vorschlag: ['plain', 'Vorschlag'], angefragt: ['info', 'Angefragt'], fix: ['ok', 'Fix'], aufgelöst: ['plain', 'Aufgelöst'] };

export async function carpoolView({ onCleanup, refresh }) {
  const state = await get('/api/carpool/state');
  onCleanup(on(['carpool'], refresh));

  const groupCard = (g) => h('div', { class: 'card pad col', style: { gap: '10px', borderColor: g.best ? 'var(--color-secondary)' : undefined, boxShadow: g.best ? '0 0 0 1px var(--color-secondary), var(--shadow-1)' : undefined } },
    h('div', { class: 'row', style: { gap: '8px' } },
      h('span', { class: 'av navy' }, ic('car', 15)),
      h('div', { class: 'col grow', style: { gap: 0 } },
        h('span', { style: { fontWeight: 800, fontSize: '14px', fontFamily: 'var(--font-display)' } },
          `${g.driverName} · ab ${g.ort}`),
        h('span', { class: 'sub' }, `Abfahrt ${g.departAt} · ${g.riderIds.length}/${g.seats} Plätze · Umweg ≈ ${String(g.detourKm).replace('.', ',')} km`)),
      g.best && badge('warn', '★ Beste Option', { style: { background: 'rgba(242,153,74,0.18)', color: '#c97820' } }),
      badge(...gStatus[g.status] || gStatus.vorschlag)),
    h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      ...g.riderNames.map((n, i) => {
        const rid = g.riderIds[i];
        const resp = g.responses?.[rid];
        return h('span', { class: 'chip', style: resp === 'zugesagt' ? { borderColor: 'var(--color-success)', color: '#1e7d49' } : resp === 'abgelehnt' ? { borderColor: 'var(--color-error)', color: 'var(--color-error)' } : null },
          resp === 'zugesagt' ? '✓ ' : resp === 'abgelehnt' ? '✗ ' : '', n);
      })),
    g.status === 'vorschlag' && h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn sm orange grow', onclick: () => sendSheet(g, refresh) }, ic('send', 14), 'Vorschlag an Gruppe senden'),
      h('button', {
        class: 'btn sm quiet', title: 'Auflösen',
        onclick: () => act(async () => { await post(`/api/carpool/groups/${g.id}/dissolve`); refresh(); }),
      }, ic('x', 13))),
    g.status === 'angefragt' && h('span', { class: 'sub' }, '📨 Nachricht ist raus — wartet auf Zu-/Absagen im Gruppen-Chat.'),
    g.status === 'fix' && h('span', { class: 'sub', style: { color: '#1e7d49', fontWeight: 700 } }, '✅ Alle haben zugesagt — Gruppe steht.'));

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'sub', style: { fontWeight: 700 } },
        `${state.offers.length} Fahrangebote · ${state.requests.length} Mitfahrwünsche · Ziel: ${state.site.name}`),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/csv/export/fahrgruppen') }, ic('download', 14), 'CSV'),
      h('button', {
        class: 'btn sm orange',
        onclick: () => act(async () => {
          const r = await post('/api/carpool/match');
          refresh();
          return r;
        }, 'Matching ausgeführt — Vorschläge unten'),
      }, ic('refresh', 14), 'Beste Gruppen berechnen')),

    h('div', { class: 'cols-2', style: { gridTemplateColumns: '1fr 340px' } },
      h('div', { class: 'col scroll-y', style: { gap: '10px' } },
        state.groups.length === 0
          ? h('div', { class: 'empty-hint card' }, 'Noch keine Gruppen — oben „Beste Gruppen berechnen“ klicken.')
          : state.groups.map(groupCard)),
      h('div', { class: 'col', style: { gap: '14px', minHeight: 0 } },
        panel([ic('car', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Fahrangebote')],
          state.offers.length === 0 ? h('div', { class: 'empty-hint' }, 'Keine Angebote.')
            : state.offers.map((o) => h('div', { class: 'prow', style: { gap: '10px' } },
              av(o.name),
              h('div', { class: 'col grow', style: { gap: 0 } },
                h('span', { class: 'nm', style: { fontSize: '13px' } }, o.name),
                h('span', { class: 'mt' }, `ab ${o.ort} · ${o.departAt} Uhr · ±${o.tolMin} min`)),
              badge('plain', `${o.seats} Plätze`))),
          { scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }),
        panel([ic('users', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Mitfahrwünsche')],
          state.requests.length === 0 ? h('div', { class: 'empty-hint' }, 'Keine Gesuche.')
            : state.requests.map((r) => h('div', { class: 'prow', style: { gap: '10px' } },
              av(r.name),
              h('div', { class: 'col grow', style: { gap: 0 } },
                h('span', { class: 'nm', style: { fontSize: '13px' } }, r.name),
                h('span', { class: 'mt' }, `ab ${r.ort} · ${r.departAt} Uhr · ±${r.flexMin} min`)))),
          { grow: true, scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }))));
}

async function sendSheet(g, refresh) {
  const templates = await get('/api/carpool/templates');
  let tpl = templates[0]?.id || 'vorschlag';
  const custom = h('textarea', { rows: 3, placeholder: 'Eigener Text (überschreibt die Vorlage) — leer lassen für Vorlagentext' });
  sheet({
    title: 'Vorschlag an die Gruppe senden', icon: 'send', tone: 'info', center: true,
    sub: `${g.driverName} + ${g.riderNames.join(', ')} — es entsteht ein eigener Gruppen-Chat, alle bekommen die Nachricht direkt aufs Gerät.`,
    content: (close) => {
      const row = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
      const draw = () => row.replaceChildren(...templates.map((t) =>
        h('span', { class: 'chip' + (tpl === t.id ? ' active' : ''), onclick: () => { tpl = t.id; draw(); } }, t.name)));
      draw();
      return h('div', { class: 'col', style: { gap: '12px' } },
        h('label', { class: 'fld' }, 'Vorlage', row),
        h('label', { class: 'fld' }, 'Eigener Text (optional)', h('div', { class: 'inp area' }, custom)),
        h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn orange',
            onclick: () => act(async () => {
              await post(`/api/carpool/groups/${g.id}/send`, { template: tpl, textOverride: custom.value.trim() || undefined });
              close(); refresh();
            }, 'Nachricht an die Gruppe gesendet'),
          }, ic('send', 15), 'Senden')));
    },
  });
}
