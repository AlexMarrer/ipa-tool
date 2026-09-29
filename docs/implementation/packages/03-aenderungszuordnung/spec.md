# Paket 03 – Änderungszuordnung

Dieses Dokument ergänzt `docs/implementation/spec.md` und ist nur zusammen mit dieser Datei verbindlich. Gemeinsame Verträge stehen dort (`spec.md §…`) und werden hier nicht wiederholt.

## 1. Ziel und konkretes Ergebnis

`ipa capture` erkennt, was seit dem Vorgänger-Snapshot inhaltlich neu ist:

- Es erzeugt `state_delta`-Belege.
- Bereits dokumentierte Stände, die gestagt oder committet werden, führt es nur als Statusänderungen, nicht als neue Arbeit.
- Bei unverändertem Zustand speichert es keinen Snapshot.
- Nach einem Branchwechsel oder bei umgeschriebener Historie hält es kontrolliert an. `ipa baseline` setzt danach einen neuen Ausgangspunkt.
- Konfigurierte Testberichte werden mit Aktualitätsangabe erfasst.

## 2. Umfang und Abgrenzung

Im Umfang:

- Zustandsdelta, Kopien, dokumentierte Blobs, Statusänderungen und Zuordnung der Commit-Dateien (spec.md §11.4)
- Relevanz und `analysisRequired` (§11.3)
- Halt-Erkennung und `state.halt` (§11.5)
- Neuer Befehl `ipa baseline --reason <text> [--force]`
- Testberichte aus `config.testReports`: Beleg `test_report`, Feld `fresh`, Liste `manifest.testReports` (D-17)
- Lücken `rebaseline`, `previous_state_unavailable` und `halt_detected` in `gaps`
- `ipa status` erhält das Feld `halt`
- README: Zuordnung, Halt, `baseline` und Testberichte

Nicht im Umfang:

- Analyse und Work-Logs (Paket 06)
- Journal (Paket 07)
- Auswertung oder Ausführung von Tests

## 3. Voraussetzungen und abhängige Pakete

- Paket 01 und Paket 02 sind abgeschlossen: Snapshots werden konsistent gespeichert, und `fileStates`-Kopien liegen vor.

## 4. Zu implementierendes Verhalten

**Ablauf von `ipa capture`**

1. Liegt ein Halt vor (`state.halt != null`), wird nichts aufgenommen. Exit-Code 4 mit Hinweis auf `ipa baseline`.
2. Halt-Prüfung gemäss §11.5.
   - Bei Erkennung wird `state.halt` gesetzt und `runs.jsonl` mit `outcome: halted` geschrieben. Exit-Code 4.
   - Beim Übergang von „kein HEAD“ zu einem ersten Commit liegt kein Halt vor.
3. Erfassung wie in Paket 02, zusätzlich Kandidatenpfade, voriger und aktueller wirksamer Stand, `state_delta` und Zuordnung gemäss §11.4.
4. Testberichte: Für jeden Eintrag in `testReports` wird die Datei, falls vorhanden, direkt gelesen, also ohne Pfadfilter, aber mit Inhaltsprüfung und Grössenlimit.
   - Weicht ihr SHA-256 vom letzten Eintrag in `manifest.testReports` der Folge ab oder ist sie neu, entsteht ein Beleg `test_report`.
   - `fresh` ist `true`, wenn `mtime` im Intervall `(observedPeriod.from, observedPeriod.to]` liegt.
   - Ein Pfad ausserhalb des Repositorys ist erlaubt.
5. Relevanz gemäss §11.3. Bei nicht relevanter Aufnahme gilt:
   - Ergebnis `unchanged` mit Exit-Code 0 und `runs.jsonl` mit `outcome: unchanged`.
   - Es wird kein Snapshot geschrieben, und `state.json` bleibt unverändert.
6. `analysisRequired` gemäss §11.3 setzen.

**Kopien und Deltas**

- Kopien des wirksamen Stands werden für jeden Pfad gespeichert, dessen wirksamer Stand vom HEAD-Blob abweicht. Sie dienen der nächsten Aufnahme als voriger Stand.
- Ist die Kopie des Vorgängers ausgelassen, weil sie zu gross oder als Secret verdächtig war, kann der vorige Stand nicht gelesen werden. Dann gilt:
  - Es entsteht eine Lücke `previous_state_unavailable`.
  - Das `state_delta` wird ohne Vorgänger nur mit `toBlob` erzeugt. Der Inhalt ist der aktuelle Stand nach Prüfung.
- Patches von `state_delta` werden vollständig mit dem `SecretScanner` geprüft, einschliesslich der `-`-Zeilen.

**`ipa baseline --reason <text> [--force]`**

