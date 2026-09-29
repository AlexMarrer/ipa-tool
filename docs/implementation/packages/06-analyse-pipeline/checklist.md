# Checkliste Paket 06 – Analyse-Pipeline

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [ ] Pakete 02, 03, 04 und 05 sind im Code vorhanden, und ihre Tests sind grün.
- [ ] Ergebnis von AK-05-09 geprüft. Ist A-01 widerlegt: anhalten und den Benutzer informieren.
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben.

## Implementierung

- [ ] Statusableitung gemäss spec.md §12.1 (AK-06-04, AK-06-09, AK-06-13)
- [ ] Eingabepaket gemäss spec.md §9.6 und §12.2 mit Grössenprüfung und Secret-Prüfung der Notizen (AK-06-09, AK-06-10, AK-06-11)
- [ ] Prompt `prompts/analyze-work.md` (AK-06-17)
- [ ] Schemas `analysis-input`, `analysis-output`, `analysis-record`, `complete`, `skip` und `retry`
- [ ] Validator mit Ajv und den Regeln R-01 bis R-05 sowie R-07 (AK-06-05)
- [ ] Versuchsablage und Ergebnisablage in der Reihenfolge von spec.md §12.3, mit Hooks (AK-06-01, AK-06-06, AK-06-07)
- [ ] Work-Log-Renderer (AK-06-15)
- [ ] Deterministische Verarbeitung von `not_required` (AK-06-12)
- [ ] Warteschlange mit Reihenfolge, Limits, `exhausted` und `blocked` (AK-06-02, AK-06-03, AK-06-04, AK-06-08)
- [ ] Cursor-Regel und Wiederanlauf (AK-06-06, AK-06-07)

## Integration

- [ ] `ipa capture` führt die Warteschlange aus. `--no-analysis` und `--retry` funktionieren, die Exit-Codes sind korrekt (AK-06-01, AK-06-04, AK-06-16)
- [ ] `ipa skip` angebunden (AK-06-13)
- [ ] `ipa note` um die Existenzprüfung von `--ref` und die Secret-Warnung erweitert (AK-06-19, AK-06-20)
- [ ] Lauf mit Arbeitsbereich im Repository, Claude-Arbeitsverzeichnis getrennt (AK-06-21)
- [ ] `ipa status` zeigt `analyses` (AK-06-18)

## Tests

- [ ] Unit-Tests: Validatorregeln positiv und negativ, Status, Cursor, Renderer als Snapshot-Test
- [ ] Integrationstests AK-06-01 bis AK-06-21 mit Fake-CLI grün
- [ ] Suche nach Secret-Marker und ausgeschlossenem Pfad in allen `attempt-*`-Dateien (AK-06-10)
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Manuell nach Freigabe: Live-Analyse eines künstlichen Repositorys, Stichprobe der Belege (Ergebnis notieren)

## Dokumentation und Status

- [ ] README: Analyseablauf, Work-Log, `skip`, `--retry`, `blocked` und `exhausted`
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
