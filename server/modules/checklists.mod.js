// Modul: Checklisten & Rundgänge (horrops_fullstack.md: ChecklistRunner)
// Aufbau-/Sicherheits-/Pre-Show-/Abschluss-Rundgänge je Maze mit
// Pflichtpunkten. Beantwortet im Leitstand die Frage: „Sind wir bereit?“
import { bad, need, notFound, id, now, iso, hhmm } from '../kernel/util.js';

export const TYPES = ['aufbau', 'sicherheit', 'preshow', 'abschluss'];
export const TYPE_LABEL = { aufbau: 'Aufbau', sicherheit: 'Sicherheit', preshow: 'Pre-Show', abschluss: 'Abschluss' };

// Eingebaute Vorlagen — [Text, Pflicht?]
export const TEMPLATES = {
  sicherheit: [
    ['Notausgänge frei, beleuchtet und entriegelt', true],
    ['Fluchtwege-Markierung sichtbar (auch im Nebel)', true],
    ['Feuerlöscher an Position und geprüft', true],
    ['Funkcheck mit dem Leitstand durchgeführt', true],
    ['Stolperstellen / lose Kabel beseitigt', true],
    ['Not-Aus für Effekte (Strobo/Nebel) getestet', false],
    ['Erste-Hilfe-Kasten vollständig', false],
  ],
  aufbau: [
    ['Alle Scare-Positionen aufgebaut und geprüft', true],
    ['Licht-Programmierung durchgelaufen', true],
    ['Nebelmaschinen befüllt und getestet', false],
    ['Soundkulisse läuft auf allen Abschnitten', false],
    ['Requisiten vollständig und fixiert', false],
    ['Absperrungen und Gästeführung stehen', true],
  ],
  preshow: [
    ['Crew vollzählig eingecheckt und auf Position', true],
    ['Kostüm- und Masken-Check abgeschlossen', false],
    ['Durchlauf-Probe (eine Welle) ohne Befund', false],
    ['Lead-Funk und Handzeichen vereinbart', true],
    ['Wasser an den Positionen verteilt', false],
  ],
  abschluss: [
    ['Maze gästefrei (Sweep von hinten nach vorn)', true],
    ['Effekte aus, Strom für Technik getrennt', true],
    ['Fundsachen eingesammelt und abgegeben', false],
    ['Requisiten gesichert / Wertgegenstände eingeschlossen', false],
    ['Schäden für den Nachbericht notiert', false],
  ],
};

