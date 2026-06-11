// Modul: Meldungen & Warnungen
// Actor meldet (Art, Dringlichkeit, Text, Position automatisch) → Lead/Leitstand
// entscheidet, weist zu, erledigt. Getränke-Anfragen laufen als leichte Meldung mit.
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

const KINDS = ['notfall', 'technik', 'gast', 'getraenk', 'sonstiges'];
const PRIOS = ['hoch', 'mittel', 'niedrig'];
const STATI = ['offen', 'in_arbeit', 'erledigt'];

// Reaktions-SLA in Minuten (überschreibbar via settings.sla)
const SLA_DEFAULT = { hoch: 5, mittel: 15, niedrig: 45 };

export default {
  name: 'incidents',
  title: 'Meldungen & Warnungen',
  version: '1.0.0',
  description: 'Vorfälle melden, priorisieren, zuweisen, erledigen; Reaktionszeit-Statistik.',

  routes({ get, post, patch }, { db, bus, feed }) {
    const enrich = (i) => {
      const sla = { ...SLA_DEFAULT, ...(db.get('settings', 'main')?.sla || {}) };
      const targetMin = sla[i.prio] ?? 15;
      // SLA misst die Zeit bis zur ersten Reaktion (Übernahme/Erledigung)
      const reacted = i.ackAt != null || i.status !== 'offen';
      const elapsedMin = (now() - i.t) / 60000;
      return {
        ...i,
        by: db.get('people', i.byPersonId)?.name || i.byName || '?',
        assigneeName: i.assignee ? db.get('people', i.assignee)?.name || null : null,
        maze: i.mazeId ? db.get('mazes', i.mazeId)?.name || null : null,
        slaMin: targetMin,
        slaLeftMin: reacted ? null : Math.ceil(targetMin - elapsedMin),
        overdue: !reacted && elapsedMin > targetMin,
      };
    };

    get('/api/incidents', async (ctx) => {
      let list = db.all('incidents');
      const st = ctx.query.get('status');
      if (st === 'offen') list = list.filter((i) => i.status !== 'erledigt');
      else if (st) list = list.filter((i) => i.status === st);
      const kind = ctx.query.get('kind');
      if (kind) list = list.filter((i) => i.kind === kind);
      const prio = ctx.query.get('prio');
      if (prio) list = list.filter((i) => i.prio === prio);
      const mazeId = ctx.query.get('maze');
      if (mazeId) list = list.filter((i) => i.mazeId === mazeId);
      return list.sort((a, b) => b.t - a.t).slice(0, 300).map(enrich);
    });

    post('/api/incidents', async (ctx) => {
      const kind = need(ctx.body, 'kind');
      if (!KINDS.includes(kind)) bad(`Art muss eine von ${KINDS.join(', ')} sein`);
      const prio = ctx.body.prio || (kind === 'notfall' ? 'hoch' : kind === 'getraenk' ? 'niedrig' : 'mittel');
      if (!PRIOS.includes(prio)) bad('Unbekannte Dringlichkeit');

      // Position automatisch mitsenden (Mockup: „Position A3 wird automatisch mitgesendet“)
      let positionId = ctx.body.positionId || null, mazeId = ctx.body.mazeId || null, ort = ctx.body.ort || '';
      if (!positionId) {
        const pos = db.one('positions', (x) => x.assignedPersonId === ctx.person.id);
        if (pos) { positionId = pos.id; mazeId = pos.mazeId; }
      }
      if (positionId && !ort) {
        const pos = db.get('positions', positionId);
        const maze = pos ? db.get('mazes', pos.mazeId) : null;
        mazeId = mazeId || pos?.mazeId || null;
        ort = pos ? `${maze?.name || ''} · ${pos.code}${pos.name ? ` „${pos.name}“` : ''}` : '';
      }

      const inc = {
        id: id('i'), t: now(), time: hhmm(),
        kind, prio, text: need(ctx.body, 'text').slice(0, 600),
        positionId, mazeId, ort,
        byPersonId: ctx.person.id, byName: ctx.person.name,
        status: 'offen', assignee: null, ackAt: null, doneAt: null,
        leavePosition: !!ctx.body.leavePosition,
      };
      db.put('incidents', inc.id, inc);
      const sym = { notfall: '🚨', technik: '🛠️', gast: '⚠️', getraenk: '🥤', sonstiges: 'ℹ️' }[kind];
      feed(`${sym} ${prio === 'hoch' ? 'PRIO HOCH — ' : ''}${inc.text}${ort ? ` (${ort})` : ''}`,
        { kind: 'meldung', level: prio === 'hoch' ? 'err' : prio === 'mittel' ? 'warn' : 'info', by: ctx.person.name, mazeId });
      bus.publish('incident.changed', enrich(inc));
      if (prio === 'hoch') {
        bus.publish('alarm', {
          incidentId: inc.id, text: inc.text, ort, level: 'notfall',
          by: ctx.person.name, time: inc.time, mazeId,
        });
      }
      return enrich(inc);
    });

    patch('/api/incidents/:id', async (ctx) => {
      const inc = db.get('incidents', ctx.params.id) || notFound('Meldung nicht gefunden');
      const upd = {};
      if (ctx.body.status) {
        if (!STATI.includes(ctx.body.status)) bad('Unbekannter Status');
        upd.status = ctx.body.status;
        if (ctx.body.status === 'in_arbeit' && !inc.ackAt) {
          upd.ackAt = now();
          upd.reactionSec = Math.round((now() - inc.t) / 1000);
        }
        if (ctx.body.status === 'erledigt') {
          upd.doneAt = now();
          if (!inc.ackAt) { upd.ackAt = now(); upd.reactionSec = Math.round((now() - inc.t) / 1000); }
        }
      }
      if (ctx.body.assignee !== undefined) {
        upd.assignee = ctx.body.assignee;
        if (!inc.ackAt && ctx.body.assignee) { upd.ackAt = now(); upd.reactionSec = Math.round((now() - inc.t) / 1000); upd.status = upd.status || 'in_arbeit'; }
      }
      if (ctx.body.prio) { if (!PRIOS.includes(ctx.body.prio)) bad('Unbekannte Dringlichkeit'); upd.prio = ctx.body.prio; }
      if (ctx.body.note) upd.note = String(ctx.body.note).slice(0, 600);
      const next = db.patch('incidents', inc.id, upd);
      const e = { ...next, by: next.byName };
      if (upd.status === 'erledigt') {
        feed(`✔️ Meldung erledigt: ${inc.text.slice(0, 80)} (${ctx.person.name})`, { kind: 'meldung', level: 'info', mazeId: inc.mazeId });
      } else if (upd.assignee) {
        feed(`👉 Meldung übernommen: ${inc.text.slice(0, 80)} → ${db.get('people', upd.assignee)?.name || '?'}`, { kind: 'meldung', mazeId: inc.mazeId });
      }
      bus.publish('incident.changed', e);
      return e;
    }, { roles: ['management', 'lead', 'catering'] });

    get('/api/incidents/stats', async () => {
      const all = db.all('incidents');
      const done = all.filter((i) => i.reactionSec != null);
      const avg = done.length ? done.reduce((s, i) => s + i.reactionSec, 0) / done.length : null;
      return {
        gesamt: all.length,
        offen: all.filter((i) => i.status === 'offen').length,
        inArbeit: all.filter((i) => i.status === 'in_arbeit').length,
        erledigt: all.filter((i) => i.status === 'erledigt').length,
        hochOffen: all.filter((i) => i.prio === 'hoch' && i.status !== 'erledigt').length,
        mittlereReaktionMin: avg != null ? Math.round(avg / 6) / 10 : null,
        nachArt: KINDS.map((k) => ({ kind: k, n: all.filter((i) => i.kind === k).length })),
      };
    });
  },
};
