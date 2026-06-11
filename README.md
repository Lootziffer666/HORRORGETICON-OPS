# 👻 Horrorgeticon Ops

**Leitstand für den Wahnsinn vor Ort.** Die komplette Event-Management-Plattform
für die Horrornacht: Crew, Mazes, Live-Tracking, Pausen, Meldungen, Durchsagen,
Chat, Catering-Marken und Fahrgruppen — modular, ausfallsicher, offline-freundlich.

Ausgebaut aus dem Design-Prototyp (`design/`) zur vollständigen Plattform:
ein dependency-freier Node.js-Server, eine PWA im Hearthwork-Design für alle
drei Formfaktoren und eine Kotlin-Multiplatform-Shell für Windows/Android/iOS.

---

## Schnellstart (2 Minuten)

```bash
# Voraussetzung: Node.js ≥ 18 — sonst nichts. Keine npm-Installation nötig.
node server/main.js --demo
# → http://localhost:8787
```

`--demo` lädt einmalig das komplette Horrornacht-Szenario aus den Mockups
(52 Personen, 5 Mazes, laufende Vorfälle, Catering-Historie, Fahrangebote).
Ohne `--demo` startet die Plattform leer für den Echtbetrieb.

**Demo-Zugänge** (PIN-Logins, auch auf dem Login-Screen einblendbar):

| Code      | PIN    | Rolle & Sicht                                  |
| --------- | ------ | ---------------------------------------------- |
| `DR-0001` | `4711` | Management → Desktop-Leitstand (alle Bereiche) |
| `MT-0301` | `1234` | Maze Lead Asylum → Tablet-Split-Ansicht        |
| `LK-0427` | `1234` | Scare Actor → Phone-App (A3 „Zellenblock“)     |
| `SB-0901` | `1234` | Catering → Stations-Modus (Marken entwerten)   |

Tests: `npm test` (89 API-End-to-End-Checks inkl. Crash-Wiederherstellung).

---

## Plattform-Matrix

Eine Codebasis, drei Formfaktoren — die Oberfläche passt sich der Rolle und
dem Gerät an (Layouts aus dem Design-Prototyp):

| Einsatz                  | Gerät             | Weg                                                        |
| ------------------------ | ----------------- | ---------------------------------------------------------- |
| Management-Leitstand     | **Windows**       | KMP-App (`kmp/`, Compose Desktop + Chromium) oder Browser  |
| Management-Leitstand     | **macOS**         | Browser/PWA (Webview) oder KMP-`.dmg`                      |
| Maze Lead / Catering     | **Android/iPad**  | KMP-App (WebView/WKWebView) oder Browser/PWA               |
| Scare Actor              | **Android-Phone** | KMP-`.apk` oder Browser/PWA („Zum Startbildschirm“)        |

Die PWA (`web/`) ist installierbar, cached die App-Shell offline und läuft in
jedem Webview identisch — die KMP-Shell (`kmp/README.md`) liefert das native
Drumherum (Serverwahl, Vollbild, Fehlerbilder, Installer).

---

## Was die Plattform kann

**Leitstand (Management, Desktop)**
Dashboard mit Live-KPIs · Live-Karte (Gelände-Zonen + Maze-Detail) ·
Anwesenheit mit Fremd-Check-in · Teilnehmerverwaltung mit Suche/Status/Historie ·
Maze-Zuteilung per Drag & Drop inkl. Konflikt-Erkennung (offen/doppelt) ·
Pausen-Freigaben mit Springer-Vorschlag · Meldungs-Workflow mit
Ø-Reaktionszeit · Durchsagen mit Lesebestätigungs-Quote · Chat ·
Catering-Kontingente & Stationen · Fahrgruppen-Matching · Zeitplan mit
gestaffeltem Pausenplan · Berichte & Saison-Historie.

**Scare Actor (Phone)**
Check-in/-out · Schichtkarte mit Fortschritt · Schnellaktionen (Pause anfragen,
Getränk anfordern, Warnung melden mit automatischer Position, Maze-Karte mit
Live-Pins & Nachbarn) · Vollbild-Alarm mit Lesebestätigung · Chat ·
Marken-Wallet · Profil mit Verknüpfung & Fahrgemeinschaft.

**Maze Lead (Tablet)**
Split-Ansicht Team + Karte · Mini-KPIs · Pausen-Freigabe (sofort / in 15 min /
ablehnen) · Vorfall übernehmen · „Warnung an Maze“ (Vollbild-Alarm bei allen
Empfängern) · offene Positionen direkt besetzen.

**Catering-Station (Tablet)**
Station übernehmen · QR-Kamera-Scan (BarcodeDetector) oder manuelle
Code-Eingabe · Personen-Panel mit Guthaben · Mengenwahl · Einlösung ·
Tageszähler · Tagesabschluss mit Druckansicht.

### Die wichtigsten Mechaniken im Detail

