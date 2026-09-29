# Checkliste Paket 03 – Änderungszuordnung

Erst abhaken, wenn die Arbeit umgesetzt und geprüft ist. Hinter jeden Punkt gehört der Nachweis (Test, Befehl oder Datum).

## Voraussetzungen

- [ ] Pakete 01 und 02 sind im Code vorhanden, und ihre Tests sind grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Wirksamer Stand, Kandidatenpfade und voriger Stand gemäss spec.md §11.4 (AK-03-04, AK-03-06)
- [ ] `state_delta` über `git diff --no-index` in `tmp/`, mit Secret-Prüfung (AK-03-04, AK-03-12)
- [ ] Dokumentierte Blobs, Statusänderungen, Zuordnung der Commit-Dateien (AK-03-03, AK-03-05)
- [ ] Relevanz und `analysisRequired` gemäss spec.md §11.3 (AK-03-01, AK-03-02, AK-03-03)
- [ ] Halt-Erkennung und `state.halt` (AK-03-07, AK-03-08, AK-03-09)
- [ ] Testberichte mit `fresh` und Inhaltsprüfung (AK-03-11)

## Integration

- [ ] `ipa capture` nutzt Relevanz und Halt, `unchanged` wird protokolliert (AK-03-01, AK-03-07)
- [ ] `ipa baseline --reason [--force]` angebunden (AK-03-10)
- [ ] `ipa status` zeigt `halt` (AK-03-14)
- [ ] Eigene Ausgaben in einem Arbeitsbereich im Repository ergeben `unchanged` (AK-03-15)

## Tests

- [ ] Szenariotests AK-03-01 bis AK-03-15 grün, jeweils mit Prüfung des Repository-Fingerprints
- [ ] Unit-Tests der Zuordnung mit allen Randfällen aus der Paketspezifikation, Abschnitt 6
- [ ] Byte-Vergleich bestehender Snapshots bei Halt und `baseline` (AK-03-07)
- [ ] Determinismus-Test (AK-03-13)
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün

## Dokumentation und Status

- [ ] README: Zuordnung, Halt, `baseline`, Testberichte
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
