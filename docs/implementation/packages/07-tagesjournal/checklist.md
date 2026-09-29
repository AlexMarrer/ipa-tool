# Checkliste Paket 07 – Tagesjournal

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [ ] Die Pakete 04, 05 und 06 sind im Code vorhanden, ihre Tests sind grün.
- [ ] Der Git-Status ist geprüft, keine fremden Änderungen wurden überschrieben.

## Implementierung

- [ ] Tageszuordnung und `timeSummary` gemäss spec.md §15 (AK-07-02, AK-07-05)
- [ ] Journal-Eingabe gemäss spec.md §9.10, ohne frühere Entwürfe (AK-07-04)
- [ ] `openItems`: Analysestatus, Lücken, Fehlerläufe, Tage ohne Aufnahme (AK-07-06)
- [ ] Prompt `prompts/journal.md` (AK-07-12)
- [ ] Schemas `journal-input`, `journal-output`, `journal-record`
- [ ] Validator für R-01, R-03, R-04, R-06 und R-07 (AK-07-08)
- [ ] Markdown-Renderer mit fester Abschnittsreihenfolge (AK-07-01, AK-07-09, AK-07-10)
- [ ] Modus `--no-ai` und automatischer Rückfall ohne Daten (AK-07-07)
- [ ] Exklusives Schreiben der Entwürfe, kein Zugriff auf `journal/final/` (AK-07-03)

## Integration

- [ ] `ipa journal [--day] [--no-ai]` angebunden, ohne Lock (AK-07-11)

## Tests

- [ ] Unit-Tests: Tageszuordnung, Zeitübersicht, Validator, Renderer als Snapshot-Test
- [ ] Integrationstests AK-07-01 bis AK-07-12 mit Fake-CLI und injizierter Uhr grün
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Manuell nach Freigabe: Live-Journal eines künstlichen Tages, Stichprobe der Belege (Ergebnis notieren)

## Dokumentation und Status

- [ ] README: Tagesabschluss, manuelle Übernahme nach `journal/final/`, Sicherung
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale Checkliste `docs/implementation/checklist.md` aktualisiert
