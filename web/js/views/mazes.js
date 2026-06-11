// Management · Mazes & Zuteilung — Pitch-Screen „Mazes & Zuteilung“:
// Spalten je Maze, Pool „Nicht zugeteilt“, Zuteilen per Drag & Drop oder Klick,
// Konflikte (offen/doppelt) sichtbar, Positionen/Mazes anlegen.
import { h, ic, badge, av } from '../core/dom.js';
import { get, post, patch, act, download } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';

export async function mazesView({ onCleanup, refresh }) {
  const [mazes, issues] = await Promise.all([get('/api/mazes'), get('/api/assignments/issues')]);
  const details = await Promise.all(mazes.map((m) => get(`/api/mazes/${m.id}`)));
  onCleanup(on(['mazes', 'people'], refresh));

  let dragPerson = null;

  const personChip = (p, fromPosId = null) => {
    const el = h('div', {
      class: 'prow drag-person', draggable: 'true', style: { padding: '6px 0' },
      ondragstart: (e) => { dragPerson = { id: p.id, fromPosId }; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; },
      ondragend: () => { dragPerson = null; el.classList.remove('dragging'); },
    },
      av(p.name),
      h('div', { class: 'col grow', style: { gap: 0 } },
        h('span', { class: 'nm', style: { fontSize: '12.5px' } }, p.name),
        h('span', { class: 'mt' }, (p.roles || []).includes('springer') ? 'Springer' : p.ort || '')));
    return el;
  };

  const posRow = (pos, maze) => {
    const row = h('div', {
      class: 'prow drop-pos', style: { padding: '7px 4px', gap: '8px' },
      ondragover: (e) => { e.preventDefault(); row.classList.add('over'); },
      ondragleave: () => row.classList.remove('over'),
      ondrop: async (e) => {
        e.preventDefault(); row.classList.remove('over');
        if (!dragPerson) return;
        await act(() => post(`/api/positions/${pos.id}/assign`, { personId: dragPerson.id }), `Zugeteilt: ${pos.code}`);
        refresh();
      },
    },
      h('span', {
        class: 'av', style: pos.person ? null : { background: 'transparent', border: '2px dashed var(--fg-muted)', color: 'var(--fg-muted)' },
      }, pos.code),
      h('div', { class: 'col grow', style: { gap: 0 } },
        h('span', { class: 'nm', style: { fontSize: '12.5px' } }, pos.person ? pos.person.name : h('span', { class: 'muted' }, 'offen — zuteilen')),
        h('span', { class: 'mt' }, pos.name || '')),
      pos.person
        ? h('button', {
          class: 'btn sm quiet', title: 'Zuteilung lösen',
          onclick: () => act(async () => { await post(`/api/positions/${pos.id}/assign`, { personId: null }); refresh(); }, 'Gelöst'),
        }, ic('x', 13))
        : h('button', { class: 'btn sm quiet', onclick: () => pickSheet(pos, maze, issues.unassigned, refresh) }, 'Wählen'));
    return row;
  };

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'sub', style: { fontWeight: 700 } },
        `${mazes.length} Mazes · ${details.reduce((s, d) => s + d.positions.length, 0)} Positionen · per Drag & Drop einer Position zuordnen`),
      issues.doubles.length > 0 && badge('err', `${issues.doubles.length} Doppel-Zuteilung(en)!`, { dot: true }),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/csv/export/zuteilung') }, ic('download', 14), 'Zuteilung exportieren'),
      h('button', { class: 'btn sm quiet', onclick: () => mazeSheet(null, refresh) }, ic('plus', 14), 'Maze'),
      h('button', { class: 'btn sm orange', onclick: () => positionSheet(mazes, refresh) }, ic('plus', 14), 'Position')),

    h('div', { class: 'row grow', style: { gap: '12px', alignItems: 'stretch', overflow: 'auto', minHeight: 0, flexWrap: 'nowrap' } },
      // Pool: nicht zugeteilt
      h('div', { class: 'panel', style: { width: '240px', flex: 'none', display: 'flex' } },
        h('div', { class: 'panel-h' }, ic('users', 15, { color: 'var(--fg-muted)' }),
          h('span', { class: 't' }, 'Nicht zugeteilt'), badge(issues.unassigned.length ? 'warn' : 'ok', String(issues.unassigned.length))),
        h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } },
          issues.unassigned.length === 0 ? h('div', { class: 'empty-hint' }, 'Alle eingeteilt 🎉')
            : issues.unassigned.map((p) => personChip(p)))),
      // Maze-Spalten
      ...details.map((d) => h('div', { class: 'panel', style: { width: '270px', flex: 'none', display: 'flex' } },
        h('div', { class: 'panel-h', style: { cursor: 'pointer' }, onclick: () => mazeSheet(d, refresh) },
          ic('door', 15, { color: 'var(--fg-muted)' }),
          h('div', { class: 'col', style: { gap: 0 } },
            h('span', { class: 't' }, d.name),
            h('span', { class: 'sub', style: { fontSize: '10.5px' } }, d.lead ? `Lead: ${d.lead}` : 'kein Lead')),
          badge(d.besetzt === d.positionen ? 'ok' : 'warn', `${d.besetzt} / ${d.positionen}`)),
        h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } },
          d.positions.map((pos) => posRow(pos, d)))))));
}

