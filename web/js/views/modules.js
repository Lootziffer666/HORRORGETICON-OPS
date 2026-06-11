// Management · Module — das Herz der „Unkaputtbarkeit“:
// Status aller Module, Fehlerzähler, deaktivieren/aktivieren/neu laden (Hot-Swap).
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on } from '../core/store.js';
import { confirmDialog } from '../core/ui.js';

const healthBadge = {
  ok: () => badge('ok', 'Läuft', { dot: true }),
  angeschlagen: () => badge('warn', 'Angeschlagen', { dot: true }),
  deaktiviert: () => badge('plain', 'Deaktiviert'),
  defekt: () => badge('err', 'Defekt', { dot: true }),
};

export async function modulesView({ onCleanup, refresh }) {
  const [mods, health] = await Promise.all([get('/api/modules'), get('/api/health')]);
  onCleanup(on(['modules'], refresh));

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1 } },
    h('div', { class: 'card pad row', style: { gap: '12px' } },
      ic('shield', 20, { color: 'var(--color-success)' }),
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('span', { style: { fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '15px' } },
          'Module sind zur Laufzeit aus- und austauschbar'),
        h('span', { class: 'sub' },
          'Stolpert ein Modul (5 Fehler in 5 min), schaltet der Kernel es automatisch ab — der Rest läuft weiter. ' +
          '„Neu laden“ holt die Moduldatei frisch von der Platte (Hot-Swap nach Austausch der Datei).')),
      h('div', { class: 'col', style: { gap: '2px', textAlign: 'right' } },
        h('span', { class: 'num', style: { fontSize: '18px' } }, `${Math.floor(health.uptimeSec / 3600)}:${String(Math.floor((health.uptimeSec % 3600) / 60)).padStart(2, '0')} h`),
        h('span', { class: 'sub' }, `Laufzeit · ${health.online} Geräte verbunden`))),

    h('div', { class: 'grid3' },
      ...mods.map((m) => h('div', { class: 'card pad col', style: { gap: '10px' } },
        h('div', { class: 'row', style: { gap: '8px' } },
          h('span', { class: 'av navy', style: { borderRadius: '9px' } }, ic('puzzle', 15)),
          h('div', { class: 'col grow', style: { gap: 0 } },
            h('span', { style: { fontWeight: 800, fontSize: '14px', fontFamily: 'var(--font-display)' } }, m.title || m.name),
            h('span', { class: 'sub' }, `${m.name} · v${m.version}${m.core ? ' · Kernmodul' : ''}`)),
          (healthBadge[m.health] || healthBadge.ok)()),
        h('span', { class: 'sub', style: { minHeight: '28px' } }, m.description || ''),
        (m.errorCount > 0 || m.lastError) && h('div', { class: 'card pad col', style: { gap: '2px', background: 'var(--bg-muted)', boxShadow: 'none', padding: '8px 10px' } },
          h('span', { class: 'sub', style: { fontWeight: 700 } }, `Fehlerzähler: ${m.errorCount || 0} / 5`),
          m.lastError && h('span', { class: 'sub mono', style: { fontSize: '10.5px', wordBreak: 'break-all' } }, m.lastError.slice(0, 160)),
          m.disabledReason && h('span', { class: 'sub' }, `Aus: ${m.disabledReason}`)),
        h('div', { class: 'row', style: { gap: '8px', marginTop: 'auto' } },
          m.enabled !== false
            ? h('button', {
              class: 'btn sm quiet grow',
              onclick: async () => {
                if (m.core && !await confirmDialog('Kernmodul abschalten?', `„${m.title}“ ist ein Kernmodul — Teile der App stehen dann still.`, { danger: true, okLabel: 'Trotzdem aus' })) return;
                act(async () => { await post(`/api/modules/${m.name}/disable`); refresh(); }, `${m.title} deaktiviert`);
              },
            }, ic('pause', 13), 'Deaktivieren')
            : h('button', {
              class: 'btn sm grow', style: { background: 'var(--color-success)', color: '#fff' },
              onclick: () => act(async () => { await post(`/api/modules/${m.name}/enable`); refresh(); }, `${m.title} aktiviert`),
            }, ic('check', 13), 'Aktivieren'),
          h('button', {
            class: 'btn sm quiet', title: 'Moduldatei neu laden (Hot-Swap)',
            onclick: () => act(async () => { await post(`/api/modules/${m.name}/reload`); refresh(); }, `${m.title} neu geladen`),
          }, ic('refresh', 13)))))));
}
