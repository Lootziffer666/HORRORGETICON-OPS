// Horrorgeticon Ops — Datenhaltung
// Prinzip „praktisch unkaputtbar“:
//   1. Jede Mutation wird SOFORT als Zeile ins Journal geschrieben (Autosave).
//   2. Der Zustand wird verzögert als atomarer Snapshot gesichert (tmp → rename) + SHA-256.
//   3. Rotierende Backups; beim Start wird Integrität geprüft und notfalls aus
//      Backup + Journal wieder aufgebaut (Backup-Rebuild).
import fs from 'node:fs';
import path from 'node:path';
import { sha256, iso, now } from './util.js';

const SNAPSHOT = 'state.json';
const JOURNAL = 'journal.jsonl';

export class DB {
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.backupDir = path.join(dir, 'backups');
    this.opts = { snapshotIdleMs: 1500, snapshotMaxOps: 400, keepBackups: 24, journalMaxBytes: 8 * 1024 * 1024, ...opts };
    this.state = {};            // { collection: { id: record } }
    this.seq = 0;               // letzte Journal-Sequenz
    this.snapshotSeq = 0;       // Sequenz des letzten Snapshots
    this.opsSinceSnapshot = 0;
    this._snapTimer = null;
    this.bootReport = [];       // was beim Laden passiert ist (für Diagnose-UI)
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  file(name) { return path.join(this.dir, name); }

  // ───────── Laden / Wiederherstellen ─────────
  load() {
    const snapPath = this.file(SNAPSHOT);
    let loaded = false;
    if (fs.existsSync(snapPath)) {
      loaded = this._tryLoadSnapshot(snapPath, 'Snapshot');
    }
    if (!loaded) {
      // Backups vom neuesten zum ältesten probieren
      const backups = this.listBackups();
      for (const b of backups) {
        if (this._tryLoadSnapshot(path.join(this.backupDir, b.file), `Backup ${b.file}`)) { loaded = true; break; }
      }
    }
    if (!loaded) {
      this.bootReport.push('Kein gültiger Snapshot — Zustand wird leer initialisiert bzw. komplett aus dem Journal aufgebaut.');
      this.state = {}; this.snapshotSeq = 0; this.seq = 0;
    }
    const replayed = this._replayJournal(this.snapshotSeq);
    if (replayed > 0) this.bootReport.push(`${replayed} Journal-Einträge nachgespielt (Autosave-Wiederherstellung).`);
    this.bootReport.push(`Geladen: seq ${this.seq}, ${Object.keys(this.state).length} Collections.`);
    return this;
  }

