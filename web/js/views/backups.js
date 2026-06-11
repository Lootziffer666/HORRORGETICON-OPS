// Management · Backups — Autosave-Status, Snapshots, Restore, Journal-Rebuild,
// Voll-Export/-Import. Macht sichtbar, was die DB-Schicht automatisch tut.
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, act, download } from '../core/api.js';
import { on } from '../core/store.js';
import { kpi } from './shared.js';
import { confirmDialog, toast, sheet } from '../core/ui.js';

export async function backupsView({ onCleanup, refresh }) {
  const data = await get('/api/backups');
  onCleanup(on(['db'], refresh));
  const it = data.integrity;

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1 } },
    h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      kpi(String(it.seq), 'Journal-Sequenz', `Snapshot bei ${it.snapshotSeq} · ${it.pendingOps} Änderungen ungesichert`),
      kpi(String(data.backups.length), 'Backups', 'rotierend, neueste zuerst'),
      kpi(`${Math.round(it.journalBytes / 1024)} KB`, 'Journal (Autosave)', 'jede Änderung sofort auf Platte'),
      kpi(String(Object.values(it.counts).reduce((a, b) => a + b, 0)), 'Datensätze', `${Object.keys(it.counts).length} Collections`)),

    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm orange', onclick: () => act(async () => { await post('/api/backups/create'); refresh(); }, 'Backup erstellt') }, ic('save', 14), 'Backup jetzt'),
      h('button', {
        class: 'btn sm quiet',
        onclick: async () => {
          if (await confirmDialog('Rebuild aus Journal?', 'Der Zustand wird komplett aus dem Änderungs-Journal neu aufgebaut. Vorher wird automatisch gesichert.', { okLabel: 'Rebuild starten' })) {
            act(async () => { const r = await post('/api/backups/rebuild'); toast(`Rebuild: ${r.replayed} Einträge nachgespielt`, 'ok'); refresh(); });
          }
        },
      }, ic('refresh', 14), 'Rebuild aus Journal'),
      h('button', { class: 'btn sm quiet', onclick: () => download('/api/backups/export') }, ic('download', 14), 'Voll-Export (JSON)'),
      h('button', { class: 'btn sm quiet', onclick: () => importSheet(refresh) }, ic('upload', 14), 'Voll-Import')),

    panel([ic('save', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Snapshots (rotierend)')],
      data.backups.length === 0 ? h('div', { class: 'empty-hint' }, 'Noch keine Backups — entstehen automatisch bei Aktivität.')
        : data.backups.map((b) => h('div', { class: 'prow', style: { gap: '10px' } },
          ic('doc', 16, { color: 'var(--fg-muted)' }),
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { class: 'nm mono', style: { fontSize: '12px' } }, b.file),
            h('span', { class: 'mt' }, `${b.at} · ${b.mb} MB`)),
          h('button', {
            class: 'btn sm quiet',
            onclick: async () => {
              if (await confirmDialog('Backup wiederherstellen?', `Der aktuelle Stand wird vorher automatisch gesichert. Danach gilt: ${b.file}`, { danger: true, okLabel: 'Wiederherstellen' })) {
                act(async () => { await post('/api/backups/restore', { file: b.file }); refresh(); }, 'Wiederhergestellt');
              }
            },
          }, 'Wiederherstellen'))),
      { scroll: true, bodyStyle: { gap: 0, paddingTop: '2px' } }),

    panel([ic('db', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Boot-Report (letzter Start)')],
      h('div', { class: 'col', style: { gap: '4px' } },
        (it.bootReport || []).map((l) => h('span', { class: 'sub mono', style: { fontSize: '11.5px' } }, l)))));
}

function importSheet(refresh) {
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  sheet({
    title: 'Voll-Import', icon: 'upload', tone: 'warn', center: true,
    sub: 'Spielt einen Voll-Export wieder ein. Der aktuelle Stand wird vorher automatisch gesichert.',
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'inp' }, file),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            const fl = file.files?.[0];
            if (!fl) { toast('Bitte Datei wählen', 'err'); return; }
            let data;
            try { data = JSON.parse(await fl.text()); } catch { toast('Datei ist kein gültiger Export', 'err'); return; }
            await act(async () => {
              const dry = await post('/api/backups/import', { state: data.state, dryRun: true });
              const sum = Object.entries(dry.counts).map(([k, v]) => `${k}: ${v}`).slice(0, 6).join(', ');
              if (await confirmDialog('Wirklich importieren?', `Enthält: ${sum} …`, { danger: true, okLabel: 'Import ausführen' })) {
                await post('/api/backups/import', { state: data.state });
                close(); refresh();
              }
            }, 'Import abgeschlossen');
          },
        }, 'Importieren'))),
  });
}
