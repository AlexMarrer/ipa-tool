# Paket 06 – Analyse-Pipeline

Die gemeinsamen Verträge stehen verbindlich in `docs/implementation/spec.md`. Hier wird mit `spec.md §…` auf sie verwiesen, Definitionen werden nicht wiederholt.

## 1. Ziel und konkretes Ergebnis

Nach der Aufnahme verarbeitet `ipa capture` offene Snapshots der Reihe nach:

1. Es baut ein gefiltertes Eingabepaket.
2. Es lässt das Paket von Claude analysieren.
3. Es prüft die Antwort nach Schema und Belegregeln.
4. Es speichert Analyse und Markdown-Work-Log unter stabilen Pfaden.
5. Erst danach schreibt es den Cursor fort.

KI-Fehler lassen Snapshots offen, Wiederanläufe erzeugen keine Duplikate. Ausgangs-Snapshots und Snapshots mit reinen Statusänderungen erhalten einen deterministischen Log ohne Claude. `ipa skip` macht eine bewusst ausgelassene Analyse als Lücke sichtbar.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/analysis/`:
  - Statusableitung (spec.md §12.1)
  - Eingabepaket (§9.6, §12.2)
  - Validator mit Ajv und den Regeln R-01 bis R-05 und R-07 (§15)
  - Ablage (§8.1, §9.8, §9.9)
  - Work-Log-Renderer
  - Warteschlange und Cursor (§12.2, §12.3)
  - Wiederanlauf (§12.4)
  - deterministische Verarbeitung von `not_required`
- Prompt `prompts/analyze-work.md` (`analyze-work@1`, §13.5)
- Schemas `analysis-input`, `analysis-output`, `analysis-record`, `complete`, `skip` und `retry`
- Anbindung an `ipa capture`:
  - Die Warteschlange läuft nach dem Aufnahmeschritt, auch bei Halt.
  - `--no-analysis` überspringt sie.
  - `--retry <id>` legt `retry-<n>.json` an.
  - Exit-Codes nach §6.4
- Neuer Befehl `ipa skip <snapshotId> --reason <text>`
- `ipa status` erhält das Feld `analyses`.
- README: Analyseablauf, Work-Log-Format, `skip`, `--retry`, Umgang mit `blocked` und `exhausted`

Nicht im Umfang:

- Journal (Paket 07)
- Laufzeitgrenze `maxRunSeconds`: Paket 08 aktiviert sie. Hier wird `deadline` bereits als Parameter von `processQueue` unterstützt, und das CLI übergibt vorerst „kein Limit“.

## 3. Voraussetzungen und abhängige Pakete

- Paket 02 ist abgeschlossen (Snapshots, Manifest).
- Paket 03 ist abgeschlossen (`state_delta`, `analysisRequired`, Statusänderungen, Testberichte, Halt).
- Paket 04 ist abgeschlossen (`readNotes`).
- Paket 05 ist abgeschlossen (`ClaudeRunner`, `ensureClaudeReady`, Fake-CLI, `ai-usage.jsonl`).

## 4. Zu implementierendes Verhalten

**Eingabepaket**

- Aus dem Manifest werden alle Belege der Arten `commit_message`, `state_delta` und `test_report` übernommen. Belege ohne `omitted` bekommen ihren Inhalt als UTF-8-Text (`content`), Belege mit `omitted` erhalten `content: null` und behalten die Angabe `omitted`.
- Dazu kommen `commits` ohne Blob-IDs, `statusChanges`, Notizen gemäss §12.2 und Kontextdateien.
  - Kontextdateien werden bei jedem Versuch neu gelesen und geprüft.
  - Sie erhalten IDs `C01…` in der Reihenfolge der Konfiguration.
- `filterSummary` enthält nur Zähler aus `filterDecisions`, zurückgehaltenen Notizen und ausgelassenem Kontext.
- `allowedEvidenceIds` wird gebildet.
- Vor dem Versand wird das Paket gegen `analysis-input.schema.json` geprüft.
- Die Grösse wird geprüft. Bei Überschreitung gilt §12.2 mit `input_too_large`.

**Versuch**

1. `attempt-<n>/` exklusiv anlegen.
2. `input.json`, `prompt.md` und `schema.json` hineinschreiben.
3. `ClaudeRunner.run` mit `cwd = attempt-<n>/` aufrufen.
4. `response.json` (rohes stdout) und `stderr.txt` immer speichern.
5. Validierung: Ajv gegen `analysis-output`, danach R-01 bis R-05 und R-07.
6. `outcome.json` schreiben.

Ungültige Antworten werden nie in `analysis.json` oder Logs übernommen.

**Erfolg**

- Die Ablage folgt der Reihenfolge aus §12.3:
  - `analysis.json` mit `provenance` gemäss §9.8. Die Notizen und der Kontext sind mit SHA-256 gesichert.
  - `logs/<id>.md`
  - `complete.json`
  - danach Cursor, `lastCommit` und `lastSuccessfulRun`
- Die Hooks `QueueHooks.after*` ermöglichen Abbruchtests.

**`not_required`**

- Deterministisches `analysis.json` mit `analysis: null`.
- Log mit Statusänderungen, Commits mit geprüften Nachrichten, Filterhinweisen und Lücken.
- Ausgangs-Snapshots tragen die Überschrift „Ausgangslage – keine neu erbrachte Leistung“.
- Danach `complete.json` und Cursor, wie oben.

**Work-Log** `logs/<id>.md`

Kopf:

- Snapshot-ID, Vorgänger, Beobachtungszeitraum, Branch, HEAD, Commit-Liste
- Hinweis: „Automatisch erzeugter KI-Entwurf – vor Verwendung persönlich prüfen.“

Abschnitte in dieser Reihenfolge:

1. Zusammenfassung
2. Umgesetzt
3. Entscheidungen
4. Probleme
5. Tests
6. Widersprüche
7. Statusänderungen (deterministisch)
8. Unbekannt/offen
9. Erfassungshinweise (Zähler und Gründe von Auslassungen)
10. Belege, als Tabelle mit ID, Art, Pfad und Datei

Weitere Regeln:

- Jede Aussage endet mit ihren Beleg-IDs in eckigen Klammern.
- Leere Listen erscheinen als „nicht erfasst“ (I-13).
- Test-Ergebnisse `unknown` erscheinen als „Ergebnis unbekannt – kein passender Testbericht“.

**Warteschlange** gemäss §12.2

- `claude.maxAnalysesPerRun` wird eingehalten.
- Vor dem ersten Claude-Aufruf eines Laufs wird `ensureClaudeReady` aufgerufen.
- Kein Aufruf findet statt, wenn nichts `pending` oder `failed` ist (Konzept §6.2).

**Exit-Codes von `capture`**

| Situation | Exit-Code |
| --- | --- |
| Aufnahme und Warteschlange ohne offene Fehler | 0 |
| mindestens ein Snapshot nach dem Lauf `failed`, `blocked` oder `exhausted` | 6 |
| Halt | 4, hat Vorrang vor 6 gemäss §6.4 |

**`ipa skip <id> --reason <text>`**

- Nimmt den Lock.
- Nur für offene Snapshots erlaubt, sonst Exit-Code 2.
- Schreibt `skip.json`, führt den Cursor nach und protokolliert den Lauf.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/analysis/`
  - `prompts/analyze-work.md`
  - `schemas/analysis-input.schema.json`, `analysis-output.schema.json`, `analysis-record.schema.json`, `complete.schema.json`, `skip.schema.json`, `retry.schema.json`
