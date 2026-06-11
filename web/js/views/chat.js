// Chat — Kanalliste + Nachrichten; läuft in allen Shells (Desktop/Tablet/Phone).
import { h, ic, badge, av, mount } from '../core/dom.js';
import { get, post, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { sheet } from '../core/ui.js';

let activeChannel = null;

export async function chatView({ onCleanup, refresh, phone = false }) {
  const channels = await get('/api/chat/channels');
  if (activeChannel && !channels.some((c) => c.id === activeChannel)) activeChannel = null;
  // Desktop/Tablet: ersten Kanal vorwählen · Phone: erst die Liste zeigen
  if (!activeChannel && !phone) activeChannel = channels[0]?.id || null;
  const current = channels.find((c) => c.id === activeChannel) || null;
  const msgs = current ? await get(`/api/chat/${current.id}/messages`) : [];
  if (current) post(`/api/chat/${current.id}/read`).catch(() => { /* nur Komfort */ });

  const msgList = h('div', { class: 'chat-msgs' },
    msgs.length === 0 ? h('div', { class: 'empty-hint' }, 'Noch keine Nachrichten — schreib die erste!')
      : msgs.map((m) => {
        const me = m.byPersonId === store.me.person.id;
        return h('div', { class: 'msg' + (me ? ' me' : '') },
          h('div', { class: 'bub' }, m.text),
          h('div', { class: 'meta', style: me ? { textAlign: 'right' } : null }, `${me ? '' : m.byName + ' · '}${m.time}`));
      }));
  setTimeout(() => { msgList.scrollTop = msgList.scrollHeight; }, 30);

  // Live: neue Nachricht im aktiven Kanal anhängen statt komplett neu laden
  onCleanup(on('chat', (evt) => {
    const d = evt?.data;
    if (d && d.channelId === activeChannel && d.id) {
      const me = d.byPersonId === store.me.person.id;
      if (!me) {
        msgList.appendChild(h('div', { class: 'msg' },
          h('div', { class: 'bub' }, d.text), h('div', { class: 'meta' }, `${d.byName} · ${d.time}`)));
        msgList.scrollTop = msgList.scrollHeight;
        post(`/api/chat/${activeChannel}/read`).catch(() => { });
      }
    } else refresh();
  }));

  const input = h('input', { placeholder: 'Nachricht …', autocomplete: 'off' });
  const send = async () => {
    const text = input.value.trim();
    if (!text || !current) return;
    input.value = '';
    await act(async () => {
      const m = await post(`/api/chat/${current.id}/messages`, { text });
      msgList.appendChild(h('div', { class: 'msg me' },
        h('div', { class: 'bub' }, m.text), h('div', { class: 'meta', style: { textAlign: 'right' } }, m.time)));
      msgList.scrollTop = msgList.scrollHeight;
    });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  const channelRow = (c) => h('div', {
    class: 'prow click' + (c.id === activeChannel ? ' on' : ''),
    onclick: () => { activeChannel = c.id; refresh(); },
  },
    h('span', { class: 'av' + (c.type === 'dm' ? '' : ' navy') }, c.type === 'dm' ? c.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : c.name.replace(/^#/, '')[0].toUpperCase()),
    h('div', { class: 'col grow', style: { gap: 0, minWidth: 0 } },
      h('span', { class: 'nm', style: { fontSize: '13px' } }, c.name),
      h('span', { class: 'mt', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        c.last ? `${c.last.by.split(' ')[0]}: ${c.last.text}` : 'noch nichts')),
    c.unread > 0 && h('span', { class: 'unread-dot' }, c.unread));

  const list = h('div', { class: 'panel chat-list', style: { display: 'flex', minHeight: 0 } },
    h('div', { class: 'panel-h' }, ic('chat', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Kanäle'),
      h('button', { class: 'btn sm quiet right', title: 'Direktnachricht', onclick: () => dmSheet(refresh) }, ic('plus', 13))),
    h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } }, channels.map(channelRow)));

  const room = h('div', { class: 'panel', style: { display: 'flex', minHeight: 0 } },
    h('div', { class: 'panel-h' },
      phone && h('span', { class: 'x', style: { marginLeft: 0 }, onclick: () => { activeChannel = null; refresh(); } }, ic('back', 17)),
      h('span', { class: 't' }, current?.name || 'Kanal wählen'),
      current?.members && badge('plain', `${current.members.length} Mitglieder`, { style: { marginLeft: 'auto' } })),
    msgList,
    h('div', { class: 'row', style: { padding: '10px 12px', borderTop: '1px solid var(--border-default)', gap: '8px' } },
      h('div', { class: 'inp grow', style: { padding: '9px 12px' } }, input),
      h('button', { class: 'btn', onclick: send }, ic('send', 16))));

  if (phone) {
    // Mobil: entweder Liste oder Raum
    return h('div', { class: 'col grow', style: { minHeight: 0, gap: 0 } }, activeChannel && current ? room : list);
  }
  return h('div', { class: 'chat-grid' }, list, room);
}

async function dmSheet(refresh) {
  const people = await get('/api/people').catch(() => null);
  // Nicht-Management bekommt /api/people nicht — dann DM über Live-Overview-Namen
  const list = people || (await get('/api/live/overview')).people;
  sheet({
    title: 'Direktnachricht', icon: 'chat', tone: 'info', center: true,
    content: (close) => {
      const q = h('input', { placeholder: 'Name suchen …' });
      const box = h('div', { class: 'col', style: { gap: 0, maxHeight: '40vh', overflow: 'auto' } });
      const draw = () => {
        const needle = q.value.toLowerCase();
        mount(box, list
          .filter((p) => p.id !== store.me.person.id && p.name.toLowerCase().includes(needle))
          .slice(0, 30)
          .map((p) => h('div', {
            class: 'prow click',
            onclick: () => act(async () => {
              const ch = await post('/api/chat/dm', { personId: p.id });
              activeChannel = ch.id;
              close(); refresh();
            }),
          }, av(p.name), h('span', { class: 'nm grow' }, p.name), ic('chev', 14, { color: 'var(--fg-muted)' }))));
      };
      q.addEventListener('input', draw);
      draw();
      return h('div', { class: 'col', style: { gap: '10px' } },
        h('div', { class: 'inp' }, ic('search', 15, { color: 'var(--fg-muted)' }), q), box);
    },
  });
}
