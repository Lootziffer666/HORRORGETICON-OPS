// Management · Personen — Teilnehmerverwaltung (Pitch Minimalpaket):
// Suche/Filter, Anlegen/Bearbeiten/Archivieren, Verknüpfungscodes,
// Zusammenführen von Selbst-Profilen, CSV-Import/-Export.
import { h, ic, badge, av } from '../core/dom.js';
import { get, post, patch, del, act, download } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet, toast, confirmDialog } from '../core/ui.js';

let q = '', status = '';

export async function peopleView({ params, onCleanup, refresh }) {
  if (params.get('q') !== null) { q = params.get('q'); history.replaceState(null, '', '#/personen'); }
  const [people, linkOv] = await Promise.all([
    get(`/api/people?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`),
    get('/api/people/link/overview'),
  ]);
  onCleanup(on(['people', 'mazes'], refresh));

  const search = h('input', { placeholder: 'Suche nach Name, Code, Ort, Notiz …', value: q });
  search.addEventListener('input', debounce(() => { q = search.value; refresh(); }, 350));

  const statusChips = [['', 'Alle'], ['aktiv', 'Aktiv'], ['angefragt', 'Angefragt'], ['ausgeschieden', 'Ausgeschieden']];

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('div', { class: 'inp sm', style: { width: '280px' } }, ic('search', 14, { color: 'var(--fg-muted)' }), search),
      ...statusChips.map(([v, l]) => h('span', {
        class: 'chip' + (status === v ? ' active' : ''),
        onclick: () => { status = v; refresh(); },
      }, l)),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/csv/export/personen') }, ic('download', 14), 'CSV-Export'),
      h('button', { class: 'btn sm quiet', onclick: () => csvImportSheet(refresh) }, ic('upload', 14), 'CSV-Import'),
      h('button', { class: 'btn sm orange', onclick: () => personSheet(null, refresh) }, ic('plus', 14), 'Person')),

    (linkOv.selfProfiles.length > 0 || linkOv.openCodes.length > 0) && linkPanel(linkOv, people, refresh),

    h('div', { class: 'panel grow', style: { overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'tbl-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Name'), h('th', {}, 'Code'), h('th', {}, 'Rollen'), h('th', {}, 'Einsatz'),
            h('th', {}, 'Ort'), h('th', {}, 'Status'), h('th', {}, 'Konto'), h('th', {}, ''))),
          h('tbody', {}, people.map((p) => h('tr', { class: 'click', onclick: () => personSheet(p, refresh) },
            h('td', { class: 'b' }, h('div', { class: 'row', style: { gap: '8px' } }, av(p.name), p.name)),
            h('td', { class: 'mono' }, p.code),
            h('td', {}, (p.roles || []).map(roleLabel).join(' + ')),
            h('td', {}, einsatz(p)),
            h('td', {}, p.ort || '—'),
            h('td', {}, badge(stTone(p.status), stLabel(p.status))),
            h('td', {}, kontoBadge(p)),
            h('td', {}, h('button', {
              class: 'btn sm quiet',
              onclick: (e) => { e.stopPropagation(); personSheet(p, refresh); },
            }, 'Öffnen'))))))),
    ),
    h('span', { class: 'sub' }, `${people.length} Teilnehmer · eine Quelle für alle · zuletzt gepflegt ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`));
}

const roleLabel = (r) => ({ management: 'Management', lead: 'Maze Lead', actor: 'Scare Actor', springer: 'Springer', catering: 'Catering' }[r] || r);
const stTone = (s) => ({ aktiv: 'ok', angefragt: 'info', ausgeschieden: 'plain', archiviert: 'plain' }[s] || 'plain');
const stLabel = (s) => ({ aktiv: 'Aktiv', angefragt: 'Angefragt', ausgeschieden: 'Ausgeschieden', archiviert: 'Archiviert' }[s] || s);
const einsatz = (p) => p.positions?.length ? p.positions.map((x) => x.code).join(', ') : '—';

function kontoBadge(p) {
  if (p.selfCreated) return badge('warn', 'Selbst angelegt — unverknüpft', { dot: true });
  if (p.linked) return badge('ok', 'Verknüpft', { dot: true });
  return badge('plain', 'Kein Konto');
}