- Erweitert: `src/cli/` (`capture`, `skip`, `status`)
- Schnittstellen:
  - `analysisStatus`, `processQueue`, `buildAnalysisInput`, `validateAnalysisOutput`, `renderWorkLog` (spec.md §10)
  - Datenmodelle §9.6 bis §9.9

## 6. Fehler- und Randfälle

- Claude meldet `implemented` nur mit `commit_message`-Belegen: R-02 wird verletzt, Ergebnis `rule_violation`.
- `tests.result = passed` mit einem `test_report`, der `fresh: false` hat: R-03 wird verletzt.
- `rationale` ohne Notiz- oder Commit-Nachrichten-Beleg: R-04 wird verletzt.
- Die Beleg-ID `E999` existiert nicht: `evidence_invalid`.
- Zwei offene Snapshots, der erste scheitert: Der zweite wird in diesem Lauf nicht verarbeitet.
- `exhausted`, dann `--retry`: Der nächste Lauf versucht es erneut.
- `blocked`, dann wird das Limit in `config.json` erhöht: Der nächste Lauf verarbeitet den Snapshot.
- `skip` auf einen bereits abgeschlossenen Snapshot: Exit-Code 2.
- Das Schreiben von `analysis.json` scheitert, zum Beispiel weil die Platte voll ist (simuliert): Der Snapshot bleibt offen, der Cursor bleibt unverändert, und das Versuchsergebnis wird protokolliert.
- Paralleler `capture`: Exit-Code 3 ohne Seiteneffekte im Arbeitsbereich ausser dem `runs.jsonl`-Eintrag.
- Eine Notiz mit `secretSuspected` verweist auf den Snapshot: Sie wird nicht übermittelt und nur gezählt.
- Die Kontextdatei fehlt: Sie wird mit Grund `unreadable` gezählt, ein Abbruch erfolgt nicht.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-06-01 | Nach einer Änderung erzeugt `ipa capture` mit Fake-CLI einen Snapshot, ein schemagültiges `analysis.json`, `logs/<id>.md` mit Beleg-IDs und `complete.json`. Danach gilt `state.lastAnalysedSnapshotId = <id>`, und `lastCommit` ist gesetzt. |
| AK-06-02 | Bei unverändertem Zustand ohne offene Analysen ruft `ipa capture` die Fake-CLI nicht auf (Aufrufzähler 0) und erzeugt keinen Log. |
| AK-06-03 | Bei unverändertem Zustand mit einem offenen Snapshot wird genau dieser analysiert. |
| AK-06-04 | Für jede Fehlerklasse der Fake-CLI bleibt der Snapshot offen, der Cursor unverändert, `outcome.json` und `response.json` existieren, und der Exit-Code ist 6. Der nächste Lauf versucht erneut. Nach `maxAttemptsPerSnapshot` Fehlversuchen ist der Status `exhausted`, es folgt kein weiterer Aufruf. `--retry <id>` erlaubt einen neuen Versuch. |
| AK-06-05 | Antworten mit Schemafehler, unbekannter Beleg-ID oder Verstoss gegen R-02, R-03, R-04 oder R-05 werden abgelehnt (`validation_failed`) und erscheinen weder in `analysis.json` noch im Log. |
| AK-06-06 | Abbruch über `afterCompleteMarker`: Der nächste Lauf führt den Cursor ohne Claude-Aufruf nach. Es gibt genau einen Log und genau eine Abschlussmarkierung. |
| AK-06-07 | Abbruch über `afterAnalysisWritten` oder `afterLogWritten`: Der nächste Lauf verarbeitet den Snapshot erneut unter denselben Pfaden. Danach existiert genau ein Log. |
| AK-06-08 | Zwei offene Snapshots werden in aufsteigender Reihenfolge verarbeitet. Scheitert der erste, wird der zweite nicht aufgerufen. |
| AK-06-09 | Ein Eingabepaket über dem Limit führt zu `blocked` ohne Claude-Aufruf und ohne Kürzung, mit Exit-Code 6 und einer Meldung, die das Limit nennt. Nach Erhöhung des Limits wird der Snapshot verarbeitet. |
| AK-06-10 | `input.json` enthält weder Inhalte noch Pfade ausgeschlossener Dateien noch zurückgehaltene Inhalte. Die Suche nach dem Secret-Marker und dem ausgeschlossenen Pfad in allen `attempt-*`-Dateien bleibt ohne Treffer. `filterSummary` zählt die Fälle. |
| AK-06-11 | Das Eingabepaket enthält genau die Notizen aus dem Beobachtungszeitraum und solche mit Referenz auf den Snapshot, ohne Notizen mit `secretSuspected`. `provenance.notesUsed` enthält deren SHA-256. |
| AK-06-12 | Ausgangs-Snapshot und Snapshot mit reinen Statusänderungen werden ohne Claude-Aufruf mit deterministischem Log abgeschlossen. Der Ausgangs-Log ist als Ausgangslage gekennzeichnet. |
| AK-06-13 | `ipa skip <id> --reason …` setzt den Status `skipped` und führt den Cursor weiter. `ipa status` zeigt den Snapshot als übersprungen. Für abgeschlossene Snapshots gilt Exit-Code 2. |
| AK-06-14 | Ein paralleler zweiter `capture` endet mit Exit-Code 3 und verändert weder Snapshots noch Analysen noch `state.json`. |
| AK-06-15 | Der Work-Log enthält Hinweis, alle Abschnitte in fester Reihenfolge, „nicht erfasst“ bei leeren Listen und die Belegtabelle. Ein Snapshot-Test prüft einen festen Beispiel-Log. |
| AK-06-16 | Bei aktivem Halt verarbeitet `capture` offene Snapshots und endet danach mit Exit-Code 4. |
| AK-06-17 | `prompts/analyze-work.md` enthält die Regeln aus Konzept §10 und §15. Ein Test prüft die Kernaussagen per Schlüsselsatz. `promptVersion` steht in `analysis.json` und in `ai-usage.jsonl`. |
| AK-06-18 | Der Repository-Fingerprint bleibt unverändert. `ipa status --json` enthält `analyses`, und `ipa --help` listet `skip`. |

## 8. Notwendige Tests und Validierung

- Unit-Tests:
  - Validator: jede Regel mit positivem und negativem Beispiel
  - Statusableitung aus konstruierten Ordnern
  - Cursor-Regel
  - Renderer als Snapshot-Test
  - Eingabepaket aus einem festen Manifest
- Integrationstests mit Test-Repository und Fake-CLI für AK-06-01 bis AK-06-18
- Die Abbruchtests nutzen die Hooks aus spec.md §10, nicht Umgebungsvariablen.
- Live-Test (`npm run test:live`, nach Freigabe): eine echte Analyse eines kleinen künstlichen Repositorys. Das Ergebnis ist schemagültig und besteht die Regelprüfung. Die Ausgabe wird stichprobenweise inhaltlich geprüft und das Ergebnis in der Checkliste vermerkt.

## 9. Offene Annahmen

- Die Standardwerte für `maxTurns` (5) und `maxAnalysesPerRun` (5) sind geschätzt. Der Live-Test prüft, ob fünf Turns für die strukturierte Ausgabe genügen. Abweichungen werden in spec.md §18 eingetragen.
