# Paket 02 – Snapshot-Erfassung

Verbindliche Grundlage ist `docs/implementation/spec.md`. Gemeinsame Verträge stehen nur dort und werden hier mit `spec.md §…` referenziert.

## 1. Ziel und konkretes Ergebnis

`ipa init` sichert einen Ausgangs-Snapshot. `ipa capture` sichert ohne KI einen Arbeits-Snapshot. Beide erfassen Commits, gestagte, ungestagte und neue Dateien sowie Löschungen und Umbenennungen getrennt. Vor jeder Speicherung werden Pfadfilter, Secret-Prüfung und Grössenlimits angewendet. Jeder Snapshot ist konsistent, atomar abgelegt und später lesbar. Das untersuchte Repository bleibt unverändert.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/filter/`:
  - `PathFilter` mit `picomatch` (D-10, spec.md §14.3)
  - `SecretScanner` mit den Detektoren aus spec.md §14.4, einschliesslich `extraPatterns` und `disabledDetectors`
- `src/git/`: Parser für `status --porcelain=v2 -z`, `ls-files -s -z`, `diff --name-status -z -M`, `diff --numstat -z`, `rev-list`, Commit-Metadaten mit `log -z --format=…` sowie Blob-IDs über `hash-object --stdin --path`
- `src/collector/`:
  - Aufnahme gemäss spec.md §11.1 in den Schritten 1, 3, 4, 6 und 7
  - Konsistenzprüfung (§11.2) und Wiederanlauf (§11.6)
  - Ablage in `snapshots/`
- Belegarten `commit_message`, `commit_diff`, `staged_diff` und `unstaged_diff` sowie `fileStates` mit Kopien (spec.md §9.3, §9.4). Kopien werden in diesem Paket für jeden erlaubten nicht sauberen Pfad gespeichert, dessen wirksamer Stand vom HEAD-Blob abweicht.
- `authoredByConfiguredUser` (D-19), Symlinks und Submodule (D-20), Binärdateien, Grössenlimits (§14.5)
- Schema `manifest`
- `ipa init` nimmt den Ausgangs-Snapshot auf und holt ihn bei abgebrochener Initialisierung nach (spec.md §6.3).
- Neuer Befehl `ipa capture [--no-analysis]`: Er erzeugt bei jedem Aufruf einen Arbeits-Snapshot. `--no-analysis` wird schon jetzt akzeptiert und hat noch keine Wirkung.
- `ipa status` erhält das Feld `snapshots`.
- README: `capture`, Filter, Standard-Ausschlüsse und die Grenzen der Secret-Erkennung

Nicht im Umfang:

- `state_delta`, Relevanzprüfung, Zuordnung, Statusänderungen, Halt, `baseline` und Testberichte (Paket 03). Bis dahin setzt jeder Arbeits-Snapshot `analysisRequired: true`, `statusChanges: []`, `testReports: []` und `attribution: null`.
- Analyse (Paket 06).

## 3. Voraussetzungen und abhängige Pakete

- Paket 01 ist abgeschlossen: Core-Bausteine, `GitRunner`, `init`, `status` und Test-Helfer.

## 4. Zu implementierendes Verhalten

**Erfassung pro Aufnahme**

- HEAD und Branch:
  - `head` stammt aus `rev-parse --verify -q HEAD` und ist `null` ohne Commits.
  - `branch` stammt aus `symbolic-ref -q --short HEAD` und ist `null` bei detached HEAD.
- Neue Commits:
  - Mit Vorgänger-HEAD: `rev-list --reverse --topo-order <prev>..HEAD`
  - Ohne Vorgänger-HEAD, also bei der ersten Aufnahme nach einem Repository ohne Commits: alle Commits von HEAD.
  - Der Ausgangs-Snapshot erfasst keine Commits.
  - Pro Commit werden Metadaten, Nachricht (`commit_message`) und pro erlaubter Datei ein `commit_diff` gegen den ersten Elternteil erfasst, jeweils mit `--no-ext-diff --no-textconv -M`.
- Index gegen HEAD liefert `staged_diff` pro Datei, Working Tree gegen Index liefert `unstaged_diff` pro Datei. Ohne Commits wird gegen den leeren Baum verglichen (A-06).
- Nicht versionierte Dateien kommen aus `status --untracked-files=all`, und `.gitignore` wird dabei berücksichtigt. Ihr Inhalt wird als Kopie in `fileStates` gesichert.
- Löschungen und Umbenennungen erscheinen in den Diffs und in `commits[].files[].change`.
- Blob-IDs:
  - `indexBlob` stammt aus `ls-files -s -z`.
  - `headBlob` stammt aus `diff --cached --raw --no-abbrev -z` oder, für einzelne Pfade, aus `rev-parse HEAD:<pfad>`. Beide Befehle stehen auf der Leseliste, `ls-tree` nicht.
  - `worktreeBlob` wird aus den im Speicher gelesenen Bytes über `hash-object --stdin --path=<pfad>` berechnet.

**Filter und Prüfung**

- Pfadfilter vor jedem Lesen (§14.3), Inhaltsprüfung vor jeder Speicherung (§14.4).
- Zurückgehaltene, ausgeschlossene und ausgelassene Einheiten erscheinen in `filterDecisions` und bei den betroffenen Belegen als `omitted` (I-15).
- Symlinks: nie verfolgen. Nur das Linkziel als Text speichern, nach Prüfung, mit `omitted.reason = symlink` für den Inhalt.

**Speicherung und Zustand**

- Konsistenzprüfung gemäss §11.2 mit dem Hook `CaptureHooks.afterFirstPass`.
- Ablage atomar gemäss §8.5. Wiederanlauf gemäss §11.6 mit dem Hook `CaptureHooks.beforeStateUpdate`.
- `init` speichert `S000001` mit `kind: baseline` und `analysisRequired: false` und setzt `state.baselineSnapshotId`, `lastSnapshotId` und `branch`.
- `lastAnalysedSnapshotId` bleibt `null`. Der Cursor wird in Paket 06 über den deterministisch verarbeiteten Ausgangs-Snapshot gesetzt.
- `capture` nimmt den Lock, speichert `kind: work` und schreibt `runs.jsonl`. Bei Instabilität endet es mit Exit-Code 5.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/filter/`, `src/git/parse*.ts`, `src/collector/`
  - `schemas/manifest.schema.json`
