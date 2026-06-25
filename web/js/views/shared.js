// Gemeinsame Fach-Bausteine: Maze-Schemakarte, Geländekarte, Feed, KPI,
// Pausen-Anfrage-Karten, Personenzeilen — überall im selben Mockup-Look.
import { h, ic, badge, av, bar, panel, statusTone, statusLabel } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { ago, minSince } from '../core/fmt.js';
import { sheet, toast } from '../core/ui.js';
import { store } from '../core/store.js';

// ───────── Maze-Schemakarte (Räume + Pins) ─────────
export function mazeMapEl(maze, { meId = null, grow = false, height = 330, onPin = null } = {}) {
  const el = h('div', { class: 'maze-map', style: grow ? { flex: 1, minHeight: '260px' } : { height: height + 'px', flex: 'none' } });
  for (const r of maze.rooms || []) {
    el.appendChild(h('div', { class: 'room' + (r.hall ? ' hall' : ''), style: { left: r.x, top: r.y, width: r.w, height: r.h } }, h('span', {}, r.n)));
  }
  for (const p of maze.positions || []) {
    if (!p.room) continue;
    const me = meId && p.person?.id === meId;
    const cls = p.status === 'leer' ? ' empty' : p.status === 'vorfall' ? ' err' : p.status === 'pause' ? ' warn' : p.status === 'stumm' || p.status === 'out' ? ' stumm' : '';
    const pin = h('div', {
      class: 'pin' + (me ? ' me' : '') + cls,
      style: { left: p.room.x, top: p.room.y },
      onclick: onPin ? () => onPin(p) : null,
      title: `${p.code} ${p.name || ''} — ${p.person?.name || 'unbesetzt'}`,
    },
      h('b', {}, p.code),
      h('small', {}, p.status === 'leer' ? 'unbesetzt' : me ? 'Du' : (p.person?.name || '').split(' ')[0]));
    el.appendChild(pin);
  }
  el.appendChild(h('div', { class: 'exit', style: { left: '8%', top: '96%', transform: 'translate(0,-100%)' } }, '⟶ Notausgang West'));
  el.appendChild(h('div', { class: 'exit', style: { left: '92%', top: '96%', transform: 'translate(-100%,-100%)' } }, 'Notausgang Ost ⟶'));
  return el;
}

export const mazeLegend = (own = false) => h('div', { class: 'legend' },
  own && h('span', {}, h('i', { style: { background: 'var(--color-secondary)' } }), 'Deine Position'),
  h('span', {}, h('i', { style: { background: 'var(--color-primary)' } }), own ? 'Kolleg:innen' : 'Besetzt'),
  h('span', {}, h('i', { style: { background: 'transparent', border: '1.5px dashed var(--fg-muted)', boxSizing: 'border-box' } }), 'Unbesetzt'),
  h('span', {}, h('i', { style: { background: 'var(--color-error)' } }), 'Vorfall'),
  h('span', {}, h('i', { style: { background: 'var(--color-success)' } }), 'Notausgang'));

// ───────── Geländekarte (Zonen) ─────────
export function siteMapEl(overview, { onZone = null, activeId = null } = {}) {
  const el = h('div', { class: 'site-map' });
  el.appendChild(h('div', { class: 'path-line', style: { left: '50%', top: '4%', width: '2px', height: '92%' } }));
  el.appendChild(h('div', { class: 'path-line', style: { left: '4%', top: '34%', width: '92%', height: '2px' } }));
  el.appendChild(h('div', { class: 'path-line', style: { left: '4%', top: '66%', width: '92%', height: '2px' } }));
  for (const m of overview.mazes) {
    if (!m.zone) continue;
    const st = m.status;
    el.appendChild(h('div', {
      class: 'zone' + (st === 'err' ? ' crit' : st === 'warn' ? ' warn-z' : '') + (activeId === m.id ? ' on' : ''),
      style: { left: m.zone.x, top: m.zone.y, width: m.zone.w, height: m.zone.h || '26%' },
      onclick: onZone ? () => onZone(m) : null,
    },
      h('span', { class: 'z-name' }, h('span', { class: 'z-st ' + st }), m.name),
      h('span', { class: 'z-meta' }, m.meta),
      h('div', { class: 'bar', style: { maxWidth: '110px' } },
        h('i', { class: st === 'ok' ? 'ok' : st, style: { width: (m.total ? Math.round((m.besetzt / m.total) * 100) : 0) + '%' } }))));
  }
  for (const z of overview.zones || []) {
    const ghost = z.kind === 'ghost';
    el.appendChild(h('div', {
      class: 'zone' + (z.status === 'err' ? ' crit' : z.status === 'warn' ? ' warn-z' : '') + (ghost ? ' ghost' : ''),
      style: { left: z.x, top: z.y, width: z.w, height: z.h || '26%' },
    },
      h('span', { class: 'z-name', style: ghost ? { color: 'var(--fg-muted)' } : null },
        !ghost && h('span', { class: 'z-st ' + (z.status || 'ok') }), z.name),
      h('span', { class: 'z-meta' }, z.meta || z.note || '')));
  }
  return el;
}

