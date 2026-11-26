# Checkliste Paket 11 – App Lesen

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`. Prüfdatum, wo nicht anders genannt: 26.11.2026, Windows 11, Node.js 24.20.0, Git 2.52, Electron 45.5.0.

## Voraussetzungen

- [x] Paket 10 im Code vorhanden, seine Tests grün (Commit `7a74fd1`, 264 Tests und 7 Start-Tests vor Beginn)
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben (Arbeit auf `feature/app-paket-10-geruest`; Paket 10 vorher committet, Paket 11 noch nicht)
- [x] Fixtures aus dem echten CLI mit Fake-CLI für alle Status, Halt, Lücken, Tageszuordnung, zurückgehaltene Notizen, Journale. `test/helpers/rich-workspace.ts`; verteilt auf mehrere Arbeitsbereiche, weil ein erschöpfter oder blockierter Snapshot die Warteschlange anhält (`docs/app/spec.md §19`)

## Implementierung

- [x] Reader mit Schemaprüfung und tolerantem JSONL, Beobachtung (AK-10-17, AK-10-34). `test/reader/workspace.test.ts` (beschädigte, neuere und fehlende Dateien, defekte Zeilen), `test/unit/watcher.test.ts`, Start-Test `reading.e2e.ts`
- [x] Ableitung Analyse-Status gleich `status --json` (AK-10-18). `workspace.test.ts`: Zähler, offene IDs und zurückgehaltene Notizen gleich `status --json` für die Arbeitsbereiche mit complete, exhausted, skipped, pending, not_required, failed und blocked; Widerspruch wird als „Analyse-Stand uneinheitlich“ gemeldet
- [x] Tage, Zeitzone, Tageszuordnung, Sortierung (AK-10-19). `workspace.test.ts` (unklarer Zeitraum über zwei Tage, Zukunft, Wochentag, Sortierung), `misc.test.ts` (Tag in der Zeitzone des Projekts). Sommer- und Winterzeit und eine abweichende Systemzeitzone sind nur über `todayIn`/`dayOfTimestamp` abgedeckt, nicht mit einer Fixture über die Zeitumstellung
- [x] Tageskopf und Kalender (AK-10-20). `pages.test.tsx` (Pfeile, Heute, Zeitzone, Kalender mit Markierungen, Esc, Zukunft)
- [x] Tageszusammenfassung ohne Gesamtsumme (AK-10-21). `workspace.test.ts`, `pages.test.tsx` (Text der ganzen Seite ohne Summe), Start-Test
- [x] Zeitstrahl (AK-10-22). `pages.test.tsx` (alle Eintragsarten, Aufklappen per Maus und Tastatur, unauffällige Läufe ein- und ausblenden)
- [x] Hinweise und Lücken (AK-10-23). `workspace.test.ts`, `pages.test.tsx`
- [x] Tabs, Zähler, Tageszustände (AK-10-24). `pages.test.tsx` (Tabs mit Zählern, leerer Tag, Zukunft, Ladefehler, Fehlerrand), Skelett nach 150 ms (`components.test.tsx`)
- [x] Work-Logs (AK-10-25). `pages.test.tsx`, `workspace.test.ts` (Ersatzansicht, Ausgangslage, blocked), Start-Test. „Datei öffnen“ und „Ordner zeigen“ öffnen über Art und ID; die App öffnet im Test nichts wirklich
- [x] Notizenliste (AK-10-26). `pages.test.tsx`, `workspace.test.ts` (alle Felder, zurückgehalten ohne Wert, beschädigte Zeilen)
- [x] Journal lesen (AK-10-27). `pages.test.tsx`, `workspace.test.ts` (13 Abschnitte in fester Reihenfolge), Start-Test. `journal/final` wird nie angelegt oder gelesen
- [x] Markdown sicher (AK-10-28). `markdown.test.tsx` (feindliches Dokument mit Skript, Bild mit `onerror`, Iframe, Kommentar, `javascript:`, `file:`, `data:`; Bestätigung vor jedem Link), `ipc.test.ts` (nur `http` und `https`)
- [x] Markdown-Darstellung (AK-10-29). `markdown.test.tsx`, `markdown-real.test.tsx` (reale Work-Logs und Journale aus dem CLI ohne Verlust von Text). Sichtprüfung gegen die Artboards steht aus (AK-10-80)
- [x] Referenz-Chips und KI-Etiketten (AK-10-30). `markdown.test.tsx`, `markdown-real.test.tsx` (KI und ohne KI, Zeilenetiketten, unbekannte Überschriften ohne Etikett, Chips nie in Code), Start-Test (Sprung von einem Journal-Chip zur Notiz)
- [x] Projektübersicht (AK-10-31). `pages.test.tsx`, Start-Test
- [x] Halt-Banner (AK-10-32). `pages.test.tsx` (alle drei Gründe mit erwartetem und beobachtetem Stand, Lauf und Zeit), `workspace.test.ts` (echter Halt `branch_changed` und `history_rewritten`, `head_missing` von Hand), Warnpunkt am Kalendertag. Die Schaltfläche „Neuen Ausgangspunkt setzen“ gehört zu Paket 12 (§19)
- [x] Statuspunkt und Kurzhinweis (AK-10-33). `registry.test.ts`, `shell.test.tsx`, Start-Test

## Integration

- [x] Alle Ansichten sind über Navigation, Seitenleiste und Referenz-Chips erreichbar. `pages.test.tsx`, Start-Test `reading.e2e.ts`
- [x] Lesen verändert nichts, Fingerprints unverändert (AK-10-35). `workspace.test.ts` (Arbeitsbereich und Repository nach allen Leseaufrufen), Start-Test (nach Navigation durch alle Ansichten)

## Tests

- [x] Reader-, Komponenten- und Markdown-Tests (AK-10-17 bis AK-10-35). `npm run app:test`: 25 Dateien, 360 Tests bestanden; Start-Tests mit Playwright: 12 bestanden (7 aus Paket 10, 5 neue in `reading.e2e.ts`)
- [x] Zustandsgalerie: Halt (alle Gründe), Claude-Warnung, Tageszusammenfassung, Hinweise, Zeitstrahl, Kalender, Markdown (Work-Log mit KI, Journal ohne KI) in Hell und Dunkel (`gallery.test.tsx`). Die Galerie zeigt nicht jeden einzelnen Artboard-Zustand von Anhang A (zum Beispiel nicht den Leerzustand jedes Tabs); diese Zustände decken die Seitentests ab
- [x] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert (dieselben zwei umgebungsbedingten Fehlschläge wie vor Paket 10, Wurzel-`typecheck` und `build` grün)
- [x] Messung der Dateibeobachtung unter Windows, Ergebnis in `app/spec.md §18` (AO-12): 1,2 bis 1,7 s von der Konsole bis zur Anzeige

## Dokumentation und Status

- [x] `app/README.md` ergänzt (Stand, Aufbau, `react-markdown`, Grenzen)
- [x] Klärungen in `docs/app/spec.md §19` eingetragen (Fixtures, zurückgehaltene Notizen, `shell.copyPath`, Kalender und Panel, fehlende Aktionen, zwei gefundene Fehler, Abhängigkeiten)
- [x] `docs/implementation/checklist.md`: Paketstatus aktualisiert

## Offen für den Benutzer

- Sichtprüfung der Seiten gegen die Artboards `Main`, `Tagesansicht-Kalender`, `WorkLog*`, `Notizen*`, `Journal*`, `Uebersicht*` und `Halt-*` in Hell und Dunkel und Bedienung per Tastatur (AK-10-80, manuell).
- Entscheidung zu AO-16: Texte und Abweichungen aus `docs/app/spec.md §13` ins Design zurückgeben.
