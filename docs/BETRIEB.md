# Betriebshandbuch (Runbook) — Horrorgeticon Ops

Für die Orga-Crew: alles, was man vor, während und nach der Horrornacht
wirklich braucht. Reihenfolge = Praxis.

---

## 1 · Vor der Saison

```bash
node server/main.js              # leerer Echtbetrieb (Daten in ./data)
```

1. **Erstes Management-Konto:** Beim allerersten Start ohne Demo gibt es noch
   keine Logins. Einmalig anlegen:
   `node server/main.js --demo` auf einem *separaten* Datenpfad benutzen — oder
   schneller: Server starten, dann in einer zweiten Konsole

   ```bash
   node --input-type=module -e "
   const {DB}=await import('./server/kernel/db.js');
   const {hashPin}=await import('./server/kernel/util.js');
   const db=new DB('./data').load();
   db.put('people','p_admin',{id:'p_admin',code:'ADMIN-1',name:'Orga Admin',
     roles:['management'],status:'aktiv',pin:hashPin('GEHEIM'),selfCreated:false,linked:true,
     season:String(new Date().getFullYear()),createdAt:new Date().toISOString()});
   db.snapshot('admin-angelegt');console.log('ok: ADMIN-1 / GEHEIM');"
   ```

   (Server danach neu starten, PIN sofort im Profil ändern.)
2. **Stammdaten:** *Personen* pflegen oder Bestandsliste per **CSV-Import**
   (Vorschau prüfen, dann anwenden). *Mazes & Zuteilung*: Mazes, Positionen,
   Leads. *Einstellungen*: Eventdatum, Schichtfenster, Budgets, eigene Orte.
3. **Verknüpfung ausrollen:** Pro Person *Personen → Öffnen →
   Verknüpfungscode erzeugen* und übergeben (Zettel/Nachricht). Crew installiert
   die App (PWA oder APK), registriert sich, gibt den Code ein. Kontrolle:
   gelbes Panel „Profil-Verknüpfung“ verschwindet, Konto-Spalte zeigt
   „Verknüpft“.

## 2 · Eventtag — Inbetriebnahme

* Server im Event-LAN starten (`tools/start.sh` bzw. `start.bat`), Adresse
  z. B. `http://192.168.31.10:8787` am Crew-Büro aushängen (gern als QR).
* Geräte: Browser/PWA oder KMP-App → Serveradresse eintragen → Login.
* **Event-Phase setzen** (Klick auf die Live-Anzeige in der Topbar):
  `Vorbereitung → Aufbau → Live → Abschluss`. Die Phase steuert, was die Crew
  sieht (Aufbau-Karte vs. Schichtfortschritt vs. Wrap-up); Wechsel auf
  Live/Abschluss sendet automatisch eine Durchsage.
* **Rundgänge anlegen** (*Aufgaben → Checklisten & Rundgänge*): je Maze
  mindestens Sicherheit + Aufbau (Vorlagen mit Pflichtpunkten eingebaut).
  Leads haken auf dem Tablet ab (*Mehr → Rundgänge*); das Dashboard zeigt
  in der Aufbau-Phase „Sind wir bereit?“ — erst wenn alle Pflichtpunkte
  abgehakt sind, steht da überall ✓.
* **Aufbau-Aufgaben dispatchen** (*Aufgaben*): erstellen, an Maze oder Person
  verteilen, Priorität/Frist setzen. Leads nehmen in ihrer Inbox an oder
  delegieren; Blocker brauchen immer eine Begründung und landen im Feed.
* Catering: Stationen unter *Catering* anlegen; Stations-Tablets melden sich
  mit Catering-Konto an und **übernehmen ihre Station**. Kontingente zuweisen
  (*Catering → Kontingent zuweisen*, typ. 3 Getränke / 1 Essen an alle).
* Fahrgruppen für die Anreise: Crew trägt Angebote/Gesuche im Profil ein →
  *Fahrgruppen → Beste Gruppen berechnen* → Vorschläge **senden** (Nachricht
  geht automatisch in den Gruppen-Chat).

## 3 · Während der Nacht

