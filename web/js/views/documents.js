// Management · Dokumenten-Hub — Zentrale Dokumente verwalten:
// Briefings, Lageplaene, Notfall-Infos, sonstige Dokumente.
// Kategoriefilter, Pinning, Sichtbarkeitssteuerung, Markdown-Vorschau.
import { h, ic, badge, panel } from '../core/dom.js';
import { get, post, patch, del, act } from '../core/api.js';
import { on, store } from '../core/store.js';
import { sheet, toast } from '../core/ui.js';

const CATEGORIES = [
  { id: 'alle', label: 'Alle' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'lageplan', label: 'Lageplan' },
  { id: 'notfall', label: 'Notfall' },
  { id: 'sonstiges', label: 'Sonstiges' },
];

const VISIBILITY_LABEL = { alle: 'Alle', management: 'Management', lead: 'Leads' };
const CATEGORY_ICON = { briefing: 'doc', lageplan: 'map', notfall: 'alert', sonstiges: 'doc' };

export async function documentsView({ onCleanup, refresh }) {
  let activeCategory = 'alle';
  const docs = await get('/api/documents');
  onCleanup(on(['documents'], refresh));

  const isManagement = store.me.role === 'management' ||
    (store.me.person.roles || []).includes('management');

  // --- Category filter chips ---
  const filterRow = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    ...CATEGORIES.map((cat) =>
      h('span', {
        class: 'chip' + (activeCategory === cat.id ? ' active' : ''),
        onclick: () => {
          activeCategory = cat.id;
          refresh();
        },
      }, cat.label)));

  // --- Filter documents by active category ---
  const filtered = activeCategory === 'alle'
    ? docs
    : docs.filter((d) => d.category === activeCategory);

  // --- Document list ---
  const docItems = filtered.map((doc) => {
    const isPinned = doc.pinned;
    return h('div', {
      class: 'card pad', style: {
        padding: '12px 16px', cursor: 'pointer',
        borderColor: isPinned ? 'var(--color-warning)' : undefined,
        background: isPinned ? 'rgba(234,179,8,0.04)' : undefined,
      },
      onclick: () => openDocSheet(doc, isManagement, refresh),
    },
      h('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } },
        ic(CATEGORY_ICON[doc.category] || 'doc', 16, { color: isPinned ? '#b8901c' : 'var(--fg-muted)' }),
        h('div', { class: 'col grow', style: { gap: '2px' } },
          h('span', { style: { fontWeight: 700, fontSize: '14px' } },
            isPinned ? '📌 ' : '', doc.title),
          h('span', { class: 'sub', style: { fontSize: '12px' } },
            `${doc.category} · ${VISIBILITY_LABEL[doc.visibility]} · ${doc.createdBy}`)),
        badge(isPinned ? 'warn' : 'plain', isPinned ? 'Angepinnt' : doc.category)));
  });

  // --- Create button (management only) ---
  const createBtn = isManagement
    ? h('button', { class: 'btn orange sm', onclick: () => createDocSheet(refresh) },
      ic('doc', 14), 'Neues Dokument')
    : null;

  return h('div', { class: 'col scroll-y', style: { gap: '14px', flex: 1, maxWidth: '1000px' } },
    h('div', { class: 'row', style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '17px' } }, 'Dokumenten-Hub'),
      createBtn),
    filterRow,
    filtered.length === 0
      ? h('div', { class: 'empty-hint card pad', style: { padding: '24px', textAlign: 'center' } },
        'Keine Dokumente in dieser Kategorie.')
      : h('div', { class: 'col', style: { gap: '8px' } }, ...docItems));
}

