# Checkliste Paket 03 – Änderungszuordnung

Erst abhaken, wenn die Arbeit umgesetzt und geprüft ist. Hinter jeden Punkt gehört der Nachweis (Test, Befehl oder Datum).

Prüfumgebung der Nachweise: 29.09.2026, Linux-Cloud-Umgebung (Node.js 22.22.2, Git 2.43.0) und Windows-Entwicklungsrechner (Node.js 24, Git 2.51).

## Voraussetzungen

- [x] Pakete 01 und 02 sind im Code vorhanden, und ihre Tests sind grün. Nachweis: `npm run typecheck` grün; `npm test` vor Beginn 237 bestanden, 1 fehlgeschlagen (AK-01-16, `ENOTDIR` unter Linux statt `ENOENT`), mit Zustimmung des Benutzers in `src/core/registry.ts` behoben, danach grün (spec.md §18).
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben. Nachweis: `git status` vor Beginn sauber auf `claude/compassionate-noether-k37t7k`, letzter Commit `305893c`.

## Implementierung

- [x] Wirksamer Stand, Kandidatenpfade und voriger Stand gemäss spec.md §11.4 (AK-03-04, AK-03-06). Nachweis: `src/collector/delta.ts` (`resolveTransitions`); Tests „erzeugt nach weiterer Bearbeitung ein Delta vom dokumentierten Blob …“ (AK-03-04), „zeigt eine Rücknahme auf den HEAD-Stand …“ (AK-03-06), „zeigt bei mehreren Commits den Nettoeffekt …“ in `test/collector/attribution-scenarios.test.ts`.
- [x] `state_delta` über `git diff --no-index` in `tmp/`, mit Secret-Prüfung (AK-03-04, AK-03-12). Nachweis: `materializeDeltas` in `src/collector/delta.ts`, Prüfung über `screen` in `build.ts`; Tests „hält ein Delta vollständig zurück, das eine Zeile mit künstlichem Secret entfernt (AK-03-12)“, „trägt previous_state_unavailable ein …“, „vergleicht mit core.autocrlf=true …“.
- [x] Dokumentierte Blobs, Statusänderungen, Zuordnung der Commit-Dateien (AK-03-03, AK-03-05). Nachweis: `src/collector/lineage.ts`, `src/collector/attribution.ts`; Tests „führt einen unverändert committeten Stand nur als Statusänderung (AK-03-03, I-08)“, „ordnet einen später committeten Stand aus dem Ausgangs-Snapshot als baseline zu (AK-03-05)“.
- [x] Relevanz und `analysisRequired` gemäss spec.md §11.3 (AK-03-01, AK-03-02, AK-03-03). Nachweis: `captureSnapshot` in `src/collector/capture.ts`, `analysisRequired` in `build.ts`; Tests AK-03-01, AK-03-02, AK-03-03 in `attribution-scenarios.test.ts`.
- [x] Halt-Erkennung und `state.halt` (AK-03-07, AK-03-08, AK-03-09). Nachweis: `src/collector/halt.ts`; `test/collector/halt.test.ts` (Branchwechsel, Amend, Rebase, `reset --soft`, detached HEAD, `head_missing` nach GC, erster Commit ohne Halt, wiederholter Halt).
- [x] Testberichte mit `fresh` und Inhaltsprüfung (AK-03-11). Nachweis: `src/collector/test-reports.ts`; `test/collector/test-reports.test.ts` (3 Tests) und Unit-Tests „Testberichte: Vergleich und Aktualität“ in `attribution.test.ts`.

## Integration

