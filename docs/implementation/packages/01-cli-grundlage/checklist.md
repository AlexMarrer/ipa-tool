# Checkliste Paket 01 – CLI-Grundlage

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Hinter den Punkt kommt der Nachweis, zum Beispiel Testname, Befehl oder Datum.

## Voraussetzungen

- [ ] Git-Status und vorhandene Dateien geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Projektgerüst gemäss spec.md §4.1 (AK-01-01, AK-01-14):
  - `package.json` mit bin `ipa`, engines und den Skripten `build`, `typecheck`, `test` und `probe:claude`
  - `tsconfig.json`
  - `.gitignore`
  - Vitest-Konfiguration mit globalem Setup
- [ ] `src/core/`: Datenwurzel, Repository-Auflösung, Registry mit `workspacePath`, Konfiguration mit Standardwerten, Zustand (AK-01-03, AK-01-06, AK-01-07)
- [ ] Arbeitsbereich mit Standardort und `--workspace`, einschliesslich Regeln und `check-ignore`-Hinweis (AK-01-15)
- [ ] Verständliche Fehlermeldung bei nicht beschreibbarer Datenwurzel, ohne stillen Ortswechsel (AK-01-16)
- [ ] Schemaregister und Schemas `config`, `state`, `registry` und `run-record` (AK-01-12)
- [ ] Schreibfunktionen, JSONL und Lock (AK-01-08, AK-01-09)
- [ ] IDs, Zeitfunktionen und `Clock` (AK-01-11)
- [ ] `GitRunner` mit Leseliste, Umgebung und Arbeitsbereichs-Pathspec gemäss spec.md §14.2 (AK-01-10)
- [ ] `IpaError` und Abbildung auf Exit-Codes (AK-01-02, AK-01-04)
- [ ] `scripts/claude-probe.mjs` mit Modus ohne Modellaufruf und Modus `--live` (AK-01-17, AK-01-18)

## Integration

- [ ] `ipa init [--timezone] [--workspace]` ist angebunden und schreibt `runs.jsonl` (AK-01-03 bis AK-01-06, AK-01-15, AK-01-16)
- [ ] `ipa status [--json]` ist angebunden und nur lesend (AK-01-13)
- [ ] Die globalen Optionen `--repo` und `--data-dir` wirken in allen Befehlen (AK-01-07)

## Tests

- [ ] Test-Helfer `git-repo.ts`, `repo-fingerprint.ts` (mit Ausnahme für den Arbeitsbereich) und `workspace.ts` sind vorhanden und werden verwendet
- [ ] Unit-Tests für IDs, Zeit, Schemas, Pfadnormalisierung, Arbeitsbereichsregeln, Exit-Codes und die Auswertung der Vorabprüfung
- [ ] Integrationstests AK-01-02 bis AK-01-17 sind grün
- [ ] `npm run typecheck`, `npm test` und `npm run build` sind grün
- [ ] Manuell: `npm install --global .` und `ipa init` in einer Windows-Konsole geprüft (Datum und Ergebnis notieren)
- [ ] Manuell nach Freigabe: `npm run probe:claude -- --live` ausgeführt, Ergebnis für A-01 bis A-05 und A-08 in spec.md §18 eingetragen (AK-01-18)

## Dokumentation und Status

- [ ] `README.md`: Installation, Speicherort mit Standard und `--workspace`, Fehlermeldung bei nicht beschreibbarem Pfad, `init`, `status`, Vorabprüfung, Grenze „Repository verschoben“
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
