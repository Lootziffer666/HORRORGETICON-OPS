# Horrorgeticon Ops — Geräte-Shell (Kotlin Multiplatform)

Native Hülle um die Web-Plattform (`server/` + `web/`): Server-Adresse wählen,
Vollbild-Webview, saubere Fehlerbilder bei Verbindungsverlust. **Die gesamte
Fachlogik lebt auf dem Server** — die Shells müssen bei neuen Features nie
aktualisiert werden.

| Zielgerät              | Technik                                   | Artefakt                  |
| ---------------------- | ----------------------------------------- | ------------------------- |
| Windows (Management)   | Compose Desktop + KCEF (Chromium)         | `.msi` (oder `runDistributable`) |
| macOS                  | Compose Desktop + KCEF **oder** Browser/PWA | `.dmg` / Browser          |
| Android Phone/Tablet   | Compose + Android WebView                 | `.apk` / `.aab`           |
| iPhone/iPad            | Compose + WKWebView                       | Xcode-Projekt             |

> **Alternative ohne App-Build:** Jedes Gerät kann den Leitstand direkt im
> Browser öffnen (`http://<server>:8787`) und über „Zum Startbildschirm
> hinzufügen“ als PWA installieren — gleicher Funktionsumfang inklusive
> Vollbild, Offline-Shell und Benachrichtigungen.

## Voraussetzungen

* JDK 17+
* Android Studio (für Android) bzw. Xcode auf macOS (für iOS)
* Internet beim **ersten** Build (Gradle-Dependencies) und beim ersten
  Desktop-Start (KCEF lädt das Chromium-Bundle ~100 MB in `kcef-bundle/`,
  danach offline lauffähig)

Dieses Repository wird in einer Umgebung ohne Android-SDK gepflegt — die
KMP-Shell wird daher **auf dem Entwicklungsrechner** gebaut. Web-Plattform und
Server sind davon unabhängig sofort lauffähig.

## Bauen & Starten

```bash
cd kmp

# Windows/macOS/Linux-Leitstand direkt starten
./gradlew :composeApp:run

# Windows-Installer (auf einem Windows-Rechner ausführen)
./gradlew :composeApp:packageMsi      # → composeApp/build/compose/binaries/

# Android (Gerät/Emulator verbunden)
./gradlew :composeApp:installDebug
```

**iOS:** `iosApp`-Einbindung wie bei jedem Compose-Multiplatform-Projekt —
in Xcode ein App-Target anlegen, das `ComposeApp.framework` einbettet und
`MainViewController()` als Root setzt. (Apple erlaubt Builds nur auf macOS,
deshalb liegt hier bewusst kein vorgefertigtes `.xcodeproj`.)

## Versionen

Pinned in `gradle/libs.versions.toml` (Kotlin 2.1.0 · Compose Multiplatform
1.7.3 · compose-webview-multiplatform 2.0.1 · AGP 8.7.3). Beim Anheben zuerst
die Kompatibilitätstabelle von
[compose-webview-multiplatform](https://github.com/KevinnZou/compose-webview-multiplatform)
prüfen — die Bibliothek koppelt an die Compose-Version.

## Hinweise für den Eventbetrieb

* Der Ops-Server läuft im Event-LAN über `http://` — Android erlaubt das über
  `usesCleartextTraffic="true"` (gesetzt), iOS ggf. über eine
  ATS-Ausnahme im `Info.plist` (`NSAllowsLocalNetworking`).
* Kamera-Berechtigung (QR-Scan an der Catering-Station) ist im
  Android-Manifest deklariert; der WebView fragt zur Laufzeit nach.
* Schlägt KCEF auf dem Desktop fehl (z. B. kein Netz beim Erststart), bietet
  die App den System-Browser als gleichwertigen Fallback an.