- [x] `ipa capture` nutzt Relevanz und Halt, `unchanged` wird protokolliert (AK-03-01, AK-03-07). Nachweis: `runCapture` in `src/cli/commands/capture.ts`; Tests AK-03-01 und AK-03-07 prüfen `runs.jsonl` (`unchanged`, `halted`).
- [x] `ipa baseline --reason [--force]` angebunden (AK-03-10). Nachweis: `src/cli/commands/baseline.ts`, registriert in `src/cli/main.ts`; Tests „hebt den Halt auf …“, „verlangt ohne Halt --force …“, „lässt den Halt bei instabilem Stand bestehen …“ in `halt.test.ts`.
- [x] `ipa status` zeigt `halt` (AK-03-14). Nachweis: `test/cli/status.test.ts` „liefert mit --json genau die Felder der Pakete 01 bis 03 …“ und „zeigt einen aktiven Halt mit Grund und Hinweis auf ipa baseline“.
- [x] Eigene Ausgaben in einem Arbeitsbereich im Repository ergeben `unchanged` (AK-03-15). Nachweis: „erfasst eigene Ausgaben in .ipa/ nicht als Arbeit …“ in `attribution-scenarios.test.ts`.

## Tests

- [x] Szenariotests AK-03-01 bis AK-03-15 grün, jeweils mit Prüfung des Repository-Fingerprints. Nachweis: `attribution-scenarios.test.ts` (AK-03-01 bis -06, -12, -13, -15), `halt.test.ts` (AK-03-07 bis -10), `test-reports.test.ts` (AK-03-11), `test/cli/status.test.ts` und `test/cli/main.test.ts` (AK-03-14). Jeder CLI-Aufruf läuft über `unchanged()` bzw. `fingerprintRepo`/`expectRepoUnchanged`, bei `.ipa/` mit Arbeitsbereichsausnahme.
- [x] Unit-Tests der Zuordnung mit allen Randfällen aus der Paketspezifikation, Abschnitt 6. Nachweis: `test/collector/attribution.test.ts` (20 Tests: Rücknahme, Löschen und Neuanlegen, committet und weiter bearbeitet, mehrere Commits, reines Stagen, Löschung, unbekannte Stände, Lineage-Grenze). Randfälle mit Git (Merge fremder Branch, detached HEAD, `reset --soft`, Amend, GC, Testbericht gelöscht, mit Secret, alte `mtime`) als Integrationstests in `attribution-scenarios.test.ts`, `halt.test.ts` und `test-reports.test.ts`.
- [x] Byte-Vergleich bestehender Snapshots bei Halt und `baseline` (AK-03-07). Nachweis: `expectHalted` und „hebt den Halt auf …“ in `halt.test.ts` vergleichen `listTree` (Grösse, mtime, SHA-256 jeder Datei) vor und nach dem Lauf.
- [x] Determinismus-Test (AK-03-13). Nachweis: „erzeugt in zwei Arbeitsbereichen dieselben Belege für dieselbe Folge von Zuständen“ in `attribution-scenarios.test.ts`.
- [x] `npm run typecheck`, `npm test` und `npm run build` grün. Nachweis: 29.09.2026, alle drei ohne Fehler; `npm test`: 34 Testdateien, 287 bestanden, 4 übersprungen (nur unter Windows ausgeführte Tests aus Paket 01).
- [x] `npm test` auf dem Entwicklungsrechner (Windows 11, Node.js 24, Git 2.51) grün. Nachweis: 29.09.2026, voller Lauf 289 bestanden, 1 übersprungen (echter Symlink ohne Entwicklermodus), 1 fehlgeschlagen (AK-02-16 mit Junction: Testerwartung aus Paket 02, Pfade hinter der Junction sind nicht ermittelt und machen die Aufnahme allein nicht relevant). Test angepasst (Commit `0f2c9d8`), danach `npx vitest run test/collector/capture-paths.test.ts` unter Windows: 6 bestanden, 1 übersprungen.

## Dokumentation und Status

- [x] README: Zuordnung, Halt, `baseline`, Testberichte. Nachweis: Abschnitte „`ipa baseline`“, „Zuordnung von Änderungen“, „Testberichte“, Exit-Code 4 und Feld `halt` in `README.md`.
- [x] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt. Nachweis: 9 Einträge vom 29.09.2026 für Paket 03; betroffene Definitionen in §6.3, §9.1, §9.3, §11.3, §11.4, §11.5 und §14.5 angepasst.
- [x] Zentrale `docs/implementation/checklist.md` aktualisiert. Nachweis: Paketstatus 03.
