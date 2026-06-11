// Management · Datenbank-Pflege — Collections durchsuchen, Datensätze als JSON
// bearbeiten/löschen, Undo, Konsistenz-Prüfung, Audit-Trail.
import { h, ic, badge, panel } from '../core/dom.js';
import { get, put, del, post, act } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet, toast, confirmDialog } from '../core/ui.js';

let col = 'people', q = '', offset = 0;

export async function dbadminView({ onCleanup, refresh }) {
  const cols = await get('/api/db/collections');
  if (!cols.some((c) => c.name === col)) col = cols[0]?.name || 'people';
  const [page, validate, audit] = await Promise.all([
    get(`/api/db/col/${col}?q=${encodeURIComponent(q)}&offset=${offset}&limit=40`),
    get('/api/db/validate'),
    get('/api/db/audit?limit=12'),
  ]);
  onCleanup(on(['db'], refresh));
  const current = cols.find((c) => c.name === col);

  const search = h('input', { placeholder: 'Volltext in dieser Collection …', value: q });
  search.addEventListener('input', debounce(() => { q = search.value; offset = 0; refresh(); }, 350));

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    !validate.ok && h('div', { class: 'card pad row', style: { gap: '10px', borderColor: 'var(--color-warning)' } },
      ic('alert', 17, { color: '#b8901c' }),
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('span', { style: { fontWeight: 700, fontSize: '13px' } }, `Konsistenz-Prüfung: ${validate.issues.length} Befund(e)`),
        ...validate.issues.slice(0, 4).map((i) => h('span', { class: 'sub' }, i)))),

    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      ...cols.map((c) => h('span', {
        class: 'chip' + (col === c.name ? ' active' : ''),
        onclick: () => { col = c.name; q = ''; offset = 0; refresh(); },
      }, `${c.name} (${c.count})${c.protected ? ' 🔒' : ''}`)),
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('div', { class: 'inp sm', style: { width: '300px' } }, ic('search', 14, { color: 'var(--fg-muted)' }), search),
      h('span', { class: 'sub' }, `${page.total} Datensätze`),
      h('div', { style: { flex: 1 } }),
      h('button', {
        class: 'btn sm quiet',
        onclick: () => act(async () => { const r = await post('/api/db/undo'); toast(`Rückgängig: ${r.rueckgaengig.action} in ${r.rueckgaengig.col}`, 'ok'); refresh(); }),
      }, ic('refresh', 13), 'Letzte Änderung zurück'),
      !current?.protected && h('button', { class: 'btn sm orange', onclick: () => editSheet(col, null, refresh) }, ic('plus', 13), 'Datensatz')),

    h('div', { class: 'panel grow', style: { overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'tbl-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Inhalt (gekürzt)'), h('th', {}, ''))),
          h('tbody', {}, page.rows.map((r) => h('tr', { class: current?.protected ? '' : 'click', onclick: current?.protected ? null : () => editSheet(col, r, refresh) },
            h('td', { class: 'mono' }, String(r.id ?? r.personId ?? '?').slice(0, 22)),
            h('td', { class: 'wrap', style: { maxWidth: '640px', fontSize: '11.5px', fontFamily: 'var(--font-mono)' } },
              JSON.stringify(r).slice(0, 200) + (JSON.stringify(r).length > 200 ? ' …' : '')),
            h('td', {}, !current?.protected && h('button', {
              class: 'btn sm quiet danger-text',
              onclick: async (e) => {
                e.stopPropagation();
                if (await confirmDialog('Datensatz löschen?', `${col}/${r.id} wird gelöscht (Undo möglich).`, { danger: true, okLabel: 'Löschen' })) {
                  act(async () => { await del(`/api/db/col/${col}/${r.id}`); refresh(); }, 'Gelöscht (Undo verfügbar)');
                }
              },
            }, ic('x', 12)))))))),
    ),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn sm quiet', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - 40); refresh(); } }, '← Zurück'),
      h('button', { class: 'btn sm quiet', disabled: offset + 40 >= page.total, onclick: () => { offset += 40; refresh(); } }, 'Weiter →'),
      h('div', { style: { flex: 1 } }),
      h('span', { class: 'sub' }, `Audit: ${audit.length ? `zuletzt ${audit[0].action} in ${audit[0].col} durch ${audit[0].byName}` : 'noch keine manuellen Eingriffe'}`)));
}

function editSheet(colName, record, refresh) {
  const isNew = !record;
  const idInput = h('input', { value: record?.id || '', placeholder: 'ID (leer = wie Feld „id“ im JSON)' });
  const ta = h('textarea', { class: 'json-edit' }, JSON.stringify(record || { id: '' }, null, 2));
  sheet({
    title: isNew ? `Neuer Datensatz in „${colName}“` : `${colName} / ${record.id}`, icon: 'db', tone: 'info', center: true,
    sub: 'Direkter Eingriff in die Datenbank — jede Änderung landet im Audit-Trail und ist per Undo umkehrbar.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      isNew && h('label', { class: 'fld' }, 'ID', h('div', { class: 'inp' }, idInput)),
      ta,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => {
            let value;
            try { value = JSON.parse(ta.value); } catch (e) { toast(`JSON-Fehler: ${e.message}`, 'err'); return; }
            const rid = isNew ? (idInput.value.trim() || value.id) : record.id;
            if (!rid) { toast('ID fehlt (Feld oben oder „id“ im JSON)', 'err'); return; }
            if (isNew && !value.id) value.id = rid;
            act(async () => { await put(`/api/db/col/${colName}/${rid}`, { value }); close(); refresh(); }, 'Gespeichert (Audit + Undo aktiv)');
          },
        }, ic('check', 15), 'Speichern'))),
  });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