* **Profil-Verknüpfung (korrektes Tracking):** Scare Actors registrieren sich
  selbst (eigenes Profil + PIN). Das Management erzeugt pro
  Verwaltungs-Datensatz einen Einmal-**Verknüpfungscode**; gibt die Person ihn
  in ihrem Profil ein, wandern Login & Profildaten auf den offiziellen
  Datensatz, das Duplikat verschwindet, laufende Sitzungen ziehen um — ab da
  zählen Check-in, Heartbeat und Positionsdaten auf den richtigen Datensatz.
  Alternativ führt das Management beide Profile per Klick zusammen.
* **Live-Tracking:** Geräte senden alle 25 s einen Heartbeat (inkl. Akkustand).
  Status wird serverseitig abgeleitet (aktiv / Pause / Vorfall / „Verbindung?“
  nach 90 s Funkstille / nicht da) und via SSE an alle Sichten gepusht.
* **Essens- & Getränkemarken:** personengebundene Kontingente; die Wallet zeigt
  einen **rotierenden Einmal-Code** (HMAC, 60-s-Fenster) als echten QR +
  Klartext. Stationen entwerten online; derselbe Code wird an jeder anderen
  Station abgelehnt — Screenshots sind wertlos.
* **Fahrgruppen:** Crew meldet „Ich fahre (n Plätze)“ oder „Ich suche“ mit Ort
  und Zeitfenster. Das Matching (Greedy, Luftlinie + Zeitfenster, max. 25 km
  Umweg) markiert die **beste Option**; ein Klick schickt den Vorschlag als
  **vorgefertigte Nachricht** in einen automatisch erstellten Gruppen-Chat —
  Zu-/Absagen direkt am Gerät, Gruppe wird „fix“, wenn alle zugesagt haben.
* **Unkaputtbarkeit:** Jedes Fachgebiet ist ein eigenes Server-Modul. Der
  Kernel zählt Fehler pro Modul (Circuit-Breaker: 5 Fehler / 5 min → Modul
  automatisch aus, Rest läuft weiter), Module lassen sich zur Laufzeit
  deaktivieren, reaktivieren und nach Dateitausch **hot-reloaden** — ohne
  Neustart. Der Client zeigt für abgeschaltete Module eine Hinweis-Karte statt
  zu brechen.
* **Autosave & Backup-Rebuild:** Jede Änderung landet sofort im
  Append-only-Journal; Snapshots werden atomar geschrieben (SHA-256-geprüft)
  und rotierend gesichert. Beim Start repariert sich die DB selbst
  (Snapshot → Backups → Journal-Replay); Rebuild, Restore und
  Voll-Export/-Import gibt es zusätzlich per Knopfdruck unter *System → Backups*.
* **QoL:** CSV-Im-/Export (Excel-tauglich, Import mit Dry-Run-Vorschau) ·
  manuelle DB-Pflege mit Audit-Trail und Undo · Konsistenz-Prüfung ·
  Dark Mode für den Backstage-Betrieb · Browser-Benachrichtigungen.

---

## Struktur

```
server/            Node.js ≥ 18, null Abhängigkeiten
  kernel/          Modul-Kernel, DB (Journal/Snapshot/Backups), SSE-Bus, Auth, CSV, Geo
  modules/         16 Fachmodule (*.mod.js) — zur Laufzeit schalt- und tauschbar
  seed/            Demo-Szenario „Horrornacht“ (Datenstand der Mockups)
  test/smoke.mjs   89 API-End-to-End-Checks (npm test)
web/               PWA — Hearthwork-Design aus dem Prototyp, kein Build-Schritt
  js/core/         DOM/Store/SSE/API/QR-Encoder (eigener, verifizierter Encoder)
  js/shell/        Desktop- / Tablet- / Station- / Phone-Shell + Login
  js/views/        alle Fachansichten
kmp/               Kotlin-Multiplatform-Shell (Windows · Android · iOS)
docs/              ARCHITEKTUR.md (wie es gebaut ist) · BETRIEB.md (Runbook)
design/            Original-Designprototyp (Zip) als Referenz
tools/             start.sh / start.bat
```

Daten liegen unter `data/` (git-ignoriert): `state.json` + `journal.jsonl` +
`backups/`. Eigener Pfad: `--data /pfad` oder `OPS_DATA=…`, Port: `--port` /
`PORT`.

---

## Betrieb in einer Minute

```bash
node server/main.js                # Produktivstart (leer)
node server/main.js --demo        # mit Demo-Szenario
npm test                           # API-Testlauf
```

Erste Schritte im Echtbetrieb: als Management anmelden → *Personen* anlegen
(oder CSV importieren) → *Mazes & Zuteilung* aufbauen → Verknüpfungscodes
verteilen → Crew registriert sich und verknüpft. Details, Notfall-Rezepte und
Modul-Tausch zur Laufzeit: **`docs/BETRIEB.md`**.