// ───────── KPI-Karte ─────────
export function kpi(value, label, detail, { tone = null, alert = false, suffix = null } = {}) {
  return h('div', { class: 'card kpi' + (alert ? ' alert' : '') },
    h('span', { class: 'v', style: tone ? { color: tone } : null }, value,
      suffix && h('span', { style: { fontSize: '15px', color: 'var(--fg-muted)' } }, ` ${suffix}`)),
    h('span', { class: 'l' }, label),
    detail && h('span', { class: 'd' + (typeof detail === 'string' ? ' muted' : ''), style: detail.tone ? { color: detail.tone } : null },
      typeof detail === 'string' ? detail : detail.text));
}

// ───────── Feed ─────────
export function feedList(items, { limit = 30 } = {}) {
  if (!items.length) return h('div', { class: 'empty-hint' }, 'Noch keine Einträge.');
  return h('div', { class: 'feed' }, items.slice(0, limit).map((f) => h('div', { class: 'f-row' },
    h('span', { class: 'f-time' }, f.time),
    h('div', { class: 'col grow', style: { gap: '1px' } },
      h('span', { class: 'f-txt' }, f.text),
      h('span', { class: 'f-meta' }, [f.by, f.scope !== 'all' ? f.scope : null].filter(Boolean).join(' · '))))));
}

// ───────── Personen-Zeile mit Status ─────────
export function personRow(p, { sub = null, right = null, onclick = null } = {}) {
  return h('div', { class: 'prow' + (onclick ? ' click' : ''), onclick },
    av(p.name),
    h('div', { class: 'col grow', style: { gap: 0 } },
      h('span', { class: 'nm' }, p.name),
      h('span', { class: 'mt' }, sub ?? [p.maze, p.position].filter(Boolean).join(' · ') ?? '')),
    right);
}

export const statusBadge = (st) => badge(statusTone[st] || 'plain', statusLabel[st] || st, { dot: true });

// ───────── Pausen-Anfrage (Karte mit Freigabe) ─────────
export function breakRequestCard(b, { compact = false, onDone = null } = {}) {
  const approve = (inMin) => act(async () => {
    await post(`/api/breaks/${b.id}/approve`, { inMin });
    onDone?.();
  }, inMin ? `Pause in ${inMin} min freigegeben` : 'Pause freigegeben');
  const deny = () => act(async () => { await post(`/api/breaks/${b.id}/deny`, {}); onDone?.(); }, 'Anfrage abgelehnt');
  return h('div', { class: 'col', style: { gap: '10px' } },
    h('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-start' } },
      av(b.person, { tone: 'navy', size: compact ? '' : 'lg' }),
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('span', { style: { fontSize: compact ? '13.5px' : '14px', fontWeight: 700 } },
          `${b.person}${b.position ? ' · ' + b.position : ''}`,
          b.wartetSeitMin >= 10 ? h('span', { style: { color: 'var(--color-error)', fontWeight: 800 } }, '  ·!') : null),
        h('span', { class: 'sub' },
          `Angefragt ${b.time} · wartet ${b.wartetSeitMin} min${b.letztePauseVorMin != null ? ` · letzte Pause vor ${Math.floor(b.letztePauseVorMin / 60)}:${String(b.letztePauseVorMin % 60).padStart(2, '0')} h` : ''}`),
        b.note && h('span', { class: 'sub', style: { color: 'var(--fg-secondary)' } }, `„${b.note}“`))),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn grow' + (compact ? ' sm' : ''), onclick: () => approve(0) }, ic('check', compact ? 14 : 16), 'Freigeben'),
      h('button', { class: 'btn quiet grow' + (compact ? ' sm' : ''), onclick: () => approve(15) }, ic('clock', compact ? 14 : 16), 'In 15 min'),
      h('button', { class: 'btn quiet' + (compact ? ' sm' : ''), onclick: deny }, ic('x', compact ? 14 : 16))),
    springerHint(b));
}