  _tryLoadSnapshot(p, label) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const shaFile = p + '.sha256';
      if (fs.existsSync(shaFile)) {
        const want = fs.readFileSync(shaFile, 'utf8').trim().split(/\s/)[0];
        if (want && sha256(raw) !== want) throw new Error('Checksumme stimmt nicht');
      }
      const snap = JSON.parse(raw);
      if (!snap || typeof snap !== 'object' || typeof snap.state !== 'object') throw new Error('Struktur ungültig');
      this.state = snap.state;
      this.snapshotSeq = this.seq = snap.seq || 0;
      this.bootReport.push(`${label} geladen (seq ${this.seq}).`);
      return true;
    } catch (e) {
      this.bootReport.push(`${label} unbrauchbar: ${e.message} — nächste Quelle wird versucht.`);
      return false;
    }
  }

  _replayJournal(afterSeq) {
    const jp = this.file(JOURNAL);
    if (!fs.existsSync(jp)) return 0;
    let n = 0, broken = 0;
    const lines = fs.readFileSync(jp, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { broken++; continue; } // abgerissene Zeile (Stromausfall) überspringen
      if (!e || typeof e.s !== 'number' || e.s <= afterSeq) continue;
      this._applyToState(e);
      this.seq = Math.max(this.seq, e.s);
      n++;
    }
    if (broken) this.bootReport.push(`${broken} beschädigte Journal-Zeile(n) ignoriert.`);
    return n;
  }

  _applyToState(e) {
    if (e.op === 'put') {
      (this.state[e.col] ||= {})[e.id] = e.v;
    } else if (e.op === 'del') {
      if (this.state[e.col]) delete this.state[e.col][e.id];
    } else if (e.op === 'clear') {
      this.state[e.col] = {};
    }
  }

  // ───────── Mutationen (Autosave: Journal sofort) ─────────
  _journal(entry) {
    entry.s = ++this.seq;
    entry.t = now();
    fs.appendFileSync(this.file(JOURNAL), JSON.stringify(entry) + '\n');
    this._applyToState(entry);
    this.opsSinceSnapshot++;
    this._scheduleSnapshot();
    return entry;
  }

  put(col, idv, val) { this._journal({ op: 'put', col, id: idv, v: val }); return val; }
  del(col, idv) { this._journal({ op: 'del', col, id: idv }); }
  clear(col) { this._journal({ op: 'clear', col }); }

  patch(col, idv, partial) {
    const cur = this.get(col, idv);
    if (!cur) return null;
    const next = { ...cur, ...partial };
    return this.put(col, idv, next);
  }

  // ───────── Lesen ─────────
  get(col, idv) { return this.state[col]?.[idv] ?? null; }
  all(col) { return Object.values(this.state[col] || {}); }
  count(col) { return Object.keys(this.state[col] || {}).length; }
  collections() { return Object.keys(this.state); }
  find(col, fn) { return this.all(col).filter(fn); }
  one(col, fn) { return this.all(col).find(fn) ?? null; }

  // ───────── Snapshot / Backup ─────────
  _scheduleSnapshot() {
    if (this.opsSinceSnapshot >= this.opts.snapshotMaxOps) { this.snapshot('auto-max-ops'); return; }
    clearTimeout(this._snapTimer);
    this._snapTimer = setTimeout(() => this.snapshot('auto-idle'), this.opts.snapshotIdleMs);
    this._snapTimer.unref?.();
  }

  snapshot(reason = 'manuell') {
    clearTimeout(this._snapTimer);
    const snap = { seq: this.seq, t: now(), at: iso(), reason, state: this.state };
    const raw = JSON.stringify(snap);
    const p = this.file(SNAPSHOT);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, p);                      // atomar: nie halber Snapshot
    fs.writeFileSync(p + '.sha256', sha256(raw) + '  ' + SNAPSHOT + '\n');
    this.snapshotSeq = this.seq;
    this.opsSinceSnapshot = 0;
    this._rotateBackup(raw);
    this._compactJournalIfBig();
    return { seq: this.seq, reason };
  }

  _rotateBackup(raw) {
    const name = `state-${new Date().toISOString().replace(/[:.]/g, '-')}-seq${this.seq}.json`;
    fs.writeFileSync(path.join(this.backupDir, name), raw);
    fs.writeFileSync(path.join(this.backupDir, name + '.sha256'), sha256(raw) + '  ' + name + '\n');
    const list = this.listBackups();
    for (const b of list.slice(this.opts.keepBackups)) {
      try { fs.unlinkSync(path.join(this.backupDir, b.file)); fs.unlinkSync(path.join(this.backupDir, b.file + '.sha256')); } catch { /* weg ist weg */ }
    }
  }

  _compactJournalIfBig() {
    const jp = this.file(JOURNAL);
    try {
      if (fs.existsSync(jp) && fs.statSync(jp).size > this.opts.journalMaxBytes) {
        const archive = path.join(this.backupDir, `journal-${Date.now()}-bis-seq${this.seq}.jsonl`);
        fs.renameSync(jp, archive);
        this.bootReport.push(`Journal kompaktiert → ${path.basename(archive)}`);
      }
    } catch { /* Kompaktierung ist optional */ }
  }

  listBackups() {
    return fs.readdirSync(this.backupDir)
      .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
      .map((f) => {
        const st = fs.statSync(path.join(this.backupDir, f));
        return { file: f, bytes: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  // Kompletter Wiederaufbau nur aus Journal (+ archivierten Journalen)
  rebuildFromJournal() {
    const before = this.integrity();
    this.state = {};
    this.seq = 0; this.snapshotSeq = 0;
    const archived = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('journal-')).sort();
    let n = 0;
    for (const f of archived) {
      for (const line of fs.readFileSync(path.join(this.backupDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); this._applyToState(e); this.seq = Math.max(this.seq, e.s || 0); n++; } catch { /* defekte Zeile */ }
      }
    }
    n += this._replayJournal(0);
    this.snapshot('rebuild-aus-journal');
    return { replayed: n, before, after: this.integrity() };
  }

  restoreBackup(file) {
    const p = path.join(this.backupDir, path.basename(file));
    if (!fs.existsSync(p)) throw new Error(`Backup ${file} existiert nicht`);
    this.snapshot('sicherung-vor-restore');
    const raw = fs.readFileSync(p, 'utf8');
    const snap = JSON.parse(raw);
    if (!snap?.state) throw new Error('Backup-Struktur ungültig');
    this.state = snap.state;
    // seq weiterzählen, damit das Journal monoton bleibt
    this.seq = Math.max(this.seq, snap.seq || 0) + 1;
    this.snapshot(`restore:${path.basename(file)}`);
    return { restored: file, seq: this.seq };
  }

  importState(stateObj) {
    if (!stateObj || typeof stateObj !== 'object') throw new Error('Ungültiger Zustand');
    this.snapshot('sicherung-vor-import');
    this.state = stateObj;
    this.seq += 1;
    this.snapshot('import');
  }

  integrity() {
    const counts = {};
    for (const c of this.collections()) counts[c] = this.count(c);
    let journalBytes = 0;
    try { journalBytes = fs.statSync(this.file(JOURNAL)).size; } catch { /* noch kein Journal */ }
    return {
      seq: this.seq,
      snapshotSeq: this.snapshotSeq,
      pendingOps: this.opsSinceSnapshot,
      journalBytes,
      backups: this.listBackups().length,
      counts,
      bootReport: this.bootReport,
    };
  }
}
