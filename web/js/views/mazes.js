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
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/import/template/zuteilung') }, ic('doc', 14), 'Vorlage'),
      h('button', { class: 'btn sm quiet', onclick: () => zuteilungImportSheet(refresh) }, ic('upload', 14), 'Zuteilung importieren'),
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
            h('span', { class: 'sub', style: { fontSize: '10.5px' } }, [d.lead ? `Lead: ${d.lead}` : 'kein Lead', d.callTime ? `🕒 Ruf ${d.callTime}` : null].filter(Boolean).join(' · '))),
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
  const callTime = h('input', { value: d?.callTime || '', placeholder: 'z. B. 17:15', inputmode: 'numeric' });
  sheet({
    title: isNew ? 'Maze anlegen' : `${d.name} bearbeiten`, icon: 'door', tone: 'info', center: true,
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, name)),
        h('label', { class: 'fld' }, 'Kürzel', h('div', { class: 'inp' }, short))),
      h('label', { class: 'fld' }, 'Rufzeit (wann muss die Crew dieser Maze da sein?)', h('div', { class: 'inp' }, callTime)),
      h('span', { class: 'sub' }, 'Gestaffelte Rufzeiten statt „alle gleichzeitig" — jeder Actor sieht in seiner App seine Zeit. Positionen entstehen über „+ Position“.'),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => act(async () => {
            const body = { name: name.value.trim(), short: short.value.trim(), callTime: callTime.value.trim() };
            if (isNew) await post('/api/mazes', body);
            else await patch(`/api/mazes/${d.id}`, body);
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


// ───────── Zuteilungs-Import (Universal) ─────────
// Ordnet bestehende Personen Positionen zu: aus Excel, CSV, kopierter Tabelle oder Freitext.
const ZUT_ACCEPT = '.csv,.tsv,.txt,.xlsx,.htm,.html,.eml,text/*,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

function zuteilungImportSheet(refresh) {
  let fileData = null; // { base64, filename }
  const ta = h('textarea', {
    rows: 6,
    placeholder: 'Tabelle einfügen oder Datei wählen.\nSpalten: Maze · Position · Person (Name) und/oder Code\n\nBeispiel:\nTHE CIRCUS;C6;Pavel Novak;PN-1234',
  });
  const fileLabel = h('span', { class: 'sub' }, 'Keine Datei gewählt');
  const file = h('input', { type: 'file', accept: ZUT_ACCEPT, style: { display: 'none' } });
  const preview = h('div');

  const setFile = async (fl) => {
    if (!fl) return;
    fileData = { base64: await fileToBase64(fl), filename: fl.name };
    fileLabel.textContent = `Datei: ${fl.name}`;
    ta.value = ''; ta.setAttribute('disabled', 'true'); preview.replaceChildren();
  };
  const clearFile = () => { fileData = null; fileLabel.textContent = 'Keine Datei gewählt'; ta.removeAttribute('disabled'); };
  file.addEventListener('change', () => setFile(file.files?.[0]));
  ta.addEventListener('input', () => { if (fileData) clearFile(); });

  const drop = h('div', { class: 'dropzone' },
    ic('upload', 18, { color: 'var(--fg-muted)' }),
    h('span', {}, 'Datei hierher ziehen — Excel · CSV · TSV · HTML · Textliste'),
    fileLabel,
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn sm quiet', onclick: () => file.click() }, ic('doc', 14), 'Datei wählen'),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/import/template/zuteilung') }, ic('download', 14), 'Vorlage'),
      file));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer?.files?.[0]); });

  const payload = (dryRun) => fileData ? { ...fileData, dryRun } : { text: ta.value, dryRun };

  sheet({
    title: 'Zuteilung importieren', icon: 'pin', tone: 'info', center: true,
    sub: 'Bestehende Personen Positionen zuordnen. Erst Vorschau (ändert nichts), dann anwenden.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      drop,
      h('span', { class: 'overline' }, 'oder einfügen'),
      h('div', { class: 'inp area' }, ta),
      preview,
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn', onclick: () => act(async () => {
            const r = await post('/api/import/zuteilung', payload(true));
            preview.replaceChildren(zutPreviewBox(r));
          }),
        }, ic('eye', 15), 'Vorschau'),
        h('button', {
          class: 'btn orange', onclick: () => act(async () => {
            const r = await post('/api/import/zuteilung', payload(false));
            toast(`Zuteilung: ${r.angewendet} zugeordnet, ${r.fehler.length} Fehler`, r.fehler.length ? 'warn' : 'ok');
            close(); refresh();
          }),
        }, ic('check', 15), 'Anwenden'))),
  });
}

function zutPreviewBox(r) {
  const fmt = { xlsx: 'Excel-Datei', delimited: 'Tabelle', html: 'HTML-Tabelle', freitext: 'Freitext', csv: 'CSV' }[r.format] || r.format;
  return h('div', { class: 'card pad col', style: { gap: '6px', background: 'var(--bg-muted)', boxShadow: 'none', maxHeight: '220px', overflow: 'auto' } },
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      badge('info', `Erkannt: ${fmt}`),
      h('span', { style: { fontSize: '13px', fontWeight: 700 } }, `${r.zugeordnet.length} zugeordnet · ${r.fehler.length} Fehler`)),
    ...(r.notes || []).map((n) => h('span', { class: 'sub' }, n)),
    ...r.zugeordnet.slice(0, 8).map((e) => h('span', { class: 'sub' },
      `→ ${e.person} (${e.code}) → ${e.maze} ${e.position}${e.warnungen?.length ? ` · ⚠ ${e.warnungen.join(', ')}` : ''}`)),
    ...r.fehler.slice(0, 8).map((e) => h('span', { class: 'sub danger-text' }, `✘ Zeile ${e.zeile}: ${e.grund}`)));
}