function springerHint(b) {
  const box = h('div');
  get('/api/breaks/springer').then((list) => {
    const frei = list.find((s) => s.frei);
    if (!frei) return;
    box.appendChild(h('div', { class: 'card pad row', style: { background: 'var(--bg-muted)', boxShadow: 'none', padding: '10px', gap: '8px' } },
      ic('users', 15, { color: 'var(--fg-muted)' }),
      h('span', { class: 'sub', style: { fontSize: '12px' } },
        'Springer verfügbar: ', h('b', { style: { color: 'var(--fg-primary)' } }, frei.name),
        b.position ? ` kann ${b.position} übernehmen` : '')));
  }).catch(() => { /* Hinweis ist optional */ });
  return box;
}

// ───────── Durchsage-Composer (Management + Lead) ─────────
export async function announceSheet({ mazeId = null, level = 'wichtig' } = {}) {
  const [templates, mazes] = await Promise.all([
    get('/api/announce/templates').catch(() => []),
    get('/api/mazes').catch(() => []),
  ]);
  let scope = mazeId ? { type: 'maze', mazeId } : { type: 'all' };
  let lvl = level;
  const text = h('textarea', { placeholder: 'Was sollen alle wissen? …', rows: 3 });

  sheet({
    title: 'Durchsage senden', icon: 'mega', tone: lvl === 'notfall' ? 'err' : 'info', center: true,
    sub: 'Notfall erscheint als Vollbild-Alarm mit Lesebestätigung',
    content: (close) => {
      const scopeRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
      const drawScope = () => {
        scopeRow.replaceChildren(
          h('span', { class: 'chip' + (scope.type === 'all' ? ' active' : ''), onclick: () => { scope = { type: 'all' }; drawScope(); } }, 'An alle'),
          ...mazes.map((m) => h('span', {
            class: 'chip' + (scope.type === 'maze' && scope.mazeId === m.id ? ' active' : ''),
            onclick: () => { scope = { type: 'maze', mazeId: m.id }; drawScope(); },
          }, `Nur ${m.name}`)));
      };
      drawScope();
      const segs = h('div', { class: 'seg' });
      const drawSeg = () => {
        segs.replaceChildren(...[['info', 'Info'], ['wichtig', 'Wichtig'], ['notfall', 'Notfall — Alarm']].map(([v, l]) =>
          h('span', { class: lvl === v ? 'on' : '', style: v === 'notfall' && lvl === v ? { color: 'var(--color-error)' } : null, onclick: () => { lvl = v; drawSeg(); } }, l)));
      };
      drawSeg();
      return h('div', { class: 'col', style: { gap: '14px' } },
        h('label', { class: 'fld' }, 'Empfänger', scopeRow),
        h('label', { class: 'fld' }, 'Stufe', segs),
        h('label', { class: 'fld' }, 'Vorlagen',
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            ...templates.map((t) => h('span', { class: 'chip', onclick: () => { text.value = t.text; lvl = t.level; drawSeg(); } }, t.text.slice(0, 32) + (t.text.length > 32 ? '…' : ''))))),
        h('div', { class: 'inp area' }, text),
        h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn ' + (lvl === 'notfall' ? 'danger' : 'orange'),
            onclick: async () => {
              if (!text.value.trim()) { toast('Text fehlt', 'err'); return; }
              await act(async () => {
                await post('/api/announcements', { text: text.value.trim(), level: lvl, scope });
                close();
              }, 'Durchsage gesendet');
            },
          }, ic('send', 16), lvl === 'notfall' ? 'Warnung senden' : 'Senden')));
    },
  });
}

