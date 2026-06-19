// Horrorgeticon Ops — Basisdaten + Demo-Szenario „Horrornacht“
// Das Demo-Szenario entspricht dem Datenstand der Design-Mockups
// (Asylum A1–A8, Lena Krause auf A3, Vorfall im Keller, Catering Nord/Süd …).
import crypto from 'node:crypto';
import { id, now, iso, hhmm, hashPin } from '../kernel/util.js';
import { TEMPLATES as CHECKLIST_TEMPLATES, TYPE_LABEL as CHECKLIST_LABEL } from '../modules/checklists.mod.js';

export function ensureBaseline(db) {
  if (!db.get('settings', 'main')) {
    db.put('settings', 'main', {
      id: 'main',
      eventName: 'Horrorgeticon',
      nightLabel: 'Horrornacht · Fr 31.10.',
      eventDate: `${new Date().getFullYear()}-10-31`,
      active: true,
      phase: 'vorbereitung', // Lifecycle: vorbereitung → aufbau → live → abschluss
      shiftStart: '18:00', shiftEnd: '01:00',
      secret: crypto.randomBytes(16).toString('hex'),
      catering: { drinksDefault: 3, mealsDefault: 1, drinksBudget: 240, mealsBudget: 60, ausgabeBis: '23:00' },
      carpool: { tolMinDefault: 20, maxUmwegKm: 25 },
    });
  }
  // Bestände aus älteren Versionen: fehlende Phase nachrüsten (laufender Betrieb → live)
  const s = db.get('settings', 'main');
  if (s && !s.phase) db.patch('settings', 'main', { phase: 'live' });
  if (db.count('shifts') === 0) {
    db.put('shifts', 'sh_aufbau', { id: 'sh_aufbau', name: 'Aufbau & Maske', start: '16:00', end: '18:00', gruppe: 'crew', notiz: 'Treffpunkt Backstage' });
    db.put('shifts', 'sh_show', { id: 'sh_show', name: 'Showbetrieb', start: '18:00', end: '01:00', gruppe: 'crew', notiz: 'Wellen ab 18:30 alle 6 min' });
    db.put('shifts', 'sh_abbau', { id: 'sh_abbau', name: 'Tagesabschluss', start: '01:00', end: '02:00', gruppe: 'leads', notiz: 'Geld, Technik, Fundsachen' });
  }
}

const rel = (min) => now() - min * 60000;

