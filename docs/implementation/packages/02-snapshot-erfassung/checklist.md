# Checkliste Paket 02 – Snapshot-Erfassung

Einen Punkt erst abhaken, wenn die Arbeit umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [ ] Paket 01 ist im Code vorhanden, und seine Tests sind grün.
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben.

## Implementierung

- [ ] `PathFilter` mit picomatch gemäss D-10 und spec.md §14.3 (AK-02-04, AK-02-05, AK-02-17)
- [ ] `SecretScanner` mit allen Detektoren aus spec.md §14.4 (AK-02-06, AK-02-17)
- [ ] Git-Parser mit `-z` für Status, ls-files, name-status, numstat, rev-list und log (AK-02-03, AK-02-13)
- [ ] Blob-IDs über `hash-object --stdin --path` ohne `-w` (AK-02-12)
- [ ] Belege `commit_message`, `commit_diff`, `staged_diff`, `unstaged_diff` sowie `fileStates` mit Kopien (AK-02-01, AK-02-02, AK-02-03)
- [ ] Binärdateien, Grössenlimits, Symlinks und Submodule (AK-02-07, AK-02-08, AK-02-16)
- [ ] Konsistenzprüfung mit Hook `afterFirstPass` (AK-02-09)
- [ ] Atomare Ablage, Wiederanlauf und Hook `beforeStateUpdate` (AK-02-10)
- [ ] `authoredByConfiguredUser` ohne Speicherung von E-Mail-Adressen (AK-02-14)
- [ ] Schema `manifest` gemäss spec.md §9.3 und §9.4

## Integration

- [ ] `ipa init` nimmt den Ausgangs-Snapshot auf und holt ihn bei abgebrochener Initialisierung nach (AK-02-01, AK-02-15)
- [ ] `ipa capture [--no-analysis]` angebunden, mit Lock und `runs.jsonl` (AK-02-02, AK-02-18)
- [ ] `ipa status` zeigt `snapshots` (AK-02-18)

## Tests

- [ ] Unit-Tests für Parser, Filter, Detektoren und Limits
- [ ] Integrationstests AK-02-01 bis AK-02-18 grün, jeweils mit Prüfung des Repository-Fingerprints (AK-02-11)
- [ ] Secret-Marker-Suche über die gesamte Datenwurzel und über stdout und stderr (AK-02-05, AK-02-06)
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Annahme A-06 geprüft und das Ergebnis in spec.md §18 eingetragen

## Dokumentation und Status

- [ ] README: `capture`, Filter, Standard-Ausschlüsse, Grenzen der Secret-Erkennung
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
