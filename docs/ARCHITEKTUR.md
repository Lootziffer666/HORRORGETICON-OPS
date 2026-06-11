# Architektur — Horrorgeticon Ops

## Leitidee

> Klein anfangen, aber richtig anfangen. (Pitch)

Eine zentrale Datenbasis, ein Server, eine Web-Oberfläche — und drumherum
austauschbare Module. Geräte sind dünne Schalen (Browser/PWA oder
KMP-Webview); **die Fachlogik lebt vollständig auf dem Server**, damit jede
Korrektur sofort auf allen Geräten gilt, ohne App-Updates in der Eventnacht.

```
┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
│ Windows    │  │ Tablet     │  │ Tablet     │  │ Android    │
│ Leitstand  │  │ Maze Lead  │  │ Catering   │  │ Scare Actor│
│ (KMP/KCEF) │  │ (KMP/WebV.)│  │ (KMP/WebV.)│  │ (KMP/PWA)  │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      └───────────────┴───────┬───────┴───────────────┘
                       HTTP + SSE (Event-LAN)
                  ┌───────────▼───────────┐
                  │  server/main.js       │
                  │  ┌─────────────────┐  │
                  │  │ Kernel          │  │  Router · Auth · SSE-Bus
                  │  │  ├ auth         │  │  Circuit-Breaker je Modul
                  │  │  ├ people       │  │  Hot-Reload (Datei tauschen)
                  │  │  ├ mazes        │  │
                  │  │  ├ live  …16…   │  │
                  │  └─────────────────┘  │
                  │  DB: Journal+Snapshot │
                  └───────────────────────┘
```

## Modul-Kernel („praktisch unkaputtbar“)

* Jedes Fachgebiet ist eine Datei `server/modules/<name>.mod.js` mit
  `{ name, title, version, init(ctx), routes(r, ctx) }`.
* Der Kernel **wrappt jeden Handler**: Unerwartete Fehler werden gezählt
  (Fenster 5 min). Ab **5 Fehlern → automatische Deaktivierung** des Moduls;
  alle anderen Module laufen unbeeinflusst weiter. Fachliche Fehler
  (Validierung, 4xx) zählen nicht.
* Deaktivierte Module antworten mit `503 { moduleDisabled: true }` — der
  Client rendert eine Hinweis-Karte statt zu brechen.
* **Hot-Swap:** Moduldatei auf der Platte austauschen → *System → Module →
  Neu laden*. Der Kernel importiert die Datei mit Cache-Buster neu und ersetzt
  die Routen im laufenden Betrieb. Lädt die neue Datei nicht (Syntaxfehler),
  bleibt das Modul aus und der Rest läuft — der alte Stand kann zurückkopiert
  und erneut geladen werden.
* Die Modul-Verwaltung selbst (`/api/modules…`, `/api/health`, `/api/stream`)
  liegt **im Kernel, nicht in einem Modul** — sie ist immer erreichbar.

## Datenhaltung (Autosave · Backups · Rebuild)

Bewusst ohne externe Datenbank: ein Prozess, ein Datenordner, kopierbar per
USB-Stick — auf einem Acker mit Generatorstrom ist das ein Feature.

1. **Journal (`data/journal.jsonl`)** — jede Mutation wird *sofort* als
   JSON-Zeile angehängt (Autosave). Abgerissene Zeilen (Stromausfall) werden
   beim Replay erkannt und übersprungen.
2. **Snapshot (`data/state.json`)** — verzögert (1,5 s Ruhe oder alle 400 Ops)
   atomar geschrieben (`tmp` → `rename`) mit SHA-256-Sidecar.
3. **Backups (`data/backups/`)** — jeder Snapshot wird rotierend gesichert
   (24 Stück), große Journale werden dorthin archiviert.
