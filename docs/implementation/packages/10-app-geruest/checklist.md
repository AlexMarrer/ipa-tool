# Checkliste Paket 10 – App-Gerüst

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [ ] Paket 09 im Code vorhanden, `npm run typecheck` und `npm test` im Wurzelordner grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben
- [ ] Versionen festgelegt und in `app/README.md` begründet: Electron (exakt), TypeScript der App (AO-04), `electron-builder` (AO-07)

## Implementierung

- [ ] CLI unberührt, Wurzel-Skripte `app:*`, `.gitignore`, `app/` mit eigenem Lock (AK-10-01, AK-10-02)
- [ ] Hauptfenster und Sicherheitseinstellungen, CSP, Protokoll `app://`, Fuses, eine Instanz (AK-10-03)
- [ ] Preload und IPC mit Prüfung von Absender und Eingabe (AK-10-04)
- [ ] `resolveRuntime` für Entwicklung, Test und installiert (AK-10-05)
- [ ] CLI-Runner mit Hüllenprüfung, Fehlerklassen, Versionsabgleich (AK-10-06)
- [ ] Sperren pro Projekt, fremder Lauf aus `lock` (AK-10-07)
- [ ] Abbruch des Prozessbaums, Wiederanlauf ohne Doppel (AK-10-08)
- [ ] Projektliste aus der Registry, Fehlerfälle (AK-10-09)
- [ ] Layout, Navigation, Tastenkürzel (AK-10-10)
- [ ] Tokens Hell und Dunkel, Theme folgt Windows, Kontrastprüfung (AK-10-11)
- [ ] Basiskomponenten und Zustandsgalerie (AK-10-12)
- [ ] Lade-, Leer- und Fehlerzustände (AK-10-13)
- [ ] `app-state.json` (AK-10-14)
- [ ] Nichts startet Claude von selbst, Aufrufprotokoll (AK-10-15)

## Integration

- [ ] `npm run app:dev`, `app:build`, `app:typecheck`, `app:test` laufen vom Wurzelordner aus
- [ ] `stage-cli` und `fetch-node` laufen und prüfen die Prüfsumme (Vorbereitung für Paket 14)

## Tests

- [ ] Unit- und Komponententests (AK-10-01 bis AK-10-15)
- [ ] Start-Test mit Playwright
- [ ] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün

## Dokumentation und Status

- [ ] `app/README.md` und Hinweis im Wurzel-`README.md` (AK-10-16)
- [ ] Klärungen in `docs/app/spec.md §19` eingetragen
- [ ] `docs/implementation/checklist.md`: Paketstatus aktualisiert