// ───────── Verknüpfen-Panel ─────────
function linkPanel(linkOv, people, refresh) {
  return h('div', { class: 'panel', style: { borderColor: 'var(--color-warning)' } },
    h('div', { class: 'panel-h' },
      ic('link', 16, { color: '#b8901c' }),
      h('span', { class: 't' }, 'Profil-Verknüpfung — damit das Tracking auf dem richtigen Datensatz läuft'),
      badge('warn', `${linkOv.selfProfiles.length} offen`)),
    h('div', { class: 'panel-b', style: { gap: '10px' } },
      linkOv.selfProfiles.length === 0 ? h('span', { class: 'sub' }, 'Keine unverknüpften Selbst-Profile.')
        : linkOv.selfProfiles.map((sp) => {
          const sel = h('select', {},
            h('option', { value: '' }, 'Verwaltungs-Datensatz wählen …'),
            ...people.filter((p) => !p.selfCreated).map((p) => h('option', { value: p.id }, `${p.name} (${p.code})`)));
          return h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
            av(sp.name), h('div', { class: 'col', style: { gap: 0, minWidth: '160px' } },
              h('span', { class: 'nm' }, sp.name),
              h('span', { class: 'mt' }, `selbst registriert · ${sp.ort || 'kein Ort'} · Code ${sp.code}`)),
            h('div', { class: 'inp sm', style: { minWidth: '230px' } }, sel),
            h('button', {
              class: 'btn sm',
              onclick: () => {
                if (!sel.value) { toast('Bitte Ziel-Datensatz wählen', 'err'); return; }
                act(async () => { await post(`/api/people/${sel.value}/merge`, { sourceId: sp.id }); refresh(); }, 'Profile zusammengeführt');
              },
            }, ic('link', 14), 'Zusammenführen'));
        }),
      linkOv.openCodes.length > 0 && h('div', { class: 'col', style: { gap: '4px' } },
        h('span', { class: 'overline' }, 'Offene Verknüpfungscodes'),
        ...linkOv.openCodes.map((c) => h('div', { class: 'row', style: { gap: '8px', fontSize: '12.5px' } },
          h('b', { class: 'mono' }, c.code), h('span', { class: 'sub' }, `für ${c.person}`))))));
}

// ───────── Personen-Sheet (anlegen / bearbeiten) ─────────
export function personSheet(p, refresh) {
  const isNew = !p;
  const f = {
    name: h('input', { value: p?.name || '', placeholder: 'Vor- und Nachname' }),
    code: h('input', { value: p?.code || '', placeholder: 'auto' }),
    kontakt: h('input', { value: p?.kontakt || '' }),
    telefon: h('input', { value: p?.telefon || '' }),
    ort: h('input', { value: p?.ort || '', placeholder: 'für Fahrgruppen' }),
    notizen: h('textarea', { rows: 2 }, p?.notizen || ''),
    pin: h('input', { placeholder: isNew ? 'PIN fürs Login (optional)' : 'neue PIN setzen (leer = unverändert)', inputmode: 'numeric' }),
  };
  let roles = new Set(p?.roles || ['actor']);
  let st = p?.status || 'aktiv';

  sheet({
    title: isNew ? 'Person anlegen' : p.name, icon: 'user', tone: 'info', center: true,
    sub: isNew ? 'Verwaltungs-Datensatz — kann später mit einem Selbst-Profil verknüpft werden'
      : `${p.code} · angelegt ${p.createdAt?.slice(0, 10) || '—'}${p.linked ? ' · verknüpft ✓' : ''}`,
    content: (close) => {
      const roleRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
      const drawRoles = () => roleRow.replaceChildren(...['actor', 'springer', 'lead', 'catering', 'management'].map((r) =>
        h('span', {
          class: 'chip' + (roles.has(r) ? ' active' : ''),
          onclick: () => { roles.has(r) ? roles.delete(r) : roles.add(r); drawRoles(); },
        }, roleLabel(r))));
      drawRoles();
      const stSeg = h('div', { class: 'seg' });
      const drawSt = () => stSeg.replaceChildren(...[['aktiv', 'Aktiv'], ['angefragt', 'Angefragt'], ['ausgeschieden', 'Raus']].map(([v, l]) =>
        h('span', { class: st === v ? 'on' : '', onclick: () => { st = v; drawSt(); } }, l)));
      drawSt();

      return h('div', { class: 'col', style: { gap: '12px' } },
        h('div', { class: 'grid2' },
          h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, f.name)),
          h('label', { class: 'fld' }, 'Personal-Code', h('div', { class: 'inp' }, f.code))),
        h('label', { class: 'fld' }, 'Rollen', roleRow),
        h('label', { class: 'fld' }, 'Status', stSeg),
        h('div', { class: 'grid2' },
          h('label', { class: 'fld' }, 'Kontakt', h('div', { class: 'inp' }, f.kontakt)),
          h('label', { class: 'fld' }, 'Telefon', h('div', { class: 'inp' }, f.telefon))),
        h('div', { class: 'grid2' },
          h('label', { class: 'fld' }, 'Wohnort', h('div', { class: 'inp' }, f.ort)),
          h('label', { class: 'fld' }, 'PIN', h('div', { class: 'inp' }, f.pin))),
        h('label', { class: 'fld' }, 'Notizen', h('div', { class: 'inp area' }, f.notizen)),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          !isNew && !p.selfCreated && h('button', {
            class: 'btn sm quiet',
            onclick: () => act(async () => {
              const r = await post(`/api/people/${p.id}/linkcode`);
              linkCodeSheet(r.code, p.name);
            }),
          }, ic('link', 14), p.linked ? 'Neuen Verknüpfungscode' : 'Verknüpfungscode erzeugen'),
          !isNew && h('button', {
            class: 'btn sm quiet danger-text',
            onclick: async () => {
              if (await confirmDialog('Archivieren?', `${p.name} wird archiviert und von allen Positionen gelöst.`, { danger: true, okLabel: 'Archivieren' })) {
                await act(async () => { await del(`/api/people/${p.id}`); close(); refresh(); }, 'Archiviert');
              }
            },
          }, ic('x', 14), 'Archivieren'),
          h('div', { style: { flex: 1 } }),
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn orange',
            onclick: () => act(async () => {
              const body = {
                name: f.name.value.trim(), kontakt: f.kontakt.value.trim(), telefon: f.telefon.value.trim(),
                ort: f.ort.value.trim(), notizen: f.notizen.value, roles: [...roles], status: st,
              };
              if (f.code.value.trim()) body.code = f.code.value.trim();
              if (isNew) {
                if (f.pin.value) body.pin = f.pin.value;
                await post('/api/people', body);
              } else {
                if (f.pin.value) body.neuePin = f.pin.value;
                await patch(`/api/people/${p.id}`, body);
              }
              close(); refresh();
            }, isNew ? 'Person angelegt' : 'Gespeichert'),
          }, ic('check', 15), isNew ? 'Anlegen' : 'Speichern')));
    },
  });
}