4. **Selbstheilung beim Start:** Snapshot prüfen (Checksumme) → wenn defekt,
   Backups vom neuesten zum ältesten → Journal-Replay obendrauf. Im schlimmsten
   Fall wird der Zustand **komplett aus den Journalen** aufgebaut. Der
   Boot-Report (sichtbar unter *System → Backups*) dokumentiert jeden Schritt.
5. **Manuell:** Backup jetzt · Restore (mit Vorab-Sicherung) · Rebuild aus
   Journal · Voll-Export/-Import als JSON.

Collections (u. a.): `people, sessions, linkCodes, mazes, positions, zones,
presence, breaks, incidents, announcements, announceReads, channels, messages,
chatReads, wallets, usedCodes, redemptions, rejections, stations,
carpoolOffers, carpoolRequests, carpoolGroups, shifts, settings, orte, feed,
audit, modules`.

## Echtzeit

Ein SSE-Stream (`GET /api/stream?token=…`) pro Gerät. Der Bus filtert
empfängerbezogen (DMs, Maze-Warnungen) über Audience-Funktionen. Clients
re-connecten mit Backoff; ein 30-s-Tick hält Presence-Ableitungen frisch.
SSE statt WebSocket: läuft durch jeden Proxy/Webview, re-connect ist trivial —
Schreiben geht ohnehin über POST.

## Sicherheit & Rollen

* Login: Personal-Code + PIN (scrypt-gehasht, nie im Klartext, nie in
  API-Antworten). Sessions 18 h, Bearer-Token.
* Rollen: `management · lead · actor · springer · catering`; eine Person kann
  mehrere haben (Rollenwahl nach Login). `management` übersteuert alles.
* Geschützte Collections (`sessions`, `usedCodes`) sind in der DB-Pflege
  nur lesbar; PIN-Hashes werden im Editor maskiert und beim Speichern bewahrt.
* Jeder manuelle DB-Eingriff erzeugt einen Audit-Eintrag (mit Vorzustand →
  Undo).

## Profil-Verknüpfung (korrektes Tracking)

```
Verwaltung legt Datensatz an          Person registriert sich selbst
        │                                       │
        │  POST /api/people/:id/linkcode        │  POST /api/auth/register
        ▼                                       ▼
   Einmal-Code „XXXX-XXXX“  ──Zettel/Chat──►  Profil → „Verknüpfungscode eingeben“
                                                │  POST /api/auth/link
                                                ▼
                >>> Merge: PIN/Kontakt/Ort → Verwaltungs-Datensatz,
                    Sessions umgehängt, Duplikat gelöscht, linked=true <<<
```

Alternativ: *Personen → Profil-Verknüpfung → Zusammenführen* (Management wählt
Selbst-Profil + Ziel-Datensatz). Unverknüpfte Profile sind überall sichtbar
markiert, denn ihr Tracking zählt nicht auf den Dienstplan.

## Catering-Einmal-Codes

`Code = base32(HMAC-SHA256(secret + personId, slot))[0..8]` mit
`slot = ⌊t/60 s⌋`. Wallet zeigt QR (`HGO1|personId|slot|code`) + 4-Zeichen-
Kurzcode; Station akzeptiert aktuellen und vorherigen Slot, `usedCodes`
verhindert Wiederverwendung (`personId:slot`). Abgelehnte Versuche werden
gezählt und im Leitstand angezeigt. Der QR-Encoder im Client ist eigener Code
(Byte-Modus, ECC M, v1–5, Maskenwahl per Penalty) und gegen einen
Referenz-Decoder verifiziert.

## Fahrgruppen-Matching

Greedy mit Prioritäten: unflexibelste Gesuche zuerst; je Gesuch der Fahrer mit
minimalen Kosten `Luftlinie(km) + Zeitversatz/10`, harte Grenzen: freie Plätze,
Zeitfenster (Toleranz Fahrer + Flex Mitfahrer), max. 25 km, Richtungs-Match.
Gruppen nach Auslastung/Umweg sortiert, Platz 1 = „Beste Option“. *Senden*
erzeugt Kanal + vorgefertigte Nachricht (3 Vorlagen, überschreibbar);
Antworten setzen den Gruppenstatus (`vorschlag → angefragt → fix/aufgelöst`).
Koordinaten kommen aus der Ortsliste (eingebaute Region + eigene Orte unter
*Einstellungen*).

