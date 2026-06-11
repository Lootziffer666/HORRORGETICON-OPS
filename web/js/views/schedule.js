// Management · Zeitplan — Schichten + gestaffelter Pausenplan-Vorschlag
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, patch, del, act } from '../core/api.js';
import { on } from '../core/store.js';
import { sheet } from '../core/ui.js';

export async function scheduleView({ onCleanup, refresh }) {
  const [sched, plan] = await Promise.all([get('/api/schedule'), get('/api/schedule/breakplan')]);
  onCleanup(on(['schedule', 'mazes'], refresh));

  return h('div', { class: 'cols-2', style: { gridTemplateColumns: '380px 1fr' } },
    panel([ic('cal', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Schichten'),
      h('button', { class: 'btn sm quiet right', onclick: () => shiftSheet(null, refresh) }, ic('plus', 13))],
      sched.shifts.map((s) => h('div', { class: 'prow click', onclick: () => shiftSheet(s, refresh) },
        h('span', { class: 'num', style: { fontSize: '13px', width: '96px' } }, `${s.start}–${s.end}`),
        h('div', { class: 'col grow', style: { gap: 0 } },
          h('span', { class: 'nm' }, s.name),
          h('span', { class: 'mt' }, s.notiz || s.gruppe)),
        ic('chev', 14, { color: 'var(--fg-muted)' }))),
      { bodyStyle: { gap: 0, paddingTop: '2px' } }),

    panel([ic('pause', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Pausenplan-Vorschlag'),
      h('span', { class: 'sub right' }, plan.hinweis)],
      h('div', { class: 'col scroll-y', style: { gap: '14px' } },
        plan.plan.map((m) => h('div', { class: 'col', style: { gap: '6px' } },
          h('span', { class: 'overline' }, m.maze),
          m.slots.length === 0 ? h('span', { class: 'sub' }, 'keine besetzten Positionen')
            : h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
              m.slots.map((s) => h('span', { class: 'chip', title: s.person },
                h('b', {}, s.position), ` ${s.von}–${s.bis}`)))))),
      { scroll: true }));
}

function shiftSheet(s, refresh) {
  const isNew = !s;
  const name = h('input', { value: s?.name || '', placeholder: 'z. B. Showbetrieb' });
  const start = h('input', { value: s?.start || '18:00', type: 'time' });
  const end = h('input', { value: s?.end || '01:00', type: 'time' });
  const notiz = h('input', { value: s?.notiz || '' });
  sheet({
    title: isNew ? 'Schicht anlegen' : s.name, icon: 'cal', tone: 'info', center: true,
    content: (close) => h('div', { class: 'col', style: { gap: '12px' } },
      h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, name)),
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, 'Beginn', h('div', { class: 'inp' }, start)),
        h('label', { class: 'fld' }, 'Ende', h('div', { class: 'inp' }, end))),
      h('label', { class: 'fld' }, 'Notiz', h('div', { class: 'inp' }, notiz)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        !isNew && h('button', {
          class: 'btn quiet danger-text',
          onclick: () => act(async () => { await del(`/api/schedule/shifts/${s.id}`); close(); refresh(); }, 'Gelöscht'),
        }, 'Löschen'),
        h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
        h('button', {
          class: 'btn orange',
          onclick: () => act(async () => {
            const body = { name: name.value.trim(), start: start.value, end: end.value, notiz: notiz.value };
            if (isNew) await post('/api/schedule/shifts', body);
            else await patch(`/api/schedule/shifts/${s.id}`, body);
            close(); refresh();
          }, 'Gespeichert'),
        }, 'Speichern'))),
  });
}
