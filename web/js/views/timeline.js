// Management - Ablaufplan (Master-Timeline-Versionierung)
// Zeigt Timeline-Bloecke, Verzoegerungspropagation, Versionshistorie, Freeze-Umschaltung.
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, patch, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';

export async function timelineView({ onCleanup, refresh }) {
  const [data, versions] = await Promise.all([
    get('/api/timeline'),
    get('/api/timeline/versions'),
  ]);
  onCleanup(on(['timeline'], refresh));

  const { blocks, frozen } = data;

  // --- Freeze-Banner ---
  const freezeBanner = h('div', {
    class: 'card pad row', style: {
      gap: '12px', padding: '14px 18px', alignItems: 'center',
      borderColor: frozen ? 'var(--color-error)' : 'var(--color-success)',
      background: frozen ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)',
    },
  },
    ic(frozen ? 'lock' : 'radio', 20, { color: frozen ? 'var(--color-error)' : 'var(--color-success)' }),
    h('div', { class: 'col grow', style: { gap: '2px' } },
      h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '15px' } },
        frozen ? 'Ablaufplan EINGEFROREN' : 'Ablaufplan aktiv'),
      h('span', { class: 'sub' },
        frozen ? 'Nur Notfall-Aenderungen moeglich' : 'Aenderungen sind erlaubt')),
    badge(frozen ? 'err' : 'ok', frozen ? 'Frozen' : 'Aktiv', { dot: true }),
    h('button', {
      class: 'btn ' + (frozen ? 'orange sm' : 'danger sm'),
      onclick: () => act(async () => {
        await post('/api/timeline/freeze');
        refresh();
      }, frozen ? 'Ablaufplan auftauen' : 'Ablaufplan einfrieren'),
    }, ic(frozen ? 'radio' : 'lock', 14), frozen ? 'Auftauen' : 'Einfrieren'));

  // --- Block-Liste ---
  const blockRows = blocks.map((b) =>
    h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-muted)' } },
      h('span', { style: { fontWeight: 700, width: '110px', flexShrink: 0, fontSize: '13px' } }, `${b.start} - ${b.end}`),
      badge('plain', b.type, { style: { fontSize: '11px' } }),
      h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 1 } }, b.title),
      h('button', {
        class: 'btn ghost sm',
        onclick: () => editBlockSheet(b, refresh),
      }, ic('edit', 14))));

  const blocksPanel = panel(
    [ic('cal', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Ablaufplan'),
      badge('plain', `${blocks.length} Bloecke`)],
    blocks.length === 0
      ? h('div', { class: 'empty-hint' }, 'Noch keine Bloecke angelegt.')
      : h('div', { class: 'col', style: { gap: 0 } }, ...blockRows),
    { actions: [h('button', { class: 'btn sm', onclick: () => addBlockSheet(refresh) }, ic('plus', 14), 'Block hinzufuegen'),
      h('button', { class: 'btn orange sm', onclick: () => delaySheet(blocks, refresh) }, ic('alert', 14), 'Verschiebung')] });

  // --- Versions-Liste ---
  const versionRows = versions.slice().reverse().slice(0, 20).map((v) =>
    h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-muted)' } },
      badge('plain', `v${v.version}`),
      h('span', { style: { fontSize: '12px', color: 'var(--fg-muted)' } }, new Date(v.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })),
      h('span', { style: { fontSize: '13px', flex: 1 } }, v.reason || '-'),
      h('span', { style: { fontSize: '12px', color: 'var(--fg-muted)' } }, v.author || '')));

  const versionsPanel = panel(
    [ic('list', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Versionshistorie'),
      badge('plain', `${versions.length} Versionen`)],
    versions.length === 0
      ? h('div', { class: 'empty-hint' }, 'Noch keine Versionen vorhanden.')
      : h('div', { class: 'col', style: { gap: 0 } }, ...versionRows));

  return h('div', { class: 'col', style: { gap: '16px' } }, freezeBanner, blocksPanel, versionsPanel);
}

function addBlockSheet(refresh) {
  sheet({
    title: 'Neuen Block anlegen',
    fields: [
      { key: 'title', label: 'Titel', required: true },
      { key: 'start', label: 'Start (HH:MM)', placeholder: '18:00', required: true },
      { key: 'end', label: 'Ende (HH:MM)', placeholder: '18:30', required: true },
      { key: 'type', label: 'Typ', placeholder: 'block' },
    ],
    onSubmit: async (data) => {
      await post('/api/timeline', data);
      toast('Block erstellt');
      refresh();
    },
  });
}

function editBlockSheet(block, refresh) {
  sheet({
    title: `Block bearbeiten: ${block.title}`,
    fields: [
      { key: 'title', label: 'Titel', value: block.title },
      { key: 'start', label: 'Start (HH:MM)', value: block.start },
      { key: 'end', label: 'Ende (HH:MM)', value: block.end },
      { key: 'type', label: 'Typ', value: block.type },
    ],
    onSubmit: async (data) => {
      await patch(`/api/timeline/${block.id}`, data);
      toast('Block aktualisiert');
      refresh();
    },
  });
}

function delaySheet(blocks, refresh) {
  const options = blocks.map((b) => ({ value: b.id, label: `${b.start} ${b.title}` }));
  sheet({
    title: 'Verschiebung propagieren',
    fields: [
      { key: 'blockId', label: 'Ab Block', type: 'select', options, required: true },
      { key: 'delayMinutes', label: 'Verschiebung (Minuten)', type: 'number', required: true },
      { key: 'reason', label: 'Grund', placeholder: 'Verzoegerung wegen ...' },
    ],
    onSubmit: async (data) => {
      await post('/api/timeline/delay', { ...data, delayMinutes: Number(data.delayMinutes) });
      toast('Verschiebung angewendet');
      refresh();
    },
  });
}
