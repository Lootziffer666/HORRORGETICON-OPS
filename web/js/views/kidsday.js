// Management · Kids Day Leitstand — Familientag-Modus steuern:
// Status, Aktivierung/Deaktivierung, KPIs, Maze-Intensitaeten, Konfiguration.
import { h, ic, badge, panel } from '../core/dom.js';
import { get, patch, post, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';
import { kpi } from './shared.js';

export async function kidsdayView({ onCleanup, refresh }) {
  const [overview, config, mazes] = await Promise.all([
    get('/api/kidsday/overview'),
    get('/api/kidsday/config'),
    get('/api/kidsday/mazes'),
  ]);
  onCleanup(on(['kidsday', 'settings', 'live', 'checklists'], refresh));

  const active = overview.kidsDayActive;

  // --- Status-Banner ---
  const statusBanner = h('div', {
    class: 'card pad row', style: {
      gap: '12px', padding: '14px 18px', alignItems: 'center',
      borderColor: active ? 'var(--color-success)' : 'var(--border-muted)',
      background: active ? 'rgba(34,197,94,0.06)' : undefined,
    },
  },
    ic(active ? 'radio' : 'pause', 20, { color: active ? 'var(--color-success)' : 'var(--fg-muted)' }),
    h('div', { class: 'col grow', style: { gap: '2px' } },
      h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '15px' } },
        active ? 'Kids Day ist AKTIV' : 'Kids Day ist inaktiv'),
      h('span', { class: 'sub' },
        active
          ? `Zeitfenster ${config.startTime} - ${config.endTime} Uhr`
          : 'Familientag-Modus ist derzeit deaktiviert')),
    badge(active ? 'ok' : 'plain', active ? 'Aktiv' : 'Inaktiv', { dot: active }),
    h('button', {
      class: 'btn ' + (active ? 'danger sm' : 'orange sm'),
      onclick: () => confirmToggle(active, refresh),
    }, ic(active ? 'x' : 'radio', 14), active ? 'Deaktivieren' : 'Aktivieren'));

  // --- KPI-Reihe ---
  const kpiRow = h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
    kpi(String(overview.groups.total), 'Gruppen heute',
      overview.groups.completed ? `${overview.groups.completed} abgeschlossen` : 'noch keine'),
    kpi(String(overview.groups.active), 'Aktive Gruppen',
      overview.groups.active > 0 ? 'gerade im Maze' : 'keine aktiv'),
    kpi(overview.waitTimeMin != null ? `${overview.waitTimeMin} min` : '--', 'Wartezeit',
      overview.waitTimeMin != null ? 'Durchschnitt' : 'noch keine Daten'),
    kpi(String(overview.incidents.open), 'Offene Meldungen',
      overview.incidents.highPrio ? { text: `${overview.incidents.highPrio} hohe Prioritaet`, tone: 'var(--color-error)' } : 'keine hohe Prio',
      { tone: overview.incidents.open ? 'var(--color-error)' : undefined, alert: overview.incidents.highPrio > 0 }));

  // --- Maze-Intensitaeten ---
  const INTENSITY_TONE = { leicht: 'ok', mittel: 'warn', aus: 'err' };
  const INTENSITY_LABEL = { leicht: 'Leicht', mittel: 'Mittel', aus: 'Aus' };

  const mazeRows = mazes.map((m) => {
    const chips = ['leicht', 'mittel', 'aus'].map((level) =>
      h('span', {
        class: 'chip' + (m.intensity === level ? ' active' : ''),
        style: m.intensity === level ? chipActiveStyle(level) : null,
        onclick: () => {
          if (m.intensity === level) return;
          act(async () => {
            await patch(`/api/kidsday/mazes/${m.mazeId}`, { intensity: level });
            refresh();
          }, `${m.name}: Intensitaet auf ${INTENSITY_LABEL[level]}`);
        },
      }, INTENSITY_LABEL[level]));
    return h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', padding: '6px 0' } },
      h('span', { style: { fontSize: '13px', fontWeight: 700, width: '110px', flexShrink: 0 } }, m.name),
      badge(INTENSITY_TONE[m.intensity], INTENSITY_LABEL[m.intensity], { dot: true }),
      h('div', { class: 'row', style: { gap: '6px', marginLeft: 'auto' } }, ...chips));
  });

  const mazePanel = panel(
    [ic('door', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Maze-Intensitaeten'),
      badge(active ? 'ok' : 'plain', `${overview.mazes.activeInKidsMode}/${overview.mazes.total} aktiv`)],
    mazeRows.length === 0
      ? h('div', { class: 'empty-hint' }, 'Keine Mazes vorhanden.')
      : h('div', { class: 'col', style: { gap: '4px' } }, ...mazeRows),
    { bodyStyle: { paddingTop: '8px' } });

  // --- Konfiguration (collapsible) ---
  let configOpen = false;
  const configBody = h('div', { class: 'col', style: { gap: '12px', display: 'none' } });
  const configToggleBtn = h('span', {
    class: 'link right', style: { cursor: 'pointer' },
    onclick: () => {
      configOpen = !configOpen;
      configBody.style.display = configOpen ? '' : 'none';
      configToggleBtn.textContent = configOpen ? 'Einklappen' : 'Bearbeiten';
    },
  }, 'Bearbeiten');

  const cf = {
    date: h('input', { type: 'date', value: config.date || '' }),
    startTime: h('input', { type: 'time', value: config.startTime || '10:00' }),
    endTime: h('input', { type: 'time', value: config.endTime || '16:00' }),
    defaultIntensity: h('select', {},
      ...['leicht', 'mittel', 'aus'].map((v) =>
        h('option', { value: v, selected: config.defaultIntensity === v }, INTENSITY_LABEL[v]))),
    safetyBriefing: h('input', { type: 'checkbox', checked: config.safetyBriefingRequired }),
  };

  const fld = (label, input) => h('label', { class: 'fld' }, label, h('div', { class: 'inp' }, input));

  const saveConfig = () => act(async () => {
    await patch('/api/kidsday/config', {
      date: cf.date.value || null,
      startTime: cf.startTime.value,
      endTime: cf.endTime.value,
      defaultIntensity: cf.defaultIntensity.value,
      safetyBriefingRequired: cf.safetyBriefing.checked,
    });
    refresh();
  }, 'Kids Day Konfiguration gespeichert');

  configBody.replaceChildren(
    h('div', { class: 'grid3' },
      fld('Datum', cf.date), fld('Startzeit', cf.startTime), fld('Endzeit', cf.endTime)),
    h('div', { class: 'grid2' },
      fld('Standard-Intensitaet', cf.defaultIntensity),
      h('label', { class: 'fld' }, 'Sicherheitsbriefing',
        h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
          cf.safetyBriefing,
          h('span', { style: { fontSize: '13px' } }, 'Pflicht-Briefing fuer alle Gruppen')))),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn orange sm', onclick: saveConfig }, ic('check', 14), 'Speichern')));

  const configPanel = panel(
    [ic('gear', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Konfiguration'), configToggleBtn],
    h('div', { class: 'col', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--fg-secondary)' } },
        h('span', {}, `Datum: ${config.date || 'nicht gesetzt'}`),
        h('span', {}, `Zeitfenster: ${config.startTime} - ${config.endTime}`),
        h('span', {}, `Standard: ${INTENSITY_LABEL[config.defaultIntensity] || config.defaultIntensity}`),
        h('span', {}, `Briefing: ${config.safetyBriefingRequired ? 'Ja' : 'Nein'}`)),
      configBody));

  // --- Staff Readiness ---
  const staffPanel = panel(
    [ic('users', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Crew-Bereitschaft'),
      badge(overview.staff.ready ? 'ok' : 'warn', overview.staff.ready ? 'Bereit' : 'Unvollstaendig', { dot: true })],
    h('div', { class: 'row', style: { gap: '16px', fontSize: '13px' } },
      h('span', {}, `${overview.staff.checkedIn} / ${overview.staff.required} eingecheckt`),
      overview.staff.ready
        ? h('span', { style: { color: 'var(--color-success)', fontWeight: 700 } }, 'Alle da')
        : h('span', { style: { color: 'var(--color-warning)', fontWeight: 700 } },
          `${overview.staff.required - overview.staff.checkedIn} fehlen noch`)));

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1, maxWidth: '1000px' } },
    statusBanner,
    kpiRow,
    mazePanel,
    configPanel,
    staffPanel);
}

