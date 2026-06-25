# Start-Anleitung — Horrorgeticon Ops

Für Nicht-Techniker geschrieben. Kein Installieren, kein Vorwissen nötig.

---

## Was du brauchst

- **Einen Windows-Rechner** als Leitstand (Notebook reicht).
- **Ein WLAN**, in dem alle Geräte hängen. Entweder das vorhandene, oder
  du **bringst dein eigenes mit** (Reise-Router / Access Point) — siehe
  „Netz-in-a-Box". Internet ist **nicht** nötig.
- Die Handys/Tablets der Crew.

---

## 1) Leitstand starten (Windows)

1. Das Paket **`Horrorgeticon-Leitstand-windows-x64.zip`** von der
   [Releases-Seite](../../releases) herunterladen.
2. Rechtsklick → **„Alle extrahieren"**. Den entpackten Ordner z. B. auf den
   Desktop legen.
3. Im Ordner **Doppelklick auf `Leitstand starten.cmd`**.
   - Ein schwarzes Fenster öffnet sich — **das ist der Server, offen lassen.**
   - Der Browser öffnet sich automatisch mit dem Leitstand.
4. Anmelden. (Zum Ausprobieren: im Anmeldefenster „Demo-Zugänge anzeigen".)

> Kein „npm", kein Setup. Die Node-Runtime ist im Paket enthalten.

---

## 2) Crew verbindet sich (per QR)

1. Alle Handys/Tablets ins **selbe WLAN** wie den Leitstand-Rechner bringen.
2. Im Leitstand-Anmeldebildschirm **„Crew per QR verbinden"** aufklappen und
   auf dem Bildschirm/Beamer zeigen.
3. Die Crew **scannt den QR-Code** oder tippt die angezeigte Adresse
   (z. B. `http://192.168.1.50:8787`) in ihren Browser.
4. Tipp: im Browser „Zum Startbildschirm hinzufügen" → fühlt sich an wie eine App.

---

## 3) Netz-in-a-Box (ohne Internet, ohne fremdes WLAN)

Das System **bringt sein eigenes Netz mit** — unabhängig von Veranstalter
oder Internet:

- **Variante A (empfohlen):** eigenen WLAN-Router / Access Point mitbringen.
  Leitstand-Rechner per Kabel oder WLAN dranhängen, Crew verbindet sich mit
  dem gleichen WLAN. Fertig.
- **Variante B (ganz ohne Extra-Gerät):** den **Windows-Hotspot** des
  Notebooks nutzen (Einstellungen → Netzwerk und Internet → Mobiler Hotspot).
  Die Crew tritt diesem Hotspot bei. Das Notebook ist dann Server **und**
  WLAN zugleich.

**Ausfallsicher:** Router/AP an eine **Powerbank/USV** hängen → läuft bei
kurzem Stromausfall weiter. Optional ein **zweiter AP** als Reserve.

---

## 4) Wenn das Netz wackelt

- Bricht die Verbindung kurz ab, **arbeiten die Geräte weiter** und holen den
  Stand nach, sobald die Verbindung zurück ist.
- Fällt der Leitstand-Rechner aus: neu starten — die Daten sind gespeichert
  (siehe „Sichern").

---

## 5) Für den Pitch / die Vorführung

- Doppelklick auf **`Demo starten.cmd`** → startet ein fertiges Demo-Szenario
  mit eigenen Demo-Daten (vermischt sich nicht mit echten Event-Daten).
- **Mic-Drop-Moment:** Während alles läuft, das Netzwerkkabel ziehen bzw. das
  Internet trennen — der Leitstand und die Phones **laufen weiter**. Das ist
  der Beweis für „läuft, egal was kommt".

---

## 6) Daten sichern & zurücksetzen

- Echte Daten liegen im Unterordner **`data`**, Demo-Daten in **`demo-data`**.
- **Sichern:** den Ordner einfach kopieren.
- **Zurücksetzen:** den Ordner schließen (Server-Fenster zu) und den
  `data`-Ordner umbenennen/löschen → beim nächsten Start ist alles frisch.

---

## 7) Crew-Tablets per App (optional)

Statt Browser kann auf Android auch die **APK**
(`Horrorgeticon-Ops-android.apk` von der Releases-Seite) installiert werden
(Sideload). Sie zeigt denselben Leitstand, nur als App-Icon. iPhones nutzen
einfach den Browser („Zum Startbildschirm hinzufügen").

---

## Hilfe in 10 Sekunden

| Problem | Lösung |
|---|---|
| Browser öffnet nicht | Im schwarzen Fenster steht die Adresse — manuell im Browser eingeben. |
| Crew kommt nicht rein | Sind alle im **selben WLAN**? Adresse/QR erneut prüfen. |
| Irgendwas hängt | Schwarzes Fenster schließen, `Leitstand starten.cmd` erneut doppelklicken. |
| Frisch anfangen | `data`-Ordner umbenennen/löschen, neu starten. |