// ───────── Meldung erfassen (Actor-Sheet & Leitstand) ─────────
export function incidentSheet({ onDone = null } = {}) {
  let kind = 'technik', prio = 'mittel';
  const text = h('textarea', { placeholder: 'Stroboskop in C3 ausgefallen, Abschnitt ist zu dunkel …', rows: 3 });
  sheet({
    title: 'Warnung melden', icon: 'alert', tone: 'err',
    sub: 'Geht sofort an Maze Lead + Leitstand',
    content: (close) => {
      const seg = h('div', { class: 'seg' });
      const drawKind = () => seg.replaceChildren(...[['notfall', 'Notfall'], ['technik', 'Technik'], ['gast', 'Gast-Vorfall']].map(([v, l]) =>
        h('span', { class: kind === v ? 'on' : '', onclick: () => { kind = v; prio = v === 'notfall' ? 'hoch' : prio; drawPrio(); drawKind(); } }, l)));
      const prioRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
      const drawPrio = () => prioRow.replaceChildren(
        h('span', { class: 'chip' + (prio === 'niedrig' ? ' active' : ''), onclick: () => { prio = 'niedrig'; drawPrio(); } }, 'Niedrig'),
        h('span', { class: 'chip' + (prio === 'mittel' ? ' active' : ''), onclick: () => { prio = 'mittel'; drawPrio(); } }, 'Mittel'),
        h('span', {
          class: 'chip' + (prio === 'hoch' ? ' active' : ''),
          style: prio === 'hoch' ? { background: 'var(--color-error)', borderColor: 'var(--color-error)', color: '#fff' } : null,
          onclick: () => { prio = 'hoch'; drawPrio(); },
        }, 'Hoch — Position verlassen'));
      drawKind(); drawPrio();
      return h('div', { class: 'col', style: { gap: '14px' } },
        h('label', { class: 'fld' }, 'Art der Meldung', seg),
        h('label', { class: 'fld' }, 'Dringlichkeit', prioRow),
        h('label', { class: 'fld' }, 'Was ist passiert?', h('div', { class: 'inp area' }, text)),
        h('div', { class: 'card pad row', style: { gap: '10px', background: 'var(--bg-muted)', boxShadow: 'none', padding: '11px' } },
          ic('pin', 16, { color: 'var(--fg-muted)' }),
          h('span', { class: 'sub', style: { fontSize: '12.5px' } }, 'Deine Position wird automatisch mitgesendet')),
        h('button', {
          class: 'btn lg danger',
          onclick: async () => {
            if (!text.value.trim()) { toast('Bitte kurz beschreiben, was passiert ist', 'err'); return; }
            await act(async () => {
              await post('/api/incidents', { kind, prio, text: text.value.trim(), leavePosition: prio === 'hoch' });
              close(); onDone?.();
            }, 'Warnung gesendet — Lead & Leitstand sind informiert');
          },
        }, ic('send', 17), 'Warnung senden'));
    },
  });
}

// ───────── Event-Phasen (Lifecycle) ─────────
export const PHASES = ['vorbereitung', 'aufbau', 'live', 'abschluss'];
export const PHASE_META = {
  vorbereitung: { label: 'Vorbereitung', tone: 'plain', icon: 'cal', hint: 'Planung & Stammdaten — Tracking ruht.' },
  aufbau: { label: 'Aufbau', tone: 'info', icon: 'gear', hint: 'Rundgänge & Aufbau-Aufgaben stehen im Fokus.' },
  live: { label: 'LIVE', tone: 'ok', icon: 'radio', hint: 'Show läuft — Lagebild, Pausen, Meldungen.' },
  abschluss: { label: 'Abschluss', tone: 'warn', icon: 'check', hint: 'Sweep, Übergaben, Berichte, Heimfahrt.' },
};