- Ohne Halt und ohne `--force`: Exit-Code 2.
- Nimmt den Lock und einen Ausgangs-Snapshot auf: `kind: baseline` mit `gaps: [{ type: "rebaseline", detail }]`. War ein Halt aktiv, kommt `{ type: "halt_detected", detail: <reason und Zeitpunkt> }` dazu.
- Setzt `state.halt = null` und `state.branch` auf den aktuellen Wert.
- Schreibt `runs.jsonl`.
- Instabiler Stand: Exit-Code 5, und der Halt bleibt bestehen.

**Dokumentierte Blobs**

- Die Suche nach `documented` und `baseline` läuft rückwärts über die Snapshots der aktuellen Folge bis einschliesslich des letzten Ausgangs-Snapshots.
- Ein Index pro Lauf ist erlaubt. Ein dauerhafter Zusatzindex ist nicht erforderlich.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Erweitert:
  - `src/collector/` mit den Bausteinen Delta, Zuordnung, Relevanz, Halt und Testberichte
  - `src/cli/` (`baseline`, `capture`, `status`)
  - `schemas/manifest.schema.json`, sofern Felder fehlen
- Schnittstelle: `CaptureOutcome` mit den Varianten `unchanged` und `halted` (spec.md §10), `state.halt` (§9.1)

## 6. Fehler- und Randfälle

- Datei wird geändert und danach auf den HEAD-Stand zurückgesetzt. Es entsteht ein `state_delta`, das die Rücknahme zeigt, nicht „unverändert“.
- Datei wird gelöscht und identisch wieder angelegt. Das ergibt keine Änderung.
- Dokumentierter Stand wird committet und gleichzeitig weiter bearbeitet. Die Commit-Datei erhält `documented`, und ein neues `state_delta` entsteht für den Folgestand.
- Mehrere Commits ändern dieselbe Datei zwischen zwei Aufnahmen. Das `state_delta` zeigt den Nettoeffekt. Zwischenstände erhalten `new` mit `coveredBy`, oder `unclear`, wenn kein Delta den Pfad abdeckt.
- Merge eines fremden Branches (Fast-Forward oder Merge-Commit): Der Vorgänger ist Vorfahre, es gibt keinen Halt. Fremde Commits haben `authoredByConfiguredUser: false`.
- Wechsel in detached HEAD, zum Beispiel während eines Rebase: Halt `branch_changed`.
- `git reset --soft HEAD~1` oder `commit --amend`: Halt `history_rewritten`.
- Der Vorgänger-HEAD wurde durch Garbage Collection entfernt: Halt `head_missing`.
- Testbericht wird gelöscht: kein Beleg. Er fehlt in `manifest.testReports`, und das allein macht die Aufnahme nicht relevant.
- Testbericht mit künstlichem Secret: `secret_suspected`.
- Testbericht mit altem `mtime`, aber neuem Inhalt, zum Beispiel beim Kopieren: `fresh: false`.
- Reines `git add` eines dokumentierten Stands: kein Snapshot (D-07).

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-03-01 | Zweimal `ipa capture` ohne Änderung dazwischen: Der zweite Lauf speichert keinen Snapshot, endet mit Exit-Code 0 und protokolliert `outcome: unchanged`. |
| AK-03-02 | Wird ein bereits erfasster Stand nur gestagt, entsteht kein neuer Snapshot. |
| AK-03-03 | Ein erfasster ungestagter Stand wird unverändert committet. Der neue Snapshot enthält einen Eintrag in `statusChanges` mit `attribution: documented` und `previousEvidence` auf das frühere `state_delta`. Für den Pfad entsteht kein neues `state_delta`, die Commit-Datei hat `documented`, und es gilt `analysisRequired: false`. |
| AK-03-04 | Ein erfasster Stand wird weiter bearbeitet und committet. Es entsteht ein `state_delta` vom dokumentierten Blob (`fromBlob`) zum neuen Blob (`toBlob`), und die Commit-Datei hat `new` mit `coveredBy`. |
| AK-03-05 | Ein Stand aus dem Ausgangs-Snapshot wird später committet. Das ergibt `attribution: baseline` und kein `state_delta`. |
| AK-03-06 | Eine Änderung wird auf den HEAD-Stand zurückgesetzt. Das ergibt ein `state_delta` mit `toBlob` gleich HEAD-Blob. |
| AK-03-07 | Nach einem Branchwechsel endet `capture` mit Exit-Code 4, und `state.halt.reason` ist `branch_changed`. Es entsteht kein neuer Snapshot, und alle vorhandenen Snapshot-Dateien bleiben byte-gleich. |
| AK-03-08 | Nach `commit --amend` oder Rebase lautet `state.halt.reason` `history_rewritten`. |
| AK-03-09 | Ein weiterer `capture` bei aktivem Halt endet erneut mit Exit-Code 4, ohne Snapshot. |
| AK-03-10 | `ipa baseline --reason "…"` hebt den Halt auf und speichert einen Ausgangs-Snapshot mit Lücke `rebaseline`. Der nächste `capture` ordnet relativ zu diesem Ausgangspunkt zu. Ohne Halt und ohne `--force` endet `baseline` mit Exit-Code 2. |
| AK-03-11 | Ein geänderter Testbericht mit `mtime` im Beobachtungszeitraum ergibt `test_report` mit `fresh: true`. Ein Bericht mit älterem `mtime` ergibt `fresh: false`. Ein unveränderter Bericht ergibt keinen Beleg. Ein Bericht mit künstlichem Secret wird zurückgehalten. |
| AK-03-12 | Ein `state_delta`, das eine Zeile mit künstlichem Secret entfernt, wird vollständig zurückgehalten, und der Marker steht nirgends im Arbeitsbereich. |
| AK-03-13 | Dieselbe Folge von Repository-Zuständen erzeugt in zwei getrennten Arbeitsbereichen inhaltlich gleiche Belege: gleiche Arten, Pfade, Blobs und Patchtexte, ohne Zeitstempel und IDs. |
| AK-03-14 | `ipa status --json` enthält `halt`. `ipa --help` listet `baseline`. Der Repository-Fingerprint bleibt in allen Tests dieses Pakets unverändert. |
| AK-03-15 | Mit Arbeitsbereich `.ipa/` im Repository ergibt ein zweiter `capture` nach dem ersten `unchanged`, obwohl sich Dateien in `.ipa/` wie `runs.jsonl` und Snapshots geändert haben. Die eigenen Ausgaben werden nicht als Entwicklungsarbeit erfasst. |