| Situation                          | Griff                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Actor meldet Warnung               | Dashboard „jetzt entscheiden“ → *Übernehmen/Erledigt*; Hoch-Prio alarmiert Leitstand + Lead als Vollbild |
| Pause angefragt                    | Lead-Tablet oder *Pausen*: Freigeben / In 15 min / Ablehnen — Springer-Hinweis erscheint automatisch |
| Position unbesetzt                 | Lead: „Besetzen“ auf der Lage-Ansicht · Leitstand: *Mazes & Zuteilung* |
| Durchsage an alle / eine Maze      | Topbar **Durchsage** (Vorlagen!); Stufe *Notfall* = Vollbild-Alarm mit Lesebestätigungs-Quote |
| Handy vergessen/leer               | *Anwesenheit* → Person → **Einchecken** (Fremd-Check-in)               |
| „Verbindung?“-Status               | Gerät hat 90 s nichts gesendet — Akku/WLAN prüfen, Tracking läuft sonst weiter |
| Marken-Code abgelehnt              | Gewollt (Einmal-Code). Person zeigt frischen Code (erneuert sich alle 60 s) |
| Jemand kommt zu spät               | Person meldet selbst „Ich verspäte mich“ (mit ETA) — Badge erscheint bei Lead + Anwesenheit |
| Meldung bleibt liegen              | Rote **SLA-Badge** (hoch 5 / mittel 15 / niedrig 45 min bis zur Reaktion) — zuweisen oder übernehmen |
| Wichtige Ad-hoc-Entscheidung       | *Durchsagen* → Entscheidungslog-Zeile („📌 Notieren“) — landet im Feed und im Übergabeprotokoll |
| Aufgabe hängt                      | Karte auf dem *Aufgaben*-Board öffnen → neu zuweisen; Blocker-Begründung steht direkt dran |
| Schichtwechsel beim Lead           | Tablet *Mehr → Übergabe & Nachbericht* → durchgehen, drucken, fertig    |

## 4 · Wenn etwas klemmt (Unkaputtbarkeits-Rezepte)

**Ein Bereich spinnt, Rest soll weiterlaufen:**
*System → Module* → Modul **deaktivieren**. Clients zeigen dort eine
Hinweis-Karte, alles andere bleibt voll nutzbar.

**Modul reparieren/austauschen ohne Neustart:**
korrigierte Datei nach `server/modules/<name>.mod.js` kopieren →
*Module → Neu laden*. Bei Ladefehler bleibt das Modul aus (Fehlertext steht
auf der Karte), alte Datei zurückkopieren → erneut laden.

**Modul schaltet sich selbst ab:** Circuit-Breaker hat 5 Fehler/5 min gesehen.
Fehlertext auf der Modul-Karte lesen → Ursache beheben → **Aktivieren**.

**Daten versehentlich kaputtgepflegt:**
*System → Datenbank → Letzte Änderung zurück* (Undo, mehrfach). Größeres:
*System → Backups → Wiederherstellen* (aktueller Stand wird vorher
automatisch gesichert).

**Server-Rechner stirbt:** Datenordner `data/` auf Ersatzrechner kopieren
(läuft auch von USB), `node server/main.js --data /pfad/zu/data`. Beim Start
repariert sich die DB selbst (Boot-Report unter *Backups* lesen). Notfalls
*Rebuild aus Journal*.

**Komplettumzug/Archiv:** *Backups → Voll-Export* (eine JSON-Datei) —
einspielbar über *Voll-Import* (mit Vorschau + Vorab-Sicherung).

## 5 · Nach der Nacht

0. **Phase auf „Abschluss“** stellen — Actors bekommen die Wrap-up-Karte
   (Fundsachen, Fahrgruppen, Check-out), Abschluss-Aufgaben rücken nach vorn.
1. Catering-Stationen: **Tagesabschluss** (Druckansicht für die Abrechnung).
2. *Berichte*: Anwesenheit, Ø-Reaktionszeit, Verbrauch, Fahrgruppen-Quote —
   CSV-Exporte für die Nachbesprechung.
3. *Backups → Voll-Export* als Saison-Archiv ablegen.
4. Personen auf `ausgeschieden`/`archiviert` setzen, wo nötig — die
   Saison-Historie bleibt erhalten („Erfahrung soll sich summieren“).

## 6 · Update einspielen

```bash
git pull                      # oder neuen Stand entpacken
# Server kurz durchstarten — Daten bleiben (data/ wird nie angefasst)
```

Einzelne Modul-Fixes gehen auch ganz ohne Neustart (siehe Hot-Swap oben).

## 7 · Diagnose-Endpunkte

| Endpunkt              | Zweck                                            |
| --------------------- | ------------------------------------------------ |
| `GET /api/health`     | Uptime, verbundene Geräte, DB-Zähler, Modul-Status |
| `GET /api/db/validate`| Konsistenz (verwaiste Zuteilungen, doppelte Codes …) |
| `npm test`            | kompletter API-Selbsttest auf Wegwerf-Daten      |
