# Checkliste Paket 01 – CLI-Grundlage

Ein Punkt wird erst abgehakt, wenn die Arbeit umgesetzt und geprüft ist. Hinter den Punkt kommt der Nachweis, zum Beispiel Testname, Befehl oder Datum.

## Voraussetzungen

- [ ] Git-Status und vorhandene Dateien geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Projektgerüst: `package.json` (bin `ipa`, engines, Skripte `build`, `typecheck`, `test`), `tsconfig.json` gemäss spec.md §4.1, `.gitignore`, Vitest-Konfiguration mit globalem Setup (AK-01-01, AK-01-14)
- [ ] `src/core/`: Datenwurzel, Repository-Auflösung, Registry, Arbeitsbereich, Konfiguration mit Standardwerten, Zustand (AK-01-03, AK-01-06, AK-01-07)
- [ ] Schemaregister mit Schemas `config`, `state`, `registry` und `run-record` (AK-01-12)
- [ ] Schreibfunktionen, JSONL und Lock (AK-01-08, AK-01-09)
- [ ] IDs, Zeitfunktionen und `Clock` (AK-01-11)
- [ ] `GitRunner` mit Leseliste und Umgebung gemäss spec.md §14.2 (AK-01-10)
- [ ] `IpaError` und Abbildung auf Exit-Codes (AK-01-02, AK-01-04)

## Integration

- [ ] `ipa init` angebunden, schreibt `runs.jsonl` (AK-01-03, AK-01-04, AK-01-05, AK-01-06)
- [ ] `ipa status [--json]` angebunden, nur lesend (AK-01-13)
- [ ] Globale Optionen `--repo` und `--data-dir` wirken in allen Befehlen (AK-01-07)

## Tests

- [ ] Test-Helfer `git-repo.ts`, `repo-fingerprint.ts` und `workspace.ts` vorhanden und verwendet
- [ ] Unit-Tests für IDs, Zeit, Schemas, Pfadnormalisierung und Exit-Codes
- [ ] Integrationstests AK-01-02 bis AK-01-14 grün
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Manuell: `npm install --global .` und `ipa init` in einer Windows-Konsole geprüft (Datum und Ergebnis)

## Dokumentation und Status

- [ ] `README.md`: Installation, Datenwurzel, `init`, `status`, Grenze „Repository verschoben“
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
