# Checkliste Paket 02 – Snapshot-Erfassung

Einen Punkt erst abhaken, wenn die Arbeit umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [x] Paket 01 ist im Code vorhanden, und seine Tests sind grün. Nachweis: 29.09.2026 vor den Änderungen `npm run typecheck` fehlerfrei, `npm test` mit 20 Testdateien und 146 bestandenen Tests; Node.js 24.19.0, Git 2.51.0.windows.1. Paket 01 steht in beiden Checklisten auf `abgeschlossen`.
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben. Nachweis: 29.09.2026 `git status` auf `main`, uncommittete Änderungen des Benutzers in `docs/implementation/checklist.md`, `docs/implementation/packages/01-cli-grundlage/checklist.md` und `docs/implementation/spec.md` blieben erhalten und wurden nur ergänzt.

## Implementierung

- [x] `PathFilter` mit picomatch gemäss D-10 und spec.md §14.3 (AK-02-04, AK-02-05, AK-02-17). Nachweis: `src/filter/path-filter.ts`; `test/filter/path-filter.test.ts` (alle Standard-Ausschlüsse in jeder Tiefe und Schreibweise, `.git` nicht abwählbar, Arbeitsbereich im Repository). Muster ohne `/` gegen den Dateinamen in eigener Umsetzung, weil die picomatch-Option `basename` auch Muster mit `/` verändert (spec.md §18).
- [x] `SecretScanner` mit allen Detektoren aus spec.md §14.4 (AK-02-06, AK-02-17). Nachweis: `src/filter/secret-scanner.ts`; `test/filter/secret-scanner.test.ts` (je Detektor Treffer und Nichttreffer, `extraPatterns`, `disabledDetectors`, Laufzeit bei sehr langen Zeilen).
- [x] Git-Parser mit `-z` für Status, ls-files, name-status, numstat, rev-list und log (AK-02-03, AK-02-13). Nachweis: `src/git/parse-status.ts`, `parse-diff.ts`, `parse-log.ts`; `test/git/parse-status.test.ts`, `parse-diff.test.ts`, `parse-log.test.ts`. Statt name-status wird `--raw -z --no-abbrev` geparst, das zusätzlich Modi und Blob-IDs liefert (spec.md §18); dazu das Aufteilen von Patches in Dateiabschnitte.
- [x] Blob-IDs über `hash-object --stdin --path` ohne `-w` (AK-02-12). Nachweis: `src/git/objects.ts`; `test/collector/capture.test.ts` › „berechnet mit core.autocrlf=true für eine CRLF-Datei denselben Blob wie der Index (AK-02-12)“. Dateien über `maxFileBytes` hasht Git aus der Datei, ebenfalls ohne `-w` (spec.md §18, geprüft in AK-02-08).
- [x] Belege `commit_message`, `commit_diff`, `staged_diff`, `unstaged_diff` sowie `fileStates` mit Kopien (AK-02-01, AK-02-02, AK-02-03). Nachweis: `src/collector/build.ts`, `diffs.ts`, `new-file-patch.ts`; `test/collector/build.test.ts`; `capture.test.ts` › AK-02-01, AK-02-02, AK-02-03.
- [x] Binärdateien, Grössenlimits, Symlinks und Submodule (AK-02-07, AK-02-08, AK-02-16). Nachweis: `capture.test.ts` › AK-02-07, AK-02-08; `capture-paths.test.ts` › Junction, Symlink und als Datei ausgecheckter Link (AK-02-16); `build.test.ts` (NUL-Byte, `file_too_large`, deterministisches `snapshot_limit`). Submodul am 29.09.2026 im Rauchtest geprüft: `worktreeBlob` ist der ausgecheckte Commit, der Diff zeigt nur Commit-IDs, keine Kopie.
- [x] Konsistenzprüfung mit Hook `afterFirstPass` (AK-02-09). Nachweis: `test/collector/stability.test.ts` › „wiederholt die Aufnahme nach einer einmaligen Änderung …“ (`attempts: 2`) und „endet bei dauernder Änderung mit Exit-Code 5 …“.
- [x] Atomare Ablage, Wiederanlauf und Hook `beforeStateUpdate` (AK-02-10). Nachweis: `src/collector/capture.ts`, `recovery.ts`; `stability.test.ts` › „übernimmt einen nach dem Umbenennen abgebrochenen Snapshot ohne Duplikat …“ und „übernimmt bei init einen Ausgangs-Snapshot …“.
- [x] `authoredByConfiguredUser` ohne Speicherung von E-Mail-Adressen (AK-02-14). Nachweis: `capture-paths.test.ts` › „kennzeichnet eigene und fremde Commits, ohne E-Mail-Adressen zu speichern (AK-02-14)“, einschliesslich Warnung bei fehlendem `user.email`.
- [x] Schema `manifest` gemäss spec.md §9.3 und §9.4. Nachweis: `schemas/manifest.schema.json` (alle Belegarten, `statusChanges`, `testReports`, `gaps` für Paket 03); jedes Manifest in den Tests wird mit `validate('manifest', …)` geprüft; `test/core/schemas.test.ts`.
- [x] Ausschluss eines Arbeitsbereichs im Repository über Pfadfilter und Pathspec (AK-02-19). Nachweis: `capture-paths.test.ts` › „erfasst nichts aus .ipa, auch nicht aus Commits, und bleibt beim Schreiben in .ipa/tmp stabil“ (Fingerprints gegen Git mit und ohne Ausschluss verglichen).