export function phaseBadge(phase) {
  const m = PHASE_META[phase] || PHASE_META.vorbereitung;
  return badge(m.tone, [ic(m.icon, 12), ` ${m.label}`], { dot: phase === 'live' });
}

// Phasen-Sheet (nur Management): Phase wechseln mit Hinweis, was passiert
export function phaseSheet(currentPhase, onChanged) {
  sheet({
    title: 'Event-Phase', icon: 'cal', tone: 'info', center: true,
    sub: 'Steuert, was die Crew sieht — Wechsel auf Live/Abschluss sendet automatisch eine Durchsage.',
    content: (close) => h('div', { class: 'col', style: { gap: '10px' } },
      ...PHASES.map((p) => {
        const m = PHASE_META[p];
        const on = p === currentPhase;
        return h('div', {
          class: 'card pad row role-card', style: { gap: '12px', padding: '14px', borderColor: on ? 'var(--color-secondary)' : undefined, boxShadow: on ? '0 0 0 1px var(--color-secondary), var(--shadow-1)' : undefined },
          onclick: on ? null : () => act(async () => {
            await post('/api/settings/phase', { phase: p });
            close(); onChanged?.();
          }, `Phase: ${m.label}`),
        },
          h('span', { class: 'av lg navy', style: { borderRadius: '12px' } }, ic(m.icon, 20)),
          h('div', { class: 'col grow', style: { gap: '2px' } },
            h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '15px' } }, m.label),
            h('span', { class: 'sub' }, m.hint)),
          on ? badge('ok', 'Aktiv', { dot: true }) : ic('chev', 16, { color: 'var(--fg-muted)' }));
      })),
  });
}

// ───────── Actor-Detail-Status + Verspätung ─────────
export const ACTOR_STATUS_META = {
  anreise: { label: 'Auf Anreise', icon: 'car' },
  da: { label: 'Da', icon: 'check' },
  maske: { label: 'In der Maske', icon: 'user' },
  backstage: { label: 'Backstage', icon: 'door' },
  position: { label: 'Auf Position', icon: 'pin' },
  nicht_verfuegbar: { label: 'Nicht verfügbar', icon: 'x' },
};

export function lateBadge(late) {
  if (!late) return null;
  return badge('warn', `⏰ +${late.etaMin} min`, { style: null });
}

export function lateSheet(onDone) {
  let eta = 15;
  const reason = h('input', { placeholder: 'Grund (optional), z. B. Stau auf der B27' });
  sheet({
    title: 'Verspätung melden', icon: 'clock', tone: 'warn',
    sub: 'Geht an Lead + Leitstand — dein Platz bleibt für dich reserviert.',
    content: (close) => {
      const row = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
      const draw = () => row.replaceChildren(...[10, 15, 30, 45, 60].map((m) =>
        h('span', { class: 'chip' + (eta === m ? ' active' : ''), onclick: () => { eta = m; draw(); } }, `~${m} min`)));
      draw();
      return h('div', { class: 'col', style: { gap: '12px' } },
        h('label', { class: 'fld' }, 'Ich brauche noch etwa …', row),
        h('label', { class: 'fld' }, 'Grund', h('div', { class: 'inp' }, reason)),
        h('button', {
          class: 'btn lg orange',
          onclick: () => act(async () => {
            await post('/api/live/late', { etaMin: eta, reason: reason.value.trim() });
            close(); onDone?.();
          }, 'Gemeldet — komm gut an!'),
        }, ic('send', 17), 'Verspätung melden'));
    },
  });
}

export const prioTone = { hoch: 'err', mittel: 'warn', niedrig: 'info' };
export const prioLabel = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' };
export const incStatusTone = { offen: 'err', in_arbeit: 'warn', erledigt: 'ok' };
export const incStatusLabel = { offen: 'Offen', in_arbeit: 'In Arbeit', erledigt: 'Erledigt' };
export const kindLabel = { notfall: 'Notfall', technik: 'Technik', gast: 'Gast', getraenk: 'Getränk', sonstiges: 'Sonstiges' };