## 8. Notwendige Tests und Validierung

- Szenariotests mit temporären Repositories für jedes Akzeptanzkriterium. Jedes Szenario läuft als Schrittfolge mit echten Git-Befehlen im Test-Repository.
- Unit-Tests für die Zuordnungsfunktion mit konstruierten `fileStates` und Blobs, darunter die Randfälle aus Abschnitt 6.
- Prüfung per Byte-Vergleich, dass vorhandene Snapshots bei Halt und `baseline` unverändert bleiben.

## 9. Offene Annahmen

- Die Freshness-Regel über `mtime` ist eine Heuristik. Den getesteten Codezustand kann V1 nicht nachweisen. Das bleibt im Journal als „nicht nachgewiesen“ sichtbar (Paket 07).

Folgen aus der Umsetzung (29.09.2026, Einzelheiten in spec.md §18):

- Umgesetzt in `src/collector/attribution.ts` (reine Planung), `lineage.ts` (dokumentierte und Ausgangs-Blobs), `delta.ts` (wirksame Stände, Patches), `halt.ts`, `test-reports.ts`; angebunden in `capture.ts`, `src/cli/commands/capture.ts`, `baseline.ts` und `status.ts`.
- Bei `unchanged` ändert sich in `state.json` nur `lastSuccessfulRun` (§9.1). Paket 06 muss beachten, dass `unchanged` trotzdem ein erfolgreicher Lauf ist.
- `state_delta` und `test_report` erhalten IDs nach den Diffs aus Paket 02, haben bei `snapshot_limit` aber Vorrang vor ihnen.
- Der Patch-Kopf eines `state_delta` stammt vom Tool; Worktree-Inhalte werden bei `core.autocrlf` in Blob-Form verglichen. Andere Clean-Filter (zum Beispiel Git LFS) werden für den Patch nicht angewendet; ein Delta kann dann Filterunterschiede zeigen.
- Eine vorher erfasste neue Datei, die danach nur ignoriert wird (Eintrag in `.gitignore`), erscheint wie eine Löschung, weil `git status` ignorierte Dateien nicht meldet.
- Ein Zwischenstand, der vor der nächsten Aufnahme committet und wieder zurückgenommen wird, bleibt `unclear` und macht den Snapshot analysepflichtig, obwohl kein Delta entsteht.
- Submodule ohne eigenes Repository (nicht ausgecheckt) gelten als nicht ermittelt und ergeben kein Delta.
- Dasselbe gilt für Dateien hinter einer Ordner-Junction, die Git für Windows auflistet (spec.md §18, Paket 02). Eine neue Junction allein macht eine Aufnahme daher nicht relevant; die Pfade erscheinen erst mit der nächsten relevanten Aufnahme in `fileStates` und `filterDecisions`. Gefunden beim Testlauf unter Windows am 29.09.2026 (AK-02-16).
- Die Tests liefen in einer Linux-Cloud-Umgebung (Node.js 22.22, Git 2.43) und am 29.09.2026 auf dem Windows-Entwicklungsrechner (Node.js 24, Git 2.51); dort schlug nur der Junction-Test aus Paket 02 fehl, der danach angepasst und erneut grün geprüft wurde.