- Erweitert: `src/cli/` (`capture`, `init`, `status`)
- Schnittstellen:
  - `captureSnapshot`, `readManifest`, `listSnapshots`, `PathFilter`, `SecretScanner` (spec.md §10)
  - Manifest und Belege (§9.3, §9.4)

## 6. Fehler- und Randfälle

- Repository ohne Commits:
  - Ausgangs-Snapshot mit `head: null`
  - Erste Aufnahme nach dem ersten Commit erfasst diesen Commit
- Dateinamen mit Leerzeichen, Umlauten, Anführungszeichen und Zeilenumbrüchen: Die Verarbeitung erfolgt über `-z`, `core.quotepath=off`.
- Umbenennung von einem ausgeschlossenen zu einem erlaubten Pfad und umgekehrt (§14.3)
- Commit, der ein ausgeschlossenes `.env` mit künstlichem Secret löscht: Es entsteht kein Patch, nur `filterDecisions`.
- Erlaubte Datei, in der eine Zeile mit künstlichem Secret entfernt wird: Das Secret steht im Patch in einer `-`-Zeile. Der ganze Patch wird zurückgehalten.
- Commit-Nachricht mit künstlichem Secret wird zurückgehalten.
- Binärdatei (NUL-Byte, Numstat `-`): nur Metadaten
- Datei grösser als `maxFileBytes`, Summe grösser als `maxSnapshotBytes`
- `core.autocrlf=true` mit CRLF im Working Tree: `worktreeBlob` einer unveränderten Datei entspricht `indexBlob`.
- Merge-Commit: Diff gegen den ersten Elternteil, `isMerge: true`
- Symlink, der ausserhalb des Repositorys zeigt: Er wird nicht verfolgt.
- Submodul: nur die Commit-ID
- Datei verschwindet zwischen Status und Lesen: Die Konsistenzprüfung schlägt an und die Aufnahme wird wiederholt.
- Leerer Arbeitsstand ohne Änderungen: Es entsteht trotzdem ein Arbeits-Snapshot. Erst Paket 03 unterdrückt ihn.
- Fehlendes `user.email`: `authoredByConfiguredUser` ist dann `false` für alle Commits, und es wird eine Warnung ausgegeben.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-02-01 | `ipa init` in einem Repository mit vorhandener gestagter, ungestagter und neuer Datei speichert `S000001` (`kind: baseline`, `analysisRequired: false`). Das Manifest ist gültig, die drei Stufen sind in `fileStates` und in den Belegen getrennt erfasst. `state.baselineSnapshotId = "S000001"`. |
| AK-02-02 | Nach neuer Datei, gestagter und ungestagter Änderung speichert `ipa capture` einen Arbeits-Snapshot. Jeder Inhalt ist über `evidence[].file` beziehungsweise `fileStates[].copy` lesbar und entspricht dem erwarteten Text. |
| AK-02-03 | Zwei Commits seit dem Vorgänger erscheinen einzeln in `commits[]`, jeweils mit `commit_message` und `commit_diff` pro erlaubter Datei. Ein Merge-Commit hat `isMerge: true` und einen Diff gegen den ersten Elternteil. |
| AK-02-04 | Löschung und Umbenennung sind mit korrekter `change`-Angabe erfasst. Eine Umbenennung von `secrets/x.txt` nach `src/x.txt` liefert keinen Inhalt aus dem alten Pfad. |
| AK-02-05 | Nach einem Lauf mit ausgeschlossener Datei, die ein künstliches Secret enthält (auch in Commit-Historie und Diff), kommt der Secret-Marker in keiner Datei unter `snapshots/` vor. `filterDecisions` nennt Pfad und Regel. |
| AK-02-06 | Ein künstliches Secret in einer erlaubten Datei, in einer entfernten Diff-Zeile und in einer Commit-Nachricht führt zu `omitted.reason = secret_suspected` mit Detektorname. Der Wert steht nirgends im Arbeitsbereich und nicht in der Ausgabe. |
| AK-02-07 | Binärdateien erscheinen nur mit Metadaten (`binary: true`, ohne `file`). |
| AK-02-08 | Eine Datei über `maxFileBytes` erhält `file_too_large`. Bei Überschreiten von `maxSnapshotBytes` erhalten weitere Einheiten deterministisch `snapshot_limit`. |
| AK-02-09 | Verändert `CaptureHooks.afterFirstPass` einmal eine Datei, folgt eine erfolgreiche Wiederholung mit `stability.attempts = 2`. Verändert der Hook sie jedes Mal, endet der Lauf mit Exit-Code 5, ohne Snapshot-Ordner und mit unverändertem `state.json`. |
| AK-02-10 | Nach einem Abbruch über `CaptureHooks.beforeStateUpdate` übernimmt der nächste Lauf den Snapshot ohne Duplikat. Verwaiste `.tmp-*`-Ordner werden entfernt. |
| AK-02-11 | Der Repository-Fingerprint (spec.md §16.2) ist vor und nach `init` und `capture` identisch, einschliesslich `.git/index`. |
| AK-02-12 | Mit `core.autocrlf=true` und CRLF-Datei stimmt `worktreeBlob` einer unveränderten Datei mit `indexBlob` überein. |
| AK-02-13 | Pfade mit Leerzeichen, Umlauten und Anführungszeichen werden korrekt erfasst. |
| AK-02-14 | `authoredByConfiguredUser` ist für eigene Commits `true` und für fremde `false`. Im Arbeitsbereich steht keine E-Mail-Adresse. |
| AK-02-15 | Ein Repository ohne Commits wird initialisiert (`head: null`). Nach dem ersten Commit erfasst `capture` diesen Commit. |
| AK-02-16 | Ein Symlink auf eine Datei ausserhalb des Repositorys wird nicht gelesen. Gespeichert ist nur das geprüfte Linkziel. Unter Windows wird der Test übersprungen, wenn Symlinks nicht angelegt werden können. Das wird in der Checkliste vermerkt. |
| AK-02-17 | `PathFilter` erfüllt alle Standard-Ausschlüsse aus spec.md §7.1 in beliebiger Verzeichnistiefe und ohne Unterscheidung von Gross- und Kleinschreibung. `.git/**` ist nicht abwählbar. Jeder Detektor aus §14.4 hat mindestens einen Treffer- und einen Nichttreffer-Test. |
| AK-02-18 | `ipa status --json` enthält `snapshots: { total, baseline, work }`. `ipa --help` listet zusätzlich `capture`. |

## 8. Notwendige Tests und Validierung

- Unit-Tests:
  - Parser mit festen `-z`-Beispielausgaben
  - `PathFilter` und `SecretScanner` gemäss AK-02-17
  - Binärerkennung und Limits
- Integrationstests mit temporären Repositories für AK-02-01 bis AK-02-16
- Jeder Integrationstest vergleicht den Repository-Fingerprint vorher und nachher.
- Secret-Tests suchen den Marker rekursiv in allen Dateien der Datenwurzel und in stdout und stderr.

## 9. Offene Annahmen

- A-06 wird hier geprüft und das Ergebnis in spec.md §18 eingetragen.
- Liefert `git diff --cached` ohne Commits kein brauchbares Ergebnis, wird gegen den leeren Baum `4b825dc642cb6eb9a060e54bf8d69288fbee4904` verglichen. Unter SHA-256-Repositories ist diese ID eine andere. SHA-256-Repositories sind in V1 nicht geprüft.
