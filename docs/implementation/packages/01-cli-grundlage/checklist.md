# Checkliste Paket 01 – CLI-Grundlage

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Hinter den Punkt kommt der Nachweis, zum Beispiel Testname, Befehl oder Datum.

## Voraussetzungen

- [x] Git-Status und vorhandene Dateien geprüft, keine fremden Änderungen überschrieben. Nachweis: 29.09.2026, `git status` sauber auf `main` (Commits `2c3b8a5`, `308ffda`), kein Anwendungscode vorhanden; Node.js 24.19.0, Git 2.51.0. Geändert wurden nur `docs/implementation/checklist.md`, `spec.md` und die Dateien dieses Pakets.

## Implementierung

- [x] Projektgerüst gemäss spec.md §4.1 (AK-01-01, AK-01-14). Nachweis: `npm ci`, `npm run build`, `npm run typecheck` fehlerfrei am 29.09.2026; `dist/cli.js` vorhanden; `tsconfig.json` mit `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `NodeNext`, `ES2023`, `outDir: dist`; Abhängigkeiten nur `commander`, `ajv` (Laufzeit) sowie `typescript`, `vitest`, `@types/node` (Entwicklung).
  - `package.json` mit bin `ipa`, engines und den Skripten `build`, `typecheck`, `test` und `probe:claude`
  - `tsconfig.json` (dazu `tsconfig.build.json` für den Build)
  - `.gitignore`
  - Vitest-Konfiguration mit globalem Setup (`vitest.config.ts`, `test/setup/global-setup.ts`, `test/setup/test-env.ts`)
- [x] `src/core/`: Datenwurzel, Repository-Auflösung, Registry mit `workspacePath`, Konfiguration mit Standardwerten, Zustand (AK-01-03, AK-01-06, AK-01-07). Nachweis: `test/core/data-root.test.ts`, `context.test.ts`, `registry.test.ts`, `config.test.ts` („schreibt genau die Standardwerte aus §7.1“), `test/cli/init.test.ts`, `test/cli/status.test.ts`.
- [x] Arbeitsbereich mit Standardort und `--workspace`, einschliesslich Regeln und `check-ignore`-Hinweis (AK-01-15). Nachweis: `test/core/workspace.test.ts`; `test/cli/init.test.ts` › „mit --workspace (AK-01-15)“.
- [x] Verständliche Fehlermeldung bei nicht beschreibbarer Datenwurzel, ohne stillen Ortswechsel (AK-01-16). Nachweis: `test/cli/init.test.ts` › „meldet eine nicht beschreibbare Datenwurzel mit Auswegen und legt nirgends etwas an (AK-01-16)“; `test/core/data-root.test.ts`.
- [x] Schemaregister und Schemas `config`, `state`, `registry` und `run-record` (AK-01-12). Nachweis: `test/core/schemas.test.ts` (gültige und ungültige Beispiele je Schema), `test/core/json.test.ts`.
- [x] Schreibfunktionen, JSONL und Lock (AK-01-08, AK-01-09). Nachweis: `test/core/fs-write.test.ts`, `test/core/jsonl.test.ts`, `test/core/lock.test.ts` (echter zweiter Prozess über `test/helpers/lock-holder.mjs`, veralteter Lock mit `lockBroken: true` im Laufprotokoll, Lock eines anderen Rechners).
- [x] IDs, Zeitfunktionen und `Clock` (AK-01-11). Nachweis: `test/core/ids.test.ts`, `test/core/time.test.ts` (Sommer, Winter, 29.03.2026, 25.10.2026, Mitternacht); injizierte Uhr in `test/core/context.test.ts`.
- [x] `GitRunner` mit Leseliste, Umgebung und Arbeitsbereichs-Pathspec gemäss spec.md §14.2 (AK-01-10). Nachweis: `test/git/runner.test.ts` (Ablehnung ohne Prozessstart über `spawn`-Spion, bereinigte Umgebung mit gesetztem `GIT_DIR`, Pathspec mit echtem Git).
- [x] `IpaError` und Abbildung auf Exit-Codes (AK-01-02, AK-01-04). Nachweis: `test/core/errors.test.ts`, `test/cli/main.test.ts`.
- [x] `scripts/claude-probe.mjs` mit Modus ohne Modellaufruf und Modus `--live` (AK-01-17, AK-01-18). Nachweis: `test/scripts/claude-probe.test.ts` mit `test/helpers/fake-claude-probe.mjs`; echte Läufe ohne und mit `--live` am 29.09.2026 (spec.md §18).

## Integration

- [x] `ipa init [--timezone] [--workspace]` ist angebunden und schreibt `runs.jsonl` (AK-01-03 bis AK-01-06, AK-01-15, AK-01-16). Nachweis: `test/cli/init.test.ts` (16 Tests über `node dist/cli.js`).
- [x] `ipa status [--json]` ist angebunden und nur lesend (AK-01-13). Nachweis: `test/cli/status.test.ts` › „liefert mit --json genau die Felder von Paket 01 und schreibt keine Datei (AK-01-13)“ (Dateibaum mit Änderungszeiten und Repository-Fingerprint unverändert).
- [x] Die globalen Optionen `--repo` und `--data-dir` wirken in allen Befehlen (AK-01-07). Nachweis: `test/cli/status.test.ts` › „zeigt für zwei Repositories jeweils den eigenen Arbeitsbereich (AK-01-07)“, auch mit Grossbuchstaben und `\` unter Windows; `test/setup/isolation.test.ts`.

## Tests

- [x] Test-Helfer `git-repo.ts`, `repo-fingerprint.ts` (mit Ausnahme für den Arbeitsbereich) und `workspace.ts` sind vorhanden und werden verwendet. Nachweis: `test/helpers/`; der Fingerprint mit Ausnahme für `.ipa` wird in `test/cli/init.test.ts` und `test/git/runner.test.ts` verwendet.
- [x] Unit-Tests für IDs, Zeit, Schemas, Pfadnormalisierung, Arbeitsbereichsregeln, Exit-Codes und die Auswertung der Vorabprüfung. Nachweis: `test/core/ids.test.ts`, `time.test.ts`, `schemas.test.ts`, `paths.test.ts`, `workspace.test.ts`, `errors.test.ts`, `test/scripts/claude-probe.test.ts`.
- [x] Integrationstests AK-01-02 bis AK-01-17 sind grün. Nachweis: `npm test` am 29.09.2026, 20 Testdateien, 146 Tests bestanden. Zuordnung: AK-01-02 `test/cli/main.test.ts`; AK-01-03 bis AK-01-06, AK-01-15, AK-01-16 `test/cli/init.test.ts`; AK-01-07, AK-01-12, AK-01-13 `test/cli/status.test.ts` und `test/core/context.test.ts`; AK-01-08 `test/core/lock.test.ts`, Exit-Code 3 über das CLI in `init.test.ts` (gesperrte Registry); AK-01-09 `fs-write.test.ts`, `jsonl.test.ts`; AK-01-10 `test/git/runner.test.ts`; AK-01-11 `time.test.ts`; AK-01-14 `test/setup/isolation.test.ts`; AK-01-17 `test/scripts/claude-probe.test.ts`.
- [x] `npm run typecheck`, `npm test` und `npm run build` sind grün. Nachweis: 29.09.2026, nach `npm ci`.
- [ ] Manuell: `npm install --global .` und `ipa init` in einer Windows-Konsole geprüft (Datum und Ergebnis notieren). Offen für den Benutzer. Ersatzprüfung am 29.09.2026 ohne Eingriff in die globale Installation: `npm pack`, dann `npm install --global --prefix <temp>`. `ipa.cmd` und `ipa.ps1` in PowerShell: `--version`, `init`, `status`, `status --json` sowie ein zweites `init` mit Exit-Code 2, jeweils mit Umlaut im Repository-Pfad und Temp-Datenwurzel.
- [x] Manuell nach Freigabe: `npm run probe:claude -- --live` ausgeführt, Ergebnis für A-01 bis A-05 und A-08 in spec.md §18 eingetragen (AK-01-18). Nachweis: 29.09.2026, Claude Code 2.1.114, zwei vom Benutzer freigegebene Läufe (3 Aufrufe innerhalb der Desktop-Sitzung, 1 Aufruf mit `--isolate-env`). A-01, A-04 und A-05 bestätigt; A-02, A-03 und A-08 unklar, weil die API die Anmeldung mit `authentication_failed` ablehnte. Keine Annahme widerlegt. Wiederholung in einem normalen Terminal nach neuer Anmeldung empfohlen (spec.md §18).

## Dokumentation und Status

- [x] `README.md`: Installation, Speicherort mit Standard und `--workspace`, Fehlermeldung bei nicht beschreibbarem Pfad, `init`, `status`, Vorabprüfung, Grenze „Repository verschoben“. Nachweis: `README.md` im Repository-Root, Stand 29.09.2026.
- [x] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt. Nachweis: 12 Einträge vom 29.09.2026 für Paket 01; Definitionen in §4.3, §5.2 bis §5.4, §6.6, §8.1, §8.4, §8.5, §10, §13.1, §13.2, §13.4, §14.2 und §16.2 angepasst.
- [x] Zentrale `docs/implementation/checklist.md` aktualisiert. Nachweis: Paketstatus „technisch abgeschlossen“, 29.09.2026.