## Web-Client

Kein Build-Schritt, keine Abhängigkeiten: ES-Module + ein 60-Zeilen-DOM-Helfer.
Design 1:1 aus dem Prototyp (Hearthwork-Tokens + ops.css), erweitert um
Interaktion/Responsive (`app.css`). Drei Shells (Desktop-Sidebar ·
Tablet-Split · Phone-Bottom-Nav) teilen sich alle Fach-Views; jede View hängt
an SSE-Topics und lädt gezielt nach. Fehler einer View landen in einer
Fallback-Karte („Modul deaktiviert“ / „Erneut versuchen“) — nie im weißen
Bildschirm. PWA: Manifest + Service Worker (App-Shell offline, API nie
gecacht).

## Abgleich mit horrops_fullstack.md (Must-Have-Spezifikation)

Die Spezifikation `docs/horrops_fullstack.md` beschreibt Rollen-/Phasen-
Must-Haves als Kotlin-State-Machines. Die State-Machine-Architektur wird
bewusst **nicht** clientseitig nachgebaut — der Server ist die einzige
Zustandsquelle, alle Geräte folgen via SSE. Übernommen sind die Konzepte:

| Spez-Konzept                          | Umsetzung                                            |
| ------------------------------------- | ---------------------------------------------------- |
| EventLifecycle (DRAFT…POST_EVENT)      | `settings.phase` + `POST /api/settings/phase` (Modul settings), phasenbewusste UIs |
| Task-/Dispatch-System                  | Modul `tasks` (Board, Inbox, Delegation, Blocker, Verlauf) |
| ChecklistRunner („Sind wir bereit?“)   | Modul `checklists` (Vorlagen, Pflichtpunkte, Readiness) |
| ActorStatusPanel (READY/IN_MASK/…)     | `presence.actorStatus` + Status-Chips, `POST /api/live/status` |
| „Verspätung melden“                    | `POST /api/live/late` (auch vor Check-in), Feed + Badges |
| Incident-SLA                           | Zielzeiten je Prio (settings.sla), `overdue`/`slaLeftMin` |
| DecisionLog                            | `POST /api/feed/decision`, Filter `?kind=entscheidung` |
| HandoverSummary (Supervisor)           | `GET /api/reports/handover?maze=` + druckbare Lead-Ansicht |
| Cue-System / Broadcasts mit Pflicht-Ack | bereits vorhanden (Durchsagen + Vollbild-Alarm + Lesebestätigung) |
| Supervisor ≙ Maze Lead · Leitstand ≙ Management | Rollenmodell unverändert |

Bewusst offen (späterer Happen): Catering-Ausbau (auf Wunsch zurückgestellt),
Master-Timeline-Versionierung, Dokumenten-Hub, Notification-Regeln/DND.

## Tests

* `server/test/smoke.mjs` — 125 Checks gegen den echten Server: alle
  Workflows (inkl. Phasen, Aufgaben, Checklisten, Actor-Status, SLA,
  Entscheidungslog, Übergabe), Doppel-Einlösung, Modul-Breaker/Hot-Reload,
  CSV-Roundtrip, Backup-Restore, Rebuild, Start mit zerstörtem Snapshot.
* `server/test/ui.e2e.mjs` — 47 Browser-Checks (Playwright, optional):
  Login aller vier Rollen, alle Leitstand-Views, Phasen-Sheet,
  Aufgaben-Board & Lead-Inbox, Rundgang-Abhaken bis „bereit ✓“,
  Echtzeit-Alarm Lead→Actor→Leitstand, Wallet-Code → Stations-Einlösung,
  Chat in Echtzeit — 0 JS-Fehler in allen Shells.