export default {
  name: 'checklists',
  title: 'Checklisten & Rundgänge',
  version: '1.0.0',
  description: 'Aufbau-, Sicherheits-, Pre-Show- und Abschluss-Rundgänge mit Pflichtpunkten.',

  routes({ get, post, del }, { db, bus, feed }) {
    const enrich = (c) => {
      const done = c.items.filter((i) => i.done).length;
      const mandatoryOpen = c.items.filter((i) => i.mandatory && !i.done).length;
      return {
        ...c,
        maze: c.mazeId ? db.get('mazes', c.mazeId)?.name || null : 'Gelände',
        typeLabel: TYPE_LABEL[c.type] || c.type,
        done, total: c.items.length, mandatoryOpen,
        complete: !!c.completedAt,
      };
    };

    get('/api/checklists', async (ctx) => {
      let list = db.all('checklists');
      const mazeId = ctx.query.get('maze');
      if (mazeId) list = list.filter((c) => c.mazeId === mazeId);
      const type = ctx.query.get('type');
      if (type) list = list.filter((c) => c.type === type);
      return list.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) ||
        String(a.maze || '').localeCompare(String(b.maze || ''), 'de')).map(enrich);
    });

    get('/api/checklists/templates', async () =>
      TYPES.map((t) => ({ type: t, label: TYPE_LABEL[t], items: TEMPLATES[t].map(([text, mandatory]) => ({ text, mandatory })) })));

    // „Sind wir bereit?“ — Aggregat fürs Leitstand-Dashboard
    get('/api/checklists/readiness', async () => {
      const mazes = db.all('mazes').sort((a, b) => (a.order || 0) - (b.order || 0));
      return mazes.map((m) => {
        const lists = db.find('checklists', (c) => c.mazeId === m.id);
        const items = lists.flatMap((c) => c.items);
        const mandatoryOpen = items.filter((i) => i.mandatory && !i.done).length;
        const done = items.filter((i) => i.done).length;
        return {
          mazeId: m.id, maze: m.name,
          listen: lists.length, punkte: items.length, erledigt: done,
          pflichtOffen: mandatoryOpen,
          bereit: lists.length > 0 && mandatoryOpen === 0,
          pct: items.length ? Math.round((done / items.length) * 100) : 0,
        };
      });
    }, { roles: ['management', 'lead'] });

    // Anlegen — aus Vorlage (type) oder mit eigenen items [{text, mandatory}]
    post('/api/checklists', async (ctx) => {
      const type = need(ctx.body, 'type');
      if (!TYPES.includes(type)) bad(`Typ muss einer von ${TYPES.join(', ')} sein`);
      if (ctx.body.mazeId && !db.get('mazes', ctx.body.mazeId)) notFound('Maze nicht gefunden');
      const source = Array.isArray(ctx.body.items) && ctx.body.items.length
        ? ctx.body.items.map((i) => [String(i.text || '').slice(0, 200), !!i.mandatory])
        : TEMPLATES[type];
      const c = {
        id: id('cl'), type,
        title: (ctx.body.title || `${TYPE_LABEL[type]}-Rundgang`).slice(0, 120),
        mazeId: ctx.body.mazeId || null,
        items: source.filter(([text]) => text.trim()).map(([text, mandatory], i) => ({
          id: `i${i + 1}`, text, mandatory, done: false, doneBy: null, doneAt: null,
        })),
        createdBy: ctx.person.name, createdAt: iso(), completedAt: null,
      };
      if (!c.items.length) bad('Checkliste braucht mindestens einen Punkt');
      db.put('checklists', c.id, c);
      bus.publish('checklist.changed', enrich(c));
      return enrich(c);
    }, { roles: ['management', 'lead'] });

    post('/api/checklists/:id/toggle', async (ctx) => {
      const c = db.get('checklists', ctx.params.id) || notFound('Checkliste nicht gefunden');
      const itemId = need(ctx.body, 'itemId');
      const items = c.items.map((i) => i.id === itemId
        ? (i.done
          ? { ...i, done: false, doneBy: null, doneAt: null }
          : { ...i, done: true, doneBy: ctx.person.name, doneAt: now() })
        : i);
      if (!items.some((i) => i.id === itemId)) notFound('Punkt nicht gefunden');
      const wasComplete = !!c.completedAt;
      const nowComplete = items.every((i) => !i.mandatory || i.done);
      const upd = { items, startedBy: c.startedBy || ctx.person.name };
      upd.completedAt = nowComplete && items.some((i) => i.done) ? (c.completedAt || now()) : null;
      db.patch('checklists', c.id, upd);
      const e = enrich(db.get('checklists', c.id));
      if (!wasComplete && upd.completedAt) {
        feed(`✅ ${e.typeLabel}-Rundgang ${e.maze} abgeschlossen — alle Pflichtpunkte erledigt (${ctx.person.name})`,
          { kind: 'checkliste', mazeId: c.mazeId });
      }
      bus.publish('checklist.changed', e);
      return e;
    }, { roles: ['management', 'lead'] });

    del('/api/checklists/:id', async (ctx) => {
      if (!db.get('checklists', ctx.params.id)) notFound('Checkliste nicht gefunden');
      db.del('checklists', ctx.params.id);
      bus.publish('checklist.changed', {});
      return { ok: true };
    }, { roles: ['management'] });
  },
};