export function seedDemo(db) {
  // ───────── Mazes, Räume, Positionen ─────────
  const mazes = [
    {
      key: 'asylum', name: 'Asylum', short: 'A', order: 1, zone: { x: '3%', y: '6%', w: '21%', h: '26%' },
      rooms: [
        { n: 'Empfang', x: '4%', y: '8%', w: '22%', h: '34%' }, { n: 'Schleuse', x: '29%', y: '6%', w: '20%', h: '28%' },
        { n: 'Zellenblock', x: '52%', y: '8%', w: '22%', h: '34%' }, { n: 'OP-Saal', x: '77%', y: '6%', w: '19%', h: '32%' },
        { n: 'Korridor', x: '6%', y: '46%', w: '88%', h: '8%', hall: true },
        { n: 'Waschraum', x: '4%', y: '58%', w: '20%', h: '34%' }, { n: 'Archiv', x: '27%', y: '60%', w: '22%', h: '32%' },
        { n: 'Isolation', x: '52%', y: '58%', w: '21%', h: '34%' }, { n: 'Keller', x: '76%', y: '60%', w: '20%', h: '32%' },
      ],
      positions: [
        ['A1', 'Empfang', '14%', '24%', 'Scare-Punkt hinter Empfangstresen · Trigger: Glocke'],
        ['A2', 'Schleuse', '38%', '18%', 'Enger Durchgang · Trigger: Türschlag'],
        ['A3', 'Zellenblock', '63%', '26%', 'Scare-Punkt hinter Gittertür · Trigger: Lichtwechsel'],
        ['A4', 'OP-Saal', '86%', '22%', 'OP-Tisch · Trigger: Monitor-Flackern'],
        ['A5', 'Waschraum', '12%', '62%', 'Spiegel-Scare · Trigger: Wasserhahn'],
        ['A6', 'Archiv', '36%', '70%', 'Regalgasse · Trigger: Aktenwagen'],
        ['A7', 'Isolation', '62%', '66%', 'Gepolsterte Zelle · Trigger: Klopfzeichen'],
        ['A8', 'Keller', '85%', '70%', 'Dunkelstrecke · Trigger: Kettengeräusch'],
        ['A9', 'Korridor', '30%', '48%', 'Wandernder Scare im Korridor'],
        ['A10', 'Korridor Ost', '70%', '48%', 'Wandernder Scare, Abschnitt Ost'],
        ['A11', 'Finale', '94%', '88%', 'Chase zum Ausgang'],
      ],
    },
    {
      key: 'saege', name: 'Kettensäge', short: 'S', order: 2, zone: { x: '27%', y: '6%', w: '19%', h: '26%' },
      roomNames: ['Sägewerk', 'Holzlager', 'Werkstatt', 'Galerie', 'Grube', 'Tunnel', 'Hof', 'Finale'],
    },
    {
      key: 'kata', name: 'Katakomben', short: 'K', order: 3, zone: { x: '3%', y: '38%', w: '21%', h: '26%' },
      roomNames: ['Gruft', 'Beinhaus', 'Krypta', 'Tunnel Nord', 'Tunnel Süd', 'Altarraum', 'Brunnen', 'Nische', 'Gang', 'Ausstieg'],
    },
    {
      key: 'puppen', name: 'Puppenhaus', short: 'P', order: 4, zone: { x: '27%', y: '38%', w: '19%', h: '26%' },
      roomNames: ['Salon', 'Kinderzimmer', 'Werkstatt', 'Speicher', 'Flur', 'Keller'],
    },
    {
      key: 'seuche', name: 'Seuchendorf', short: 'D', order: 5, zone: { x: '3%', y: '70%', w: '21%', h: '26%' },
      roomNames: ['Marktplatz', 'Lazarett', 'Kapelle', 'Brunnen', 'Scheune', 'Gasse', 'Quarantäne'],
    },
  ];

  const mazeIds = {};
  const posIds = {}; // 'A3' → id
  for (const m of mazes) {
    const mid = `m_${m.key}`;
    mazeIds[m.key] = mid;
    let rooms = m.rooms;
    let positions = m.positions;
    if (!positions) {
      // generisches 2-Reihen-Layout aus roomNames erzeugen
      rooms = []; positions = [];
      const names = m.roomNames;
      const perRow = Math.ceil(names.length / 2);
      names.forEach((n, i) => {
        const row = i < perRow ? 0 : 1;
        const col = row === 0 ? i : i - perRow;
        const W = Math.floor(92 / perRow) - 2;
        const x = 4 + col * (W + 2.5);
        const y = row === 0 ? 8 : 56;
        rooms.push({ n, x: `${x}%`, y: `${y}%`, w: `${W}%`, h: '36%' });
        positions.push([`${m.short}${i + 1}`, n, `${x + W / 2}%`, `${y + 18}%`, `Scare-Punkt ${n}`]);
      });
    }
    db.put('mazes', mid, {
      id: mid, name: m.name, short: m.short, order: m.order, zone: m.zone,
      rooms, leadPersonId: null, createdAt: iso(),
    });
    for (const [code, pname, x, y, desc] of positions) {
      const pid = `pos_${m.key}_${code}`;
      posIds[code] = pid;
      db.put('positions', pid, { id: pid, mazeId: mid, code, name: pname, desc, room: { x, y }, assignedPersonId: null });
    }
  }

  // ───────── Service-Zonen (Geländekarte) ─────────
  const zones = [
    { id: 'z_einlass', name: 'Eingang / Kassen', x: '62%', y: '6%', w: '32%', h: '26%', kind: 'einlass', note: 'Andrang hoch · Welle 41' },
    { id: 'z_crew', name: 'Backstage / Crew', x: '62%', y: '38%', w: '15%', h: '26%', kind: 'crew' },
    { id: 'z_catering', name: 'Catering', x: '79.5%', y: '38%', w: '14.5%', h: '26%', kind: 'catering' },
    { id: 'z_security', name: 'Security-Punkt Süd', x: '62%', y: '70%', w: '32%', h: '26%', kind: 'security' },
    { id: 'z_erw', name: 'Erweiterung 2027', x: '27%', y: '70%', w: '19%', h: '26%', kind: 'ghost', note: 'reserviert' },
  ];
  for (const z of zones) db.put('zones', z.id, z);

  // ───────── Personen ─────────
  const P = (code, name, roles, opts = {}) => ({
    id: `p_${code.toLowerCase().replace('-', '')}`,
    code, name, roles, status: opts.status || 'aktiv',
    kontakt: opts.kontakt || `${name.toLowerCase().split(' ')[0]}.${name.toLowerCase().split(' ')[1]?.[0] || 'x'}@crew.horrorgeticon.de`,
    telefon: '', ort: opts.ort || '', notizen: opts.notizen || '',
    season: String(new Date().getFullYear()),
    selfCreated: false, linked: !!opts.pin, // mit PIN = Konto vorhanden = verknüpft
    pin: opts.pin ? hashPin(opts.pin) : null,
    createdAt: iso(), createdBy: 'Seed',
  });

  const named = [
    P('DR-0001', 'Daniel Roth', ['management'], { pin: '4711', ort: 'Schauerfeld', notizen: 'Event-Leitung' }),
    P('MT-0301', 'Marco Tanner', ['lead', 'actor'], { pin: '1234', ort: 'Nebelbach', notizen: 'Maze Lead Asylum' }),
    P('LK-0427', 'Lena Krause', ['actor'], { pin: '1234', ort: 'Nebelbach', notizen: 'Stimme schonen ab 22 Uhr' }),
    P('JW-1102', 'Jonas Weber', ['actor'], { pin: '1234', ort: 'Rabenstein' }),
    P('SL-0815', 'Sarah Lindt', ['actor'], { ort: 'Grauenthal' }),
    P('TA-0633', 'Tariq Aydin', ['actor'], { ort: 'Schauerfeld' }),
    P('MS-0512', 'Mia Sommer', ['actor'], { ort: 'Moorlinde' }),
    P('PN-0904', 'Pavel Novak', ['actor'], { ort: 'Wolfshagen', notizen: 'Krank gemeldet? Bitte nachfassen.' }),
    P('RF-0718', 'Resa Fuchs', ['actor', 'springer'], { ort: 'Nebelbach' }),
    P('TH-0820', 'Timo Hartmann', ['actor'], { pin: '1234', ort: 'Eulenbruch' }),
    P('GS-0210', 'Greta Simon', ['lead', 'actor'], { pin: '1234', ort: 'Dornfelde', notizen: 'Maze Lead Katakomben' }),
    P('OB-0444', 'Olaf Brandt', ['lead', 'actor'], { ort: 'Kaltenborn', notizen: 'Maze Lead Kettensäge' }),
    P('HK-0223', 'Hanna Keller', ['lead', 'actor'], { ort: 'Schauerfeld', notizen: 'Maze Lead Puppenhaus' }),
    P('VB-0667', 'Viktor Berg', ['lead', 'actor'], { ort: 'Finsterloh', notizen: 'Maze Lead Seuchendorf' }),
    P('BO-0102', 'Ben Okafor', ['actor'], { pin: '1234', ort: 'Rabenstein' }),
    P('AD-0915', 'Aylin Demir', ['actor'], { ort: 'Mitternfurt' }),
    P('FB-0330', 'Finn Berger', ['actor'], { ort: 'Aschenrode' }),
    P('NP-0411', 'Nora Pohl', ['actor'], { ort: 'Grauenthal' }),
    P('SB-0901', 'Sina Brandt', ['catering'], { pin: '1234', ort: 'Schauerfeld', notizen: 'Station Nord' }),
    P('JK-0902', 'Jens Köhler', ['catering'], { pin: '1234', ort: 'Eulenbruch', notizen: 'Station Süd' }),
    P('KS-0719', 'Karim Said', ['actor', 'springer'], { ort: 'Schauerfeld' }),
    P('JB-0720', 'Julia Brandt', ['actor', 'springer'], { ort: 'Nebelbach' }),
  ];

  const filler = [
    'Emil Hartwig', 'Frida Lorenz', 'Samira Önal', 'Leo Wagner', 'Charlotte Busch', 'Niko Petrow',
    'Maja Winter', 'Tom Albrecht', 'Zoe Krüger', 'David Lehmann', 'Ella Vogt', 'Paul Westphal',
    'Ida Neumann', 'Oskar Thiel', 'Lia Schubert', 'Jan Falk', 'Mira Stein', 'Felix Adler',
    'Tessa Brand', 'Ruben Voss', 'Alina Frank', 'Mats Brunner', 'Pia Engel', 'Noah Seidel',
    'Lara Hoff', 'Til Bergmann', 'Amelie Funk', 'Janne Wolf', 'Selin Acar', 'Bruno Hess',
  ].map((name, i) => {
    const ini = name.split(' ').map((w) => w[0]).join('').toUpperCase();
    const orte = ['Schauerfeld', 'Nebelbach', 'Rabenstein', 'Grauenthal', 'Moorlinde', 'Finsterloh', 'Eulenbruch', 'Wolfshagen', 'Dornfelde', 'Kaltenborn', 'Aschenrode', 'Mitternfurt'];
    return P(`${ini}-1${String(i).padStart(3, '0')}`, name, ['actor'], { ort: orte[i % orte.length] });
  });

  // Eine angefragte Person (Pitch: Aylin „Angefragt“ → hier eigene Person dafür)
  const angefragt = P('TJ-0999', 'Theo Jansen', ['actor'], { status: 'angefragt', ort: 'Moorlinde', notizen: 'Anfrage über Insta, wartet auf Zusage' });

  const all = [...named, ...filler, angefragt];
  for (const p of all) db.put('people', p.id, p);
  const byName = Object.fromEntries(all.map((p) => [p.name, p]));

  // Leads den Mazes zuordnen
  db.patch('mazes', mazeIds.asylum, { leadPersonId: byName['Marco Tanner'].id });
  db.patch('mazes', mazeIds.kata, { leadPersonId: byName['Greta Simon'].id });
  db.patch('mazes', mazeIds.saege, { leadPersonId: byName['Olaf Brandt'].id });
  db.patch('mazes', mazeIds.puppen, { leadPersonId: byName['Hanna Keller'].id });
  db.patch('mazes', mazeIds.seuche, { leadPersonId: byName['Viktor Berg'].id });

  // ───────── Zuteilung ─────────
  const assign = (posCode, personName) => {
    const pid = byName[personName]?.id;
    if (pid && posIds[posCode]) db.patch('positions', posIds[posCode], { assignedPersonId: pid });
  };
  assign('A1', 'Jonas Weber'); assign('A2', 'Sarah Lindt'); assign('A3', 'Lena Krause');
  assign('A4', 'Tariq Aydin'); assign('A5', 'Mia Sommer'); /* A6 offen: Pavel fehlt */
  assign('A7', 'Resa Fuchs'); assign('A8', 'Timo Hartmann');
  assign('A9', 'Emil Hartwig'); assign('A10', 'Frida Lorenz'); /* A11 offen */
  assign('K2', 'Ben Okafor'); assign('P5', 'Aylin Demir'); assign('S1', 'Finn Berger'); assign('D4', 'Nora Pohl');

  // Restliche Filler auf restliche Positionen verteilen (ein paar bleiben offen)
  const openLeave = new Set(['pos_asylum_A6', 'pos_asylum_A11', 'pos_kata_K4', 'pos_saege_S3']);
  const freePositions = db.find('positions', (p) => !p.assignedPersonId && !openLeave.has(p.id));
  const unassigned = all.filter((p) => p.status === 'aktiv' && p.roles.includes('actor') && !p.roles.includes('springer') &&
    !db.one('positions', (x) => x.assignedPersonId === p.id) && !p.roles.includes('lead') && !p.roles.includes('management') && !p.roles.includes('catering'));
  freePositions.forEach((pos, i) => {
    if (unassigned[i]) db.patch('positions', pos.id, { assignedPersonId: unassigned[i].id });
  });

  // ───────── Anwesenheit (Tracking) ─────────
  const checkin = (name, minAgoSeen = 0) => {
    const p = byName[name]; if (!p) return;
    db.put('presence', p.id, {
      personId: p.id, state: 'in', since: rel(225), lastSeen: rel(minAgoSeen),
      battery: 40 + Math.floor(Math.random() * 55), device: 'Demo', positionConfirmedAt: rel(220),
    });
  };
  for (const p of all) {
    if (p.status !== 'aktiv') continue;
    if (['Pavel Novak', 'Theo Jansen'].includes(p.name)) continue; // nicht eingecheckt
    // drei Personen fehlen zusätzlich unentschuldigt
    if (['Janne Wolf', 'Selin Acar', 'Bruno Hess'].includes(p.name)) continue;
    checkin(p.name, Math.random() < 0.9 ? 0 : 0);
  }

  // ───────── Pausen ─────────
  db.put('breaks', 'b_lena', {
    id: 'b_lena', personId: byName['Lena Krause'].id, note: 'Brauche 10 Minuten, Stimme ist durch.',
    requestedAt: rel(11), time: hhmm(rel(11)), status: 'offen', durationMin: 15,
  });
  db.put('breaks', 'b_mia', {
    id: 'b_mia', personId: byName['Mia Sommer'].id, note: '',
    requestedAt: rel(14), time: hhmm(rel(14)), status: 'läuft', startedAt: rel(12), durationMin: 15, approvedBy: 'Marco Tanner',
  });
  db.put('breaks', 'b_ben', {
    id: 'b_ben', personId: byName['Ben Okafor'].id, note: '',
    requestedAt: rel(6), time: hhmm(rel(6)), status: 'offen', durationMin: 15,
  });
  db.put('breaks', 'b_aylin', {
    id: 'b_aylin', personId: byName['Aylin Demir'].id, note: 'Kostüm drückt, kurz richten',
    requestedAt: rel(3), time: hhmm(rel(3)), status: 'offen', durationMin: 10,
  });
  db.put('breaks', 'b_finn', {
    id: 'b_finn', personId: byName['Finn Berger'].id, note: '',
    requestedAt: rel(1), time: hhmm(rel(1)), status: 'offen', durationMin: 15,
  });
  db.put('breaks', 'b_lena_alt', {
    id: 'b_lena_alt', personId: byName['Lena Krause'].id, note: '',
    requestedAt: rel(181), time: hhmm(rel(181)), status: 'beendet', startedAt: rel(180), endedAt: rel(170), durationMin: 10, approvedBy: 'Marco Tanner',
  });

  // ───────── Meldungen ─────────
  const incident = (idv, minAgo, kind, prio, text, posCode, byNamex, status, extra = {}) => {
    const pos = posCode ? db.get('positions', posIds[posCode]) : null;
    const maze = pos ? db.get('mazes', pos.mazeId) : null;
    const t = rel(minAgo);
    db.put('incidents', idv, {
      id: idv, t, time: hhmm(t), kind, prio, text,
      positionId: pos?.id || null, mazeId: maze?.id || extra.mazeId || null,
      ort: extra.ort || (pos ? `${maze.name} · ${pos.code}${pos.name ? ` „${pos.name}“` : ''}` : ''),
      byPersonId: byName[byNamex]?.id || null, byName: byNamex,
      status, assignee: extra.assignee || null,
      ackAt: status !== 'offen' ? t + 90e3 : null,
      doneAt: status === 'erledigt' ? t + 8 * 60e3 : null,
      reactionSec: status !== 'offen' ? 60 + Math.floor(Math.random() * 240) : null,
      leavePosition: !!extra.leavePosition,
    });
  };
  incident('i_keller', 6, 'gast', 'hoch', 'Gast hat Absperrung durchbrochen — Keller, Asylum', 'A8', 'Timo Hartmann', 'offen', { leavePosition: false });
  incident('i_strobo', 11, 'technik', 'mittel', 'Stroboskop ausgefallen — Abschnitt ist zu dunkel', 'A3', 'Lena Krause', 'in_arbeit', { assignee: null });
  incident('i_funk', 29, 'technik', 'mittel', 'Funkgerät defekt — Ersatz benötigt', null, 'Daniel Roth', 'offen', { ort: 'Eingang Süd' });
  incident('i_getraenk', 55, 'getraenk', 'niedrig', 'Getränk angefordert', 'K2', 'Ben Okafor', 'erledigt');
  incident('i_nebel', 76, 'technik', 'mittel', 'Nebelmaschine Abschnitt B ausgefallen', 'A9', 'Marco Tanner', 'erledigt');
  incident('i_kostuem', 103, 'sonstiges', 'niedrig', 'Kostüm-Reparatur benötigt', 'P5', 'Aylin Demir', 'erledigt');
  incident('i_kollaps', 120, 'notfall', 'hoch', 'Gast kollabiert — Sanitäter im Einsatz', 'S2', 'Finn Berger', 'erledigt');
  incident('i_requisite', 155, 'technik', 'niedrig', 'Requisite locker', 'D4', 'Nora Pohl', 'erledigt');

  // ───────── Durchsagen + Feed ─────────
  const ann = (idv, minAgo, level, text, scopeLabel, byNamex, scope = { type: 'all' }) => {
    const t = rel(minAgo);
    db.put('announcements', idv, {
      id: idv, t, time: hhmm(t), text, level, scope, scopeLabel,
      audience: null, byPersonId: byName[byNamex]?.id || null, byName: byNamex,
      requiresAck: level === 'notfall',
    });
  };
  ann('a_andrang', 45, 'wichtig', 'Hoher Andrang am Einlass — Wellen werden ab sofort enger getaktet. Bleibt auf Position.', 'an alle', 'Daniel Roth');
  ann('a_nebel', 76, 'info', 'Nebelmaschine in Abschnitt B läuft wieder.', 'nur Asylum', 'Marco Tanner', { type: 'maze', mazeId: mazeIds.asylum });

  const feedItem = (minAgo, text, kind, level = 'info', by = 'System', mazeKey = null) => {
    const t = rel(minAgo);
    const f = { id: id('f'), t, time: hhmm(t), text, kind, level, scope: 'all', by, module: null, mazeId: mazeKey ? mazeIds[mazeKey] : null };
    db.put('feed', f.id, f);
  };
  feedItem(6, '🚨 PRIO HOCH — Gast hat Absperrung durchbrochen (Asylum · A8 „Keller“)', 'meldung', 'err', 'Timo Hartmann', 'asylum');
  feedItem(11, '🛠️ Stroboskop ausgefallen — Abschnitt ist zu dunkel (Asylum · A3 „Zellenblock“)', 'meldung', 'warn', 'Lena Krause', 'asylum');
  feedItem(11, '☕ Pausen-Anfrage: Lena Krause (Asylum · A3) — „Brauche 10 Minuten, Stimme ist durch.“', 'pause', 'info', 'Lena Krause', 'asylum');
  feedItem(45, '📢 Wichtig: Hoher Andrang am Einlass — Wellen werden enger getaktet.', 'durchsage', 'warn', 'Daniel Roth');
  feedItem(76, '📢 Nebelmaschine in Abschnitt B läuft wieder.', 'durchsage', 'info', 'Marco Tanner', 'asylum');
  feedItem(225, '✅ Schichtbeginn: Crew checkt ein — 47 von 52 anwesend.', 'anwesenheit', 'info');

  // ───────── Catering ─────────
  db.put('stations', 'st_nord', { id: 'st_nord', name: 'Station Nord', place: 'Backstage', operatorPersonId: byName['Sina Brandt'].id, createdAt: iso() });
  db.put('stations', 'st_sued', { id: 'st_sued', name: 'Station Süd', place: 'Crew-Zelt', operatorPersonId: byName['Jens Köhler'].id, createdAt: iso() });
  db.put('stations', 'st_mobil', { id: 'st_mobil', name: 'Station Mobil', place: 'Gelände', operatorPersonId: null, createdAt: iso() });

  for (const p of all) {
    if (p.status !== 'aktiv') continue;
    db.put('wallets', p.id, {
      personId: p.id, drinks: { total: 3, used: 0 }, meals: { total: 1, used: 0 },
      updatedAt: iso(), expiresAt: null,
    });
  }
  // Einlöse-Historie (~50 Personen → Getränke/Essen verteilt über den Abend)
  const redeemable = all.filter((p) => p.status === 'aktiv' && !['Pavel Novak'].includes(p.name));
  let rn = 0;
  for (let i = 0; i < redeemable.length; i++) {
    const p = redeemable[i];
    const w = db.get('wallets', p.id);
    const drinks = i % 3 === 0 ? 2 : 1;
    const meals = i % 2 === 0 ? 1 : 0;
    if (!w || (drinks === 0 && meals === 0)) continue;
    const stationId = i % 2 === 0 ? 'st_nord' : 'st_sued';
    const t = rel(10 + Math.floor(Math.random() * 200));
    const rid = `r_seed_${rn++}`;
    db.put('redemptions', rid, {
      id: rid, t, time: hhmm(t), personId: p.id, personName: p.name,
      stationId, stationName: stationId === 'st_nord' ? 'Station Nord' : 'Station Süd',
      drinks, meals, operator: stationId === 'st_nord' ? 'Sina Brandt' : 'Jens Köhler',
    });
    db.put('wallets', p.id, {
      ...w, drinks: { ...w.drinks, used: Math.min(w.drinks.total, drinks) },
      meals: { ...w.meals, used: Math.min(w.meals.total, meals) }, updatedAt: iso(),
    });
  }
  db.put('rejections', 'rj_1', { id: 'rj_1', t: rel(34), time: hhmm(rel(34)), personId: byName['Ben Okafor'].id, stationId: 'st_nord', grund: 'Code bereits benutzt' });
  db.put('rejections', 'rj_2', { id: 'rj_2', t: rel(88), time: hhmm(rel(88)), personId: byName['Finn Berger'].id, stationId: 'st_sued', grund: 'Code bereits benutzt' });

  // ───────── Fahrgruppen ─────────
  const offer = (idv, name, ort, seats, departAt) => {
    const p = byName[name];
    db.put('carpoolOffers', idv, {
      id: idv, personId: p.id, ort, seats, lat: null, lon: null,
      departAt, tolMin: 20, direction: 'beide', note: '', active: true, createdAt: rel(600),
    });
  };
  const request = (idv, name, ort, departAt, flexMin = 30) => {
    const p = byName[name];
    db.put('carpoolRequests', idv, {
      id: idv, personId: p.id, ort, lat: null, lon: null,
      departAt, flexMin, direction: 'beide', note: '', active: true, createdAt: rel(580),
    });
  };
  offer('co_marco', 'Marco Tanner', 'Nebelbach', 3, '16:30');
  offer('co_greta', 'Greta Simon', 'Dornfelde', 2, '16:45');
  offer('co_jonas', 'Jonas Weber', 'Rabenstein', 4, '17:00');
  request('cr_lena', 'Lena Krause', 'Nebelbach', '16:30');
  request('cr_julia', 'Julia Brandt', 'Nebelbach', '16:45');
  request('cr_ben', 'Ben Okafor', 'Rabenstein', '17:00');
  request('cr_mia', 'Mia Sommer', 'Moorlinde', '16:30', 45);
  request('cr_karim', 'Karim Said', 'Schauerfeld', '17:15');

  // Orte mit Koordinaten nachtragen (für Matching-Distanzen)
  // (lookupOrt fällt sonst auf die eingebaute Liste zurück — hier nichts nötig)

  // ───────── Chat ─────────
  const msg = (ch, minAgo, name, text) => {
    const t = rel(minAgo);
    const m = { id: id('msg'), channelId: ch, t, time: hhmm(t), byPersonId: byName[name]?.id || null, byName: name, text };
    db.put('messages', m.id, m);
  };
  // Kanäle legt das Chat-Modul bei init an — Maze-Kanäle brauchen die Maze-IDs,
  // deshalb hier sicherstellen:
  const ensureCh = (key, name, type, extra = {}) => {
    if (!db.one('channels', (c) => c.key === key)) {
      db.put('channels', key, { id: key, key, name, type, members: null, createdAt: now(), ...extra });
    }
  };
  ensureCh('ch_leitstand', '#leitstand', 'system', { restrict: ['management', 'lead'] });
  ensureCh('ch_crew', '#crew', 'system');
  ensureCh('ch_catering', '#catering', 'system', { restrict: ['management', 'catering'] });
  for (const m of db.all('mazes')) ensureCh(`ch_maze_${m.id}`, `#${m.name.toLowerCase()}`, 'maze', { mazeId: m.id });

  msg('ch_leitstand', 9, 'Daniel Roth', 'Security ist auf dem Weg in den Keller, Asylum hält Abschnitt an.');
  msg('ch_leitstand', 8, 'Marco Tanner', 'Verstanden, Timo hält Position. Gäste werden an A7 gestaut.');
  msg('ch_leitstand', 27, 'Greta Simon', 'Katakomben: alles ruhig, K4 bleibt heute unbesetzt — wir kompensieren.');
  msg('ch_crew', 41, 'Daniel Roth', 'Starker Abend bis jetzt — denkt an eure Pausen und trinkt genug! 🎃');
  msg('ch_crew', 18, 'Sina Brandt', 'Catering Nord: Kürbissuppe ist da. Essensmarken nicht vergessen.');
  msg(`ch_maze_${mazeIds.asylum}`, 13, 'Marco Tanner', 'A3: Strobo-Ausfall ist gemeldet, Technik kommt nach der nächsten Welle.');
  msg(`ch_maze_${mazeIds.asylum}`, 12, 'Lena Krause', 'Danke! Solange spiele ich mit der Taschenlampe.');

  // ───────── Aufgaben (Dispatch-Demo) ─────────
  const task = (idv, minAgo, title, opts = {}) => {
    const t = rel(minAgo);
    db.put('tasks', idv, {
      id: idv, t, time: hhmm(t), title, desc: opts.desc || '',
      prio: opts.prio || 'normal', critical: !!opts.critical,
      status: opts.status || 'offen',
      mazeId: opts.maze ? mazeIds[opts.maze] : null,
      assigneeId: opts.who ? byName[opts.who]?.id || null : null,
      deadline: opts.deadline || null, phase: opts.phase || null,
      createdBy: opts.by || 'Daniel Roth', note: opts.note || null,
      doneAt: opts.status === 'erledigt' ? rel(minAgo - 20) : undefined,
      history: [{ t, time: hhmm(t), who: opts.by || 'Daniel Roth', action: 'erstellt' }],
    });
  };
  task('t_strobo', 10, 'Ersatz-Stroboskop zu A3 bringen und anschließen', {
    prio: 'hoch', critical: true, status: 'in_arbeit', maze: 'asylum', who: 'Marco Tanner',
    desc: 'Ausfall gemeldet 21:36 — Ersatzgerät liegt im Technik-Lager, Regal B.', deadline: hhmm(rel(-20)), phase: 'live',
  });
  task('t_funk', 25, 'Ersatz-Funkgerät an Eingang Süd ausgeben', {
    prio: 'hoch', status: 'offen', deadline: hhmm(rel(10)), phase: 'live', // überfällig (Demo)
    desc: 'Defektes Gerät einsammeln und ins Lager legen.',
  });
  task('t_absperr', 4, 'Absperrung im Keller (A8) prüfen und verstärken', {
    prio: 'hoch', critical: true, status: 'offen', maze: 'asylum', phase: 'live',
    desc: 'Nach Gast-Durchbruch: Kabelbinder + zweite Stange aus dem Lager.',
  });
  task('t_wasser', 40, 'Wasserflaschen an Katakomben-Positionen verteilen', {
    prio: 'niedrig', status: 'angenommen', maze: 'kata', who: 'Greta Simon', phase: 'live',
  });
  task('t_nebel', 70, 'Nebelfluid-Reserve in alle Mazes bringen', {
    prio: 'normal', status: 'erledigt', who: 'Karim Said', phase: 'live',
  });
  task('t_blockiert', 33, 'Lautsprecher Seuchendorf-Gasse neu ausrichten', {
    prio: 'normal', status: 'blockiert', maze: 'seuche', who: 'Viktor Berg', phase: 'live',
    note: 'Leiter ist im Kettensäge-Lager eingeschlossen — Schlüssel fehlt.',
  });
  task('t_fundsachen', 5, 'Fundsachen-Kiste am Ausgang aufstellen', { prio: 'niedrig', status: 'offen', phase: 'abschluss' });
  task('t_sweep', 6, 'Abschluss-Sweep-Plan an alle Leads verteilen', { prio: 'normal', status: 'offen', phase: 'abschluss' });
  task('t_banner', 200, 'Einlass-Banner „Welle 40+“ aufhängen', { prio: 'normal', status: 'bestätigt', phase: 'aufbau', who: 'Jonas Weber' });

  // ───────── Checklisten (Rundgänge) ─────────
  // Je Maze: Sicherheit (Pflicht!) + Aufbau. Asylum: 1 Pflichtpunkt offen → Dashboard zeigt „nicht bereit“.
  let clN = 0;
  for (const m of db.all('mazes')) {
    for (const type of ['sicherheit', 'aufbau']) {
      const idv = `cl_${type}_${m.id}`;
      const allDone = !(type === 'sicherheit' && m.id === mazeIds.asylum);
      const items = CHECKLIST_TEMPLATES[type].map(([text, mandatory], i) => {
        // Asylum-Sicherheit: Funkcheck (Pflicht) noch offen
        const done = allDone ? true : !(mandatory && text.startsWith('Funkcheck'));
        return {
          id: `i${i + 1}`, text, mandatory, done,
          doneBy: done ? (db.get('people', m.leadPersonId)?.name || 'Lead') : null,
          doneAt: done ? rel(190 - clN * 3) : null,
        };
      });
      db.put('checklists', idv, {
        id: idv, type, title: `${CHECKLIST_LABEL[type]}-Rundgang`, mazeId: m.id,
        items, createdBy: 'Daniel Roth', createdAt: iso(),
        startedBy: db.get('people', m.leadPersonId)?.name || null,
        completedAt: items.every((i) => !i.mandatory || i.done) ? rel(180 - clN * 3) : null,
      });
      clN++;
    }
  }

  // Entscheidungslog-Beispiel
  feedItem(8, '📌 Entscheidung: Keller-Abschnitt (A8) bleibt offen, Security postiert sich an der Absperrung.', 'entscheidung', 'info', 'Daniel Roth', 'asylum');

  // ───────── Kids Day Konfiguration ─────────
  const eventDate = `${new Date().getFullYear()}-10-31`;
  const kidsDay = {
    enabled: true,
    date: eventDate,
    startTime: '10:00',
    endTime: '16:00',
    ageGroups: [
      { label: '4-6 Jahre', minAge: 4, maxAge: 6 },
      { label: '7-9 Jahre', minAge: 7, maxAge: 9 },
      { label: '10-12 Jahre', minAge: 10, maxAge: 12 },
    ],
    defaultIntensity: 'leicht',
    mazeConfigs: [
      { mazeId: mazeIds.asylum, intensity: 'leicht', maxGroupSize: 8, specialRules: 'Kein Stroboskop, Nebel minimal' },
      { mazeId: mazeIds.saege, intensity: 'mittel', maxGroupSize: 6, specialRules: 'Kettensaege nur Attrappe, kein Motorstart' },
      { mazeId: mazeIds.kata, intensity: 'leicht', maxGroupSize: 10, specialRules: 'Beleuchtung erhoehen' },
      { mazeId: mazeIds.puppen, intensity: 'leicht', maxGroupSize: 8, specialRules: null },
      { mazeId: mazeIds.seuche, intensity: 'aus', maxGroupSize: 0, specialRules: 'Zu intensiv fuer Kids Day — geschlossen' },
    ],
    safetyBriefingRequired: true,
    parentStations: [
      { name: 'Eltern-Lounge Eingang', location: 'Neben dem Einlass' },
      { name: 'Eltern-Treffpunkt Mitte', location: 'Zwischen Asylum und Katakomben' },
    ],
    emergencyProtocol: 'Bei Notfall: Kind beruhigen, Eltern informieren, Erste Hilfe alarmieren.',
  };
  db.patch('settings', 'main', { kidsDay });

  // ───────── Kids Day Checklisten (Instanzen) ─────────
  // Asylum: kidsday_sicherheit (fast komplett, 1 Punkt offen)
  const kdSichAsylumItems = CHECKLIST_TEMPLATES.kidsday_sicherheit.map(([text, mandatory], i) => {
    const done = !(mandatory && text.startsWith('Funktest'));
    return {
      id: `i${i + 1}`, text, mandatory, done,
      doneBy: done ? 'Marco Tanner' : null,
      doneAt: done ? rel(45 - i) : null,
    };
  });
  db.put('checklists', 'cl_kdsich_asylum', {
    id: 'cl_kdsich_asylum', type: 'kidsday_sicherheit', title: 'Kids Day Sicherheit-Rundgang',
    mazeId: mazeIds.asylum, items: kdSichAsylumItems,
    createdBy: 'Daniel Roth', createdAt: iso(),
    startedBy: 'Marco Tanner',
    completedAt: null,
  });

  // Katakomben: kidsday_sicherheit (komplett)
  const kdSichKataItems = CHECKLIST_TEMPLATES.kidsday_sicherheit.map(([text, mandatory], i) => ({
    id: `i${i + 1}`, text, mandatory, done: true,
    doneBy: 'Greta Simon',
    doneAt: rel(60 - i),
  }));
  db.put('checklists', 'cl_kdsich_kata', {
    id: 'cl_kdsich_kata', type: 'kidsday_sicherheit', title: 'Kids Day Sicherheit-Rundgang',
    mazeId: mazeIds.kata, items: kdSichKataItems,
    createdBy: 'Daniel Roth', createdAt: iso(),
    startedBy: 'Greta Simon',
    completedAt: rel(50),
  });

  // Asylum: kidsday_preshow (komplett)
  const kdPreAsylumItems = CHECKLIST_TEMPLATES.kidsday_preshow.map(([text, mandatory], i) => ({
    id: `i${i + 1}`, text, mandatory, done: true,
    doneBy: 'Marco Tanner',
    doneAt: rel(30 - i),
  }));
  db.put('checklists', 'cl_kdpre_asylum', {
    id: 'cl_kdpre_asylum', type: 'kidsday_preshow', title: 'Kids Day Vorbereitung-Rundgang',
    mazeId: mazeIds.asylum, items: kdPreAsylumItems,
    createdBy: 'Daniel Roth', createdAt: iso(),
    startedBy: 'Marco Tanner',
    completedAt: rel(22),
  });

  // ───────── Dokumenten-Hub (Pitch-Daten) ─────────
  db.put('documents', 'doc_briefing', {
    id: 'doc_briefing',
    title: 'Sicherheits-Briefing Horrornacht',
    category: 'briefing',
    visibility: 'alle',
    pinned: true,
    content: 'Willkommen zur Horrornacht! Dieses Briefing fasst die wichtigsten Sicherheitsregeln zusammen.\n\n' +
      '1. Niemals einen Gast physisch beruehren oder festhalten. Scare-Kontakt erfolgt ausschliesslich ueber Geraeusche, Licht und Bewegung. ' +
      'Bei Panik-Reaktionen eines Gastes sofort Abstand halten und per Funk melden.\n\n' +
      '2. Alle Notausgaenge muessen jederzeit frei zugaenglich bleiben. Requisiten duerfen niemals Fluchtwege blockieren. ' +
      'Jeder Actor kennt den naechsten Notausgang seiner Position auswendig.\n\n' +
      '3. Das Codewort \"LICHT AN\" beendet sofort jede Scare-Aktion im Abschnitt. ' +
      'Bei Verwendung: Beleuchtung einschalten, Gaeste beruhigen, auf Anweisung der Leitung warten.',
    createdAt: now(),
    createdBy: 'Daniel Roth',
    updatedAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('documents', 'doc_lageplan', {
    id: 'doc_lageplan',
    title: 'Lageplan Gelaende & Notausgaenge',
    category: 'lageplan',
    visibility: 'alle',
    pinned: true,
    content: 'Der Lageplan zeigt alle fuenf Mazes, Service-Zonen und Notausgaenge des Gelaendes.\n\n' +
      'Notausgaenge befinden sich an folgenden Punkten: Asylum Suedseite (hinter Keller), Kettensaege Westtor, ' +
      'Katakomben Treppenaufgang Nord, Puppenhaus Hinterausgang, Seuchendorf Hauptgasse Ende. ' +
      'Alle Ausgaenge sind mit gruenen LED-Streifen am Boden markiert und per Panikschloss zu oeffnen.\n\n' +
      'Service-Zonen: Einlass/Kassen im Nordosten, Backstage/Crew mittig-ost, Catering suedost, ' +
      'Security-Punkt Sued im Suedosten. Die Erweiterungsflaeche West ist 2027 reserviert.',
    createdAt: now(),
    createdBy: 'Daniel Roth',
    updatedAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('documents', 'doc_notfall', {
    id: 'doc_notfall',
    title: 'Notfallplan & Sanitaeter-Standorte',
    category: 'notfall',
    visibility: 'alle',
    pinned: true,
    content: 'Im Notfall gilt die Meldekette: Actor -> Lead -> Leitstand -> Rettungsdienst.\n\n' +
      'Sanitaeter-Standorte: Station Alpha (Einlass-Bereich, permanent besetzt), ' +
      'Station Bravo (Backstage, ab 18:00 besetzt), Mobile Einheit Charlie (auf dem Gelaende patroullierend). ' +
      'Defibrillatoren haengen an: Einlass Haupttor, Backstage Eingang, Security-Punkt Sued.\n\n' +
      'Bei Evakuierung: Codewort \"VORHANG\" ueber Funk. Alle Scare-Aktionen stoppen sofort, ' +
      'Beleuchtung auf Maximum, Actors leiten Gaeste zum naechsten Notausgang. ' +
      'Sammelplatz ist der Parkplatz Nord (beleuchtet, gekennzeichnet).',
    createdAt: now(),
    createdBy: 'Daniel Roth',
    updatedAt: now(),
    updatedBy: 'Daniel Roth',
  });

  // ───────── Timeline-Bloecke (Pitch-Daten) ─────────
  db.put('timeline_blocks', 'tb_briefing', {
    id: 'tb_briefing',
    title: 'Crew-Briefing',
    start: '16:00',
    end: '16:45',
    type: 'block',
    order: 0,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('timeline_blocks', 'tb_einlass', {
    id: 'tb_einlass',
    title: 'Einlass & Aufwaermphase',
    start: '17:30',
    end: '18:00',
    type: 'block',
    order: 1,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('timeline_blocks', 'tb_show1', {
    id: 'tb_show1',
    title: 'Show-Start — Welle 1',
    start: '18:00',
    end: '21:00',
    type: 'block',
    order: 2,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('timeline_blocks', 'tb_pause', {
    id: 'tb_pause',
    title: 'Pause / Catering-Rotation',
    start: '21:00',
    end: '21:30',
    type: 'block',
    order: 3,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('timeline_blocks', 'tb_show2', {
    id: 'tb_show2',
    title: 'Show Teil 2 — Intensivphase',
    start: '21:30',
    end: '23:30',
    type: 'block',
    order: 4,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  db.put('timeline_blocks', 'tb_abschluss', {
    id: 'tb_abschluss',
    title: 'Abschluss & Abbau',
    start: '23:30',
    end: '01:00',
    type: 'block',
    order: 5,
    createdAt: now(),
    updatedBy: 'Daniel Roth',
  });

  // Demo-Szenario = laufende Horrornacht
  db.patch('settings', 'main', { phase: 'live' });

  db.snapshot('seed');
}