function linkCodeSheet(code, name) {
  sheet({
    title: 'Verknüpfungscode', icon: 'link', tone: 'ok', center: true,
    sub: `Für ${name} — Code weitergeben (Zettel, Nachricht). Person gibt ihn in ihrem Profil ein.`,
    content: (close) => h('div', { class: 'col', style: { gap: '14px', alignItems: 'center' } },
      h('span', { class: 'code-big' }, code),
      h('span', { class: 'sub', style: { textAlign: 'center' } },
        'Gilt einmalig. Nach Eingabe übernimmt der Verwaltungs-Datensatz Login & Tracking der Person.'),
      h('button', {
        class: 'btn', onclick: async () => {
          try { await navigator.clipboard.writeText(code); toast('Kopiert', 'ok'); } catch { /* Browser ohne Clipboard */ }
        },
      }, 'Code kopieren'),
      h('button', { class: 'btn quiet', onclick: close }, 'Fertig')),
  });
}

// ───────── CSV-Import mit Vorschau ─────────
function csvImportSheet(refresh) {
  const ta = h('textarea', { rows: 8, placeholder: 'CSV hier einfügen — oder Datei wählen.\nErwartete Spalten (flexibel): Name; Rolle; Status; Kontakt; Telefon; Ort; Maze; Position; Notizen' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    const fl = file.files?.[0];
    if (fl) ta.value = await fl.text();
  });
  const preview = h('div');
  sheet({
    title: 'CSV-Import — Personen', icon: 'upload', tone: 'info', center: true,
    sub: 'Erst Vorschau (ändert nichts), dann anwenden. Erkennt ; und , automatisch.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn sm quiet', onclick: () => file.click() }, ic('doc', 14), 'Datei wählen'), file),
      h('div', { class: 'inp area' }, ta),
      preview,
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn', onclick: () => act(async () => {
            const r = await post('/api/csv/import/personen', { text: ta.value, dryRun: true });
            preview.replaceChildren(previewBox(r));
          }),
        }, ic('eye', 15), 'Vorschau'),
        h('button', {
          class: 'btn orange', onclick: () => act(async () => {
            const r = await post('/api/csv/import/personen', { text: ta.value, dryRun: false });
            toast(`Import: ${r.neu.length} neu, ${r.aktualisiert.length} aktualisiert`, 'ok');
            close(); refresh();
          }),
        }, ic('check', 15), 'Anwenden'))),
  });
}

function previewBox(r) {
  return h('div', { class: 'card pad col', style: { gap: '6px', background: 'var(--bg-muted)', boxShadow: 'none', maxHeight: '200px', overflow: 'auto' } },
    h('span', { style: { fontSize: '13px', fontWeight: 700 } },
      `Vorschau: ${r.neu.length} neu · ${r.aktualisiert.length} aktualisiert · ${r.fehler.length} Fehler`),
    ...r.neu.slice(0, 8).map((e) => h('span', { class: 'sub' }, `+ ${e.name} (${e.code}) ${e.maze ? `→ ${e.maze} ${e.position}` : ''}`)),
    ...r.aktualisiert.slice(0, 8).map((e) => h('span', { class: 'sub' }, `↻ ${e.name} (${e.code})`)),
    ...r.fehler.map((e) => h('span', { class: 'sub danger-text' }, `✘ Zeile ${e.zeile}: ${e.grund}`)));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