## Integration

- [x] `ipa init` nimmt den Ausgangs-Snapshot auf und holt ihn bei abgebrochener Initialisierung nach (AK-02-01, AK-02-15). Nachweis: `src/core/init.ts`, `src/cli/commands/init.ts`, `src/collector/baseline.ts`; `test/cli/init.test.ts` › AK-01-03; `test/cli/capture.test.ts` › „verlangt einen Ausgangs-Snapshot; ein erneutes init holt ihn nach …“; `capture.test.ts` › AK-02-15.
- [x] `ipa capture [--no-analysis]` angebunden, mit Lock und `runs.jsonl` (AK-02-02, AK-02-18). Nachweis: `src/cli/commands/capture.ts`; `test/cli/capture.test.ts` (Lauf mit und ohne `--no-analysis`, `runs.jsonl`, `lastSuccessfulRun`, Exit-Code 3 bei gehaltenem Lock mit Protokolleintrag).
- [x] `ipa status` zeigt `snapshots` (AK-02-18). Nachweis: `test/cli/status.test.ts` › „liefert mit --json genau die Felder der Pakete 01 und 02 …“; `test/cli/capture.test.ts` (`{ total: 3, baseline: 1, work: 2 }`); `test/cli/main.test.ts` (Hilfe listet `capture`).

## Tests

- [x] Unit-Tests für Parser, Filter, Detektoren und Limits. Nachweis: `test/git/parse-*.test.ts`, `test/filter/*.test.ts`, `test/collector/build.test.ts` (69 Tests, 29.09.2026 grün).
- [x] Integrationstests AK-02-01 bis AK-02-19 grün, jeweils mit Prüfung des Repository-Fingerprints (AK-02-11). Nachweis: `test/collector/capture.test.ts`, `capture-paths.test.ts`, `stability.test.ts`, `test/cli/capture.test.ts`; `init` und `capture` laufen dort im Helfer `unchanged()`, der den Fingerprint einschliesslich `.git/index` vorher und nachher vergleicht. Zusätzlich `test/git/runner.test.ts` › „schreibt .git/index bei einem Diff gegen den Working Tree nicht neu …“. **Vermerk AK-02-16:** Der Test mit echtem Symlink wird auf dem Entwicklungsrechner übersprungen, weil Windows ohne Entwicklermodus keine Symlinks anlegt (EPERM). D-20 ist dort über eine Junction auf einen Ordner ausserhalb und über einen als Datei ausgecheckten Link geprüft.
- [x] Secret-Marker-Suche über die gesamte Datenwurzel und über stdout und stderr (AK-02-05, AK-02-06). Nachweis: `test/helpers/secrets.ts` (`filesContaining`); `capture.test.ts` › AK-02-05, AK-02-06; `capture-paths.test.ts` › AK-02-16.
- [x] `npm run typecheck`, `npm test` und `npm run build` grün. Nachweis: 29.09.2026, zwei Durchläufe von `npm test` mit je 30 Testdateien, 241 bestandenen und 1 übersprungenen Test (echter Symlink, siehe oben), 118 s und 128 s.
- [x] Annahme A-06 geprüft und das Ergebnis in spec.md §18 eingetragen. Nachweis: 29.09.2026 mit Git 2.51.0.windows.1 von Hand bestätigt; im Produktcode `capture.test.ts` › AK-02-15 (gestagte Datei im Repository ohne Commits ergibt ein `staged_diff` gegen den leeren Baum).

## Dokumentation und Status

- [x] README: `capture`, Filter, Standard-Ausschlüsse, Grenzen der Secret-Erkennung. Nachweis: `README.md`, Abschnitte „`ipa capture`“ und „Filter und vertrauliche Inhalte“, Stand 29.09.2026.
- [x] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt. Nachweis: 14 Einträge vom 29.09.2026 für Paket 02; Definitionen in §3.2 (D-05), §6.3, §8.5, §9.3, §9.4, §9.11, §10, §11.1, §11.2, §11.6, §14.2 bis §14.5 und §16.1 angepasst; Folgen in Paketspezifikation §9.
- [x] Zentrale `docs/implementation/checklist.md` aktualisiert. Nachweis: Paketstatus „abgeschlossen“, 29.09.2026.