// --- Confirmation sheet for activate/deactivate ---
function confirmToggle(currentlyActive, refresh) {
  const action = currentlyActive ? 'deactivate' : 'activate';
  const title = currentlyActive ? 'Kids Day deaktivieren?' : 'Kids Day aktivieren?';
  const sub = currentlyActive
    ? 'Der Familientag-Modus wird beendet. Alle Mazes kehren in den Normalbetrieb zurueck.'
    : 'Der Familientag-Modus wird fuer das gesamte Event aktiviert. Alle Mazes wechseln in den konfigurierten Kids-Modus.';

  sheet({
    title, icon: 'users', tone: currentlyActive ? 'err' : 'info', center: true, sub,
    content: (close) => h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
      h('button', {
        class: 'btn ' + (currentlyActive ? 'danger' : 'orange'),
        onclick: async () => {
          await act(async () => {
            await post(`/api/kidsday/${action}`);
            close();
            refresh();
          }, currentlyActive ? 'Kids Day deaktiviert' : 'Kids Day aktiviert');
        },
      }, ic(currentlyActive ? 'x' : 'radio', 15),
        currentlyActive ? 'Deaktivieren' : 'Aktivieren')),
  });
}

function chipActiveStyle(level) {
  if (level === 'aus') return { background: 'var(--color-error)', borderColor: 'var(--color-error)', color: '#fff' };
  if (level === 'mittel') return { background: 'var(--color-warning)', borderColor: 'var(--color-warning)', color: '#fff' };
  return { background: 'var(--color-success)', borderColor: 'var(--color-success)', color: '#fff' };
}