function openDocSheet(doc, isManagement, refresh) {
  sheet({
    title: doc.title, icon: CATEGORY_ICON[doc.category] || 'doc', tone: 'info',
    sub: `${doc.category} · ${VISIBILITY_LABEL[doc.visibility]} · von ${doc.createdBy}`,
    content: (close) => {
      const contentEl = h('div', {
        style: { whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.6', maxHeight: '50vh', overflow: 'auto', padding: '8px 0' },
      }, doc.content || '(kein Inhalt)');

      const actions = [];
      if (isManagement) {
        actions.push(
          h('button', { class: 'btn sm quiet', onclick: () => { close(); editDocSheet(doc, refresh); } },
            ic('doc', 13), 'Bearbeiten'),
          h('button', {
            class: 'btn sm quiet',
            onclick: () => act(async () => {
              await patch(`/api/documents/${doc.id}`, { pinned: !doc.pinned });
              close();
              refresh();
            }, doc.pinned ? 'Losgeloest' : 'Angepinnt'),
          }, ic('pin', 13), doc.pinned ? 'Loslassen' : 'Anpinnen'),
          h('button', {
            class: 'btn sm danger',
            onclick: () => act(async () => {
              await del(`/api/documents/${doc.id}`);
              close();
              refresh();
            }, 'Dokument geloescht'),
          }, ic('x', 13), 'Loeschen'));
      }

      return h('div', { class: 'col', style: { gap: '12px' } },
        contentEl,
        actions.length > 0
          ? h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' } }, ...actions)
          : null);
    },
  });
}

function createDocSheet(refresh) {
  sheet({
    title: 'Neues Dokument', icon: 'doc', tone: 'info',
    content: (close) => {
      const titleInput = h('input', { type: 'text', placeholder: 'Titel', style: { width: '100%' } });
      const contentInput = h('textarea', {
        placeholder: 'Inhalt (Markdown/Text)',
        style: { width: '100%', minHeight: '150px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' },
      });
      const categorySelect = h('select', {},
        ...CATEGORIES.filter((c) => c.id !== 'alle').map((c) =>
          h('option', { value: c.id }, c.label)));
      const visibilitySelect = h('select', {},
        h('option', { value: 'alle' }, 'Alle'),
        h('option', { value: 'lead' }, 'Leads + Management'),
        h('option', { value: 'management' }, 'Nur Management'));
      const pinnedCheck = h('input', { type: 'checkbox' });

      const fld = (label, input) => h('label', { class: 'fld' }, label, h('div', { class: 'inp' }, input));

      return h('div', { class: 'col', style: { gap: '12px' } },
        fld('Titel', titleInput),
        fld('Inhalt', contentInput),
        h('div', { class: 'row', style: { gap: '12px' } },
          fld('Kategorie', categorySelect),
          fld('Sichtbarkeit', visibilitySelect)),
        h('label', { class: 'fld row', style: { gap: '8px', alignItems: 'center' } },
          pinnedCheck, h('span', { style: { fontSize: '13px' } }, 'Angepinnt')),
        h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn orange',
            onclick: () => act(async () => {
              const title = titleInput.value.trim();
              if (!title) { toast('Titel erforderlich', 'err'); return; }
              await post('/api/documents', {
                title,
                content: contentInput.value,
                category: categorySelect.value,
                visibility: visibilitySelect.value,
                pinned: pinnedCheck.checked,
              });
              close();
              refresh();
            }, 'Dokument erstellt'),
          }, ic('check', 14), 'Erstellen')));
    },
  });
}

function editDocSheet(doc, refresh) {
  sheet({
    title: 'Dokument bearbeiten', icon: 'doc', tone: 'info',
    content: (close) => {
      const titleInput = h('input', { type: 'text', value: doc.title, style: { width: '100%' } });
      const contentInput = h('textarea', {
        style: { width: '100%', minHeight: '150px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' },
      });
      contentInput.value = doc.content || '';
      const categorySelect = h('select', {},
        ...CATEGORIES.filter((c) => c.id !== 'alle').map((c) =>
          h('option', { value: c.id, selected: doc.category === c.id }, c.label)));
      const visibilitySelect = h('select', {},
        h('option', { value: 'alle', selected: doc.visibility === 'alle' }, 'Alle'),
        h('option', { value: 'lead', selected: doc.visibility === 'lead' }, 'Leads + Management'),
        h('option', { value: 'management', selected: doc.visibility === 'management' }, 'Nur Management'));
      const pinnedCheck = h('input', { type: 'checkbox', checked: doc.pinned });

      const fld = (label, input) => h('label', { class: 'fld' }, label, h('div', { class: 'inp' }, input));

      return h('div', { class: 'col', style: { gap: '12px' } },
        fld('Titel', titleInput),
        fld('Inhalt', contentInput),
        h('div', { class: 'row', style: { gap: '12px' } },
          fld('Kategorie', categorySelect),
          fld('Sichtbarkeit', visibilitySelect)),
        h('label', { class: 'fld row', style: { gap: '8px', alignItems: 'center' } },
          pinnedCheck, h('span', { style: { fontSize: '13px' } }, 'Angepinnt')),
        h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
          h('button', { class: 'btn quiet', onclick: close }, 'Abbrechen'),
          h('button', {
            class: 'btn orange',
            onclick: () => act(async () => {
              const title = titleInput.value.trim();
              if (!title) { toast('Titel erforderlich', 'err'); return; }
              await patch(`/api/documents/${doc.id}`, {
                title,
                content: contentInput.value,
                category: categorySelect.value,
                visibility: visibilitySelect.value,
                pinned: pinnedCheck.checked,
              });
              close();
              refresh();
            }, 'Dokument aktualisiert'),
          }, ic('check', 14), 'Speichern')));
    },
  });
}
