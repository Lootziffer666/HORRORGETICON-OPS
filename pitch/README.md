# 🩸 Pitch-Paket — Horrorgeticon Ops, Saison 2026

Alles, was für den Pitch gebraucht wird, in einem Ordner. Jede Datei funktioniert
für sich allein (keine Abhängigkeiten untereinander, keine Installation).

| Datei | Was es ist | Wie verwenden |
| --- | --- | --- |
| `Horrorgeticon_Ops_Pitchdeck.html` | **Das Deck.** 18 Slides, alle Screenshots eingebettet, eine einzige Datei. | Im Browser öffnen. Pfeiltasten/Klick/Wischen zum Blättern, `P` druckt alle Slides (→ PDF-Export). Läuft offline, auch am Handy. |
| `Horrorgeticon_Ops_Pitchdeck.pptx` | Dasselbe Deck als PowerPoint — falls das Gegenüber lieber `.pptx` bekommt oder du live etwas ändern willst. | In PowerPoint/Keynote/LibreOffice öffnen. |
| `Kostenaufstellung.html` | **Gesondertes Kostenblatt:** Positionen, Marktpreise vs. Freundschaftspreis (13.300 € → 3.400 €), Konditionen, Backfisch-Garantie. | Im Browser öffnen; drucken ergibt ein sauberes A4-Blatt. |
| `Anschreiben.md` | E-Mail-Vorlage (Bezug auf den WhatsApp-Austausch), kurze WhatsApp-Variante und ein Spickzettel für den Demo-Termin. | `[Name]`-Platzhalter ersetzen, kopieren, senden. |
| `screenshots/` | Die 11 Original-Screenshots aus der laufenden Demo (2×-Auflösung). | Für Social Media, Folien-Updates oder eigene Dokumente. |

## Screenshots neu erzeugen

Die Screenshots stammen aus dem echten Demo-Szenario:

```bash
node server/main.js --demo   # Server starten
# dann die Views besuchen (Logins: siehe Haupt-README) und Screenshots ziehen
```

## Zahlen im Deck

- „307 automatische Tests“ = 241 API-Checks (`npm test`) + 66 Browser-E2E-Checks (`server/test/ui.e2e.mjs`).
- „120+ Crew · 5 Mazes“ = Umfang des Demo-Szenarios (`server/seed/`).
- Preise: siehe `Kostenaufstellung.html` — Deck (Slide 17) und Kostenblatt sind synchron;
  wer die Zahlen ändert, ändert sie bitte an beiden Stellen.
- Load-Test: 150+ gleichzeitige SSE-Verbindungen stabil (siehe `server/test/load.mjs`).