function pickSheet(pos, maze, unassigned, refresh) {
  sheet({
    title: `${pos.code} ${pos.name ? `„${pos.name}“` : ''} besetzen`, icon: 'pin', tone: 'info', center: true,
    sub: `${maze.name} · ${pos.desc || 'Scare-Position'}`,
    content: (close) => h('div', { class: 'col', style: { gap: 0, maxHeight: '50vh', overflow: 'auto' } },
      unassigned.length === 0 ? h('div', { class: 'empty-hint' }, 'Niemand frei — Person zuerst woanders lösen.')
        : unassigned.map((p) => h('div', {
          class: 'prow click', onclick: () => act(async () => {
            await post(`/api/positions/${pos.id}/assign`, { personId: p.id });
            close(); refresh();
          }, `${p.name} → ${pos.code}`),
        },
          av(p.name),
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { class: 'nm' }, p.name),
            h('span', { class: 'mt' }, [(p.roles || []).includes('springer') ? 'Springer' : null, p.ort].filter(Boolean).join(' · '))),
          ic('chev', 15, { color: 'var(--fg-muted)' })))),
  });
}

function mazeSheet(d, refresh) {
  const isNew = !d;
  const name = h('input', { value: d?.name || '', placeholder: 'z. B. Hexenwald' });
  const short = h('input', { value: d?.short || '', placeholder: 'H' });
  sheet({
    title: isNew ? 'Maze anlegen' : `${d.name} bearbeiten`, icon: 'door', tone: 'info', center: true,
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, name)),
        h('label', { class: 'fld' }, 'Kürzel', h('div', { class: 'inp' }, short))),
      h('span', { class: 'sub' }, 'Positionen entstehen über „+ Position“; Raum-Pins lassen sich in der DB-Pflege fein justieren.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => act(async () => {
            if (isNew) await post('/api/mazes', { name: name.value.trim(), short: short.value.trim() });
            else await patch(`/api/mazes/${d.id}`, { name: name.value.trim(), short: short.value.trim() });
            close(); refresh();
          }, 'Gespeichert'),
        }, 'Speichern'))),
  });
}

function positionSheet(mazes, refresh) {
  const sel = h('select', {}, ...mazes.map((m) => h('option', { value: m.id }, m.name)));
  const code = h('input', { placeholder: 'z. B. A12' });
  const name = h('input', { placeholder: 'z. B. Dachboden' });
  const desc = h('input', { placeholder: 'Scare-Punkt / Trigger (optional)' });
  sheet({
    title: 'Position anlegen', icon: 'pin', tone: 'info', center: true,
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Maze', h('div', { class: 'inp' }, sel)),
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Kürzel', h('div', { class: 'inp' }, code)),
        h('label', { class: 'fld' }, 'Bezeichnung', h('div', { class: 'inp' }, name))),
      h('label', { class: 'fld' }, 'Beschreibung', h('div', { class: 'inp' }, desc)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => {
            if (!code.value.trim()) { toast('Kürzel fehlt', 'err'); return; }
            act(async () => {
              await post('/api/positions', { mazeId: sel.value, code: code.value.trim(), name: name.value.trim(), desc: desc.value.trim() });
              close(); refresh();
            }, 'Position angelegt');
          },
        }, 'Anlegen'))),
  });
}
