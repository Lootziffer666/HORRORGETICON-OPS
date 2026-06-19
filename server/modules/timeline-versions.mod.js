// Modul: Master-Timeline-Versionierung (Ablaufplan)
// Verwaltet den Event-Ablaufplan (Rundown) mit Bloecken, Verzoegerungen,
// Versionierung und Freeze-Mechanismus fuer den Live-Betrieb.
import { bad, need, notFound, id, now, hhmm } from '../kernel/util.js';

/** Parse HH:MM string to total minutes for comparison/shifting */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Convert total minutes back to HH:MM string */
function fromMinutes(total) {
  // Wrap around 24h
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default {
  name: 'timeline-versions',
  title: 'Ablaufplan-Versionierung',
  version: '1.0.0',
  description: 'Master-Timeline mit Bloecken, Verzoegerungspropagation, Versionierung und Freeze.',

  routes({ get, post, patch, del }, { db, bus, feed }) {

    function getState() {
      return db.get('timeline_state', 'main') || { frozen: false };
    }

    function setFrozen(val) {
      db.put('timeline_state', 'main', { ...getState(), frozen: val });
    }

    function allBlocks() {
      return db.all('timeline_blocks').sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    }

    function nextVersion(reason, author) {
      const versions = db.all('timeline_versions');
      const vNum = versions.length + 1;
      const ver = {
        id: id('tv'),
        version: vNum,
        timestamp: now(),
        blocks: allBlocks(),
        reason: reason || null,
        author: author || null,
      };
      db.put('timeline_versions', ver.id, ver);
      // Cap stored versions at 50 - prune oldest
      if (versions.length + 1 > 50) {
        const sorted = [...versions, ver].sort((a, b) => a.version - b.version);
        const toRemove = sorted.slice(0, sorted.length - 50);
        for (const old of toRemove) {
          db.del('timeline_versions', old.id);
        }
      }
      return ver;
    }

    function checkFrozen(ctx) {
      const state = getState();
      if (state.frozen) {
        if (!ctx.body?.emergency) {
          bad('Timeline ist eingefroren. Nur Notfall-Aenderungen (emergency:true) erlaubt.');
        }
      }
    }

    // --- GET /api/timeline ---
    get('/api/timeline', async () => {
      const blocks = allBlocks();
      const state = getState();
      return { blocks, frozen: state.frozen };
    }, { roles: ['management', 'lead'] });

    // --- POST /api/timeline ---
    post('/api/timeline', async (ctx) => {
      checkFrozen(ctx);
      const title = need(ctx.body, 'title');
      const start = need(ctx.body, 'start');
      const end = need(ctx.body, 'end');
      if (!/^\d{2}:\d{2}$/.test(start)) bad('start muss im Format HH:MM sein');
      if (!/^\d{2}:\d{2}$/.test(end)) bad('end muss im Format HH:MM sein');
      const type = ctx.body.type || 'block';

      const block = {
        id: id('tb'),
        title: title.slice(0, 200),
        start,
        end,
        type: String(type).slice(0, 50),
        order: db.all('timeline_blocks').length,
        createdAt: now(),
        updatedBy: ctx.person.name,
      };
      db.put('timeline_blocks', block.id, block);
      const ver = nextVersion(`Block erstellt: ${block.title}`, ctx.person.name);
      bus.publish('timeline.changed', { block, version: ver.version });
      return block;
    }, { roles: ['management'] });

    // --- PATCH /api/timeline/:id ---
    patch('/api/timeline/:id', async (ctx) => {
      checkFrozen(ctx);
      const block = db.get('timeline_blocks', ctx.params.id) || notFound('Block nicht gefunden');
      const upd = {};
      if (ctx.body.title !== undefined) upd.title = String(ctx.body.title).trim().slice(0, 200);
      if (ctx.body.start !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(ctx.body.start)) bad('start muss im Format HH:MM sein');
        upd.start = ctx.body.start;
      }
      if (ctx.body.end !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(ctx.body.end)) bad('end muss im Format HH:MM sein');
        upd.end = ctx.body.end;
      }
      if (ctx.body.type !== undefined) upd.type = String(ctx.body.type).slice(0, 50);
      if (ctx.body.order !== undefined) upd.order = Number(ctx.body.order);
      if (!Object.keys(upd).length) bad('Nichts zu aendern');
      upd.updatedBy = ctx.person.name;
      db.patch('timeline_blocks', block.id, upd);
      const updated = db.get('timeline_blocks', block.id);
      const ver = nextVersion(`Block bearbeitet: ${updated.title}`, ctx.person.name);
      bus.publish('timeline.changed', { block: updated, version: ver.version });
      return updated;
    }, { roles: ['management'] });

    // --- DELETE /api/timeline/:id ---
    del('/api/timeline/:id', async (ctx) => {
      checkFrozen(ctx);
      const block = db.get('timeline_blocks', ctx.params.id) || notFound('Block nicht gefunden');
      db.del('timeline_blocks', block.id);
      const ver = nextVersion(`Block geloescht: ${block.title}`, ctx.person.name);
      bus.publish('timeline.changed', { deleted: block.id, version: ver.version });
      return { ok: true, deleted: block.id };
    }, { roles: ['management'] });

    // --- POST /api/timeline/delay ---
    post('/api/timeline/delay', async (ctx) => {
      checkFrozen(ctx);
      const blockId = need(ctx.body, 'blockId');
      const delayMinutes = need(ctx.body, 'delayMinutes', 'number');
      if (!Number.isInteger(delayMinutes) || delayMinutes <= 0) {
        bad('delayMinutes muss eine positive Ganzzahl sein (> 0)');
      }
      const reason = ctx.body.reason || `Verschiebung um ${delayMinutes} min`;

      const target = db.get('timeline_blocks', blockId) || notFound('Block nicht gefunden');
      const targetStart = toMinutes(target.start);

      // Shift the target block and all subsequent blocks
      const blocks = allBlocks();
      for (const b of blocks) {
        if (toMinutes(b.start) >= targetStart) {
          const newStart = fromMinutes(toMinutes(b.start) + delayMinutes);
          const newEnd = fromMinutes(toMinutes(b.end) + delayMinutes);
          db.patch('timeline_blocks', b.id, { start: newStart, end: newEnd, updatedBy: ctx.person.name });
        }
      }

      const ver = nextVersion(reason, ctx.person.name);
      feed(`Ablaufplan: Verschiebung um ${delayMinutes} min ab ${target.title} (${reason})`,
        { kind: 'timeline', level: 'warn', by: ctx.person.name });
      bus.publish('timeline.changed', { delay: delayMinutes, version: ver.version });
      return { ok: true, delayMinutes, shifted: blocks.filter((b) => toMinutes(b.start) >= targetStart).length, version: ver.version };
    }, { roles: ['management'] });

    // --- POST /api/timeline/freeze ---
    post('/api/timeline/freeze', async (ctx) => {
      const state = getState();
      const frozen = !state.frozen; // toggle
      setFrozen(frozen);
      const ver = nextVersion(frozen ? 'Timeline eingefroren' : 'Timeline aufgetaut', ctx.person.name);
      feed(`Ablaufplan: ${frozen ? 'eingefroren' : 'aufgetaut'} von ${ctx.person.name}`,
        { kind: 'timeline', level: frozen ? 'warn' : 'info', by: ctx.person.name });
      bus.publish('timeline.changed', { frozen, version: ver.version });
      return { ok: true, frozen, version: ver.version };
    }, { roles: ['management'] });

    // --- GET /api/timeline/versions ---
    get('/api/timeline/versions', async () => {
      const versions = db.all('timeline_versions')
        .sort((a, b) => a.version - b.version)
        .map(({ id, version, timestamp, author, reason }) => ({ id, version, timestamp, author, reason }));
      return versions;
    }, { roles: ['management', 'lead'] });

    // --- GET /api/timeline/versions/:id ---
    get('/api/timeline/versions/:id', async (ctx) => {
      const ver = db.get('timeline_versions', ctx.params.id) || notFound('Version nicht gefunden');
      return ver;
    }, { roles: ['management', 'lead'] });

    // --- GET /api/timeline/versions/:id1/diff/:id2 ---
    get('/api/timeline/versions/:id1/diff/:id2', async (ctx) => {
      const v1 = db.get('timeline_versions', ctx.params.id1) || notFound('Version 1 nicht gefunden');
      const v2 = db.get('timeline_versions', ctx.params.id2) || notFound('Version 2 nicht gefunden');

      const map1 = new Map(v1.blocks.map((b) => [b.id, b]));
      const map2 = new Map(v2.blocks.map((b) => [b.id, b]));

      const added = v2.blocks.filter((b) => !map1.has(b.id));
      const removed = v1.blocks.filter((b) => !map2.has(b.id));
      const changed = [];

      for (const [bid, b2] of map2) {
        const b1 = map1.get(bid);
        if (!b1) continue;
        const diffs = {};
        for (const key of ['title', 'start', 'end', 'type', 'order']) {
          if (b1[key] !== b2[key]) diffs[key] = { from: b1[key], to: b2[key] };
        }
        if (Object.keys(diffs).length > 0) {
          changed.push({ id: bid, title: b2.title, changes: diffs });
        }
      }

      return { v1: v1.version, v2: v2.version, added, removed, changed };
    }, { roles: ['management', 'lead'] });
  },
};
