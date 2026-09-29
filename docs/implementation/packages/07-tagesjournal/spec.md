# Paket 07 – Tagesjournal

Die gemeinsamen Verträge stehen in `docs/implementation/spec.md`. Dieses Dokument verweist mit `spec.md §…` auf sie und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

`ipa journal [--day <YYYY-MM-DD>] [--no-ai]` erzeugt für einen Tag einen belegten Journal-Entwurf als neue Markdown-Datei mit JSON-Datensatz. Eingaben sind abgeschlossene Analysen, Commits, Notizen, Planung und Kontext.

Der Entwurf:

- funktioniert auch an Tagen ohne Codeänderungen
- weist Zeiten nur aus Notizen aus, getrennt nach gemessen und geschätzt
- zeigt offene Analysen, Lücken und unklare Tageszuordnungen

Vorhandene Entwürfe und persönliche Endfassungen bleiben unberührt.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/journal/`:
  - Tageseingabe (§9.10) mit Tageszuordnung (§15)
  - deterministische `timeSummary` (§15)
  - `openItems` aus Analysestatus, `gaps` der Manifeste, `runs.jsonl`-Fehlern des Tages und fehlender Aufnahme am Tag
  - Validator (R-01, R-03, R-04, R-06, R-07 für die Journal-Ausgabe)
  - Markdown-Renderer
  - `--no-ai`-Modus (D-14)
- Prompt `prompts/journal.md` (`journal@1`, §13.5)
- Schemas `journal-input`, `journal-output`, `journal-record`
- Befehl `ipa journal`, ohne Lock (D-16)
- README: Tagesabschluss gemäss Konzept §18, manuelle Übernahme nach `journal/final/`, Sicherung (O-07)

Nicht im Umfang:

- Freigabebefehl, Versionierung oder Zusammenführen von Entwürfen
- Schulspezifisches Format (O-04)
- Automatischer Journal-Lauf über den Scheduler (Konzept §12: bewusst manuell)

## 3. Voraussetzungen und abhängige Pakete

- Paket 04 ist abgeschlossen (Notizen).
- Paket 05 ist abgeschlossen (`ClaudeRunner`, `ensureClaudeReady`).
- Paket 06 ist abgeschlossen (Analysen, Status, Logs).

## 4. Zu implementierendes Verhalten

**Tag bestimmen**

- Standard ist der heutige Tag in der konfigurierten Zeitzone.
- Ein ungültiges Format führt zu Exit-Code 2.

**Eingabe sammeln**

1. **Snapshots:** alle Arbeits-Snapshots, deren `observedPeriod` den Tag berührt, mit `dayAttribution` gemäss §15.
2. **Analysen:** Für abgeschlossene Snapshots wird die Analyse als `derived` mit qualifizierten Beleg-IDs übernommen, zum Beispiel `E001` → `S000004:E001`.
3. **Status nicht abgeschlossener Snapshots:**
   - Snapshots mit Status `pending`, `failed`, `blocked`, `exhausted` oder `skipped` kommen nach `openItems.analyses`.
   - Deterministisch abgeschlossene Snapshots (`not_required`) liefern ihre Statusänderungen und Commits, aber keine `derived`-Aussagen.
4. **Belege:** `evidence` enthält nur Beschreibungen (Art, Pfad, Commit, Snapshot).
5. **Commits:** Commits aus diesen Snapshots mit geprüfter Nachricht. Zurückgehaltene Nachrichten erscheinen nur als Referenz.
6. **Notizen:** alle Notizen mit `activityDay` gleich dem Tag, ohne Notizen mit `secretSuspected` (diese werden gezählt). Notizen vom Typ `plan` erscheinen unverändert, ihr Typ zeigt die Planung an.
7. **Kontext:** geprüft wie in Paket 06.
8. **Zeitübersicht:** `timeSummary` gemäss §15.
9. **Offene Punkte:** `openItems.gaps`:
   - Lücken aus Manifesten (`rebaseline`, `halt_detected`, `previous_state_unavailable`)
   - erkannte Halts
   - `unstable`- und Fehlerläufe des Tages aus `runs.jsonl`
   - „keine Aufnahme an diesem Tag“, wenn kein Snapshot den Tag berührt
10. **Grenze:** Eingaben über `limits.maxJournalInputBytes` führen zu Exit-Code 6 mit Hinweis auf `--no-ai`. Nichts wird gekürzt.

Frühere Journal-Entwürfe werden nie gelesen (I-10).

**KI-Modus**

- `journal/runs/<runId>/` wird angelegt und `ClaudeRunner` wie in Paket 06 aufgerufen.
- Die Antwort wird validiert.
- Bei Fehler:
  - Exit-Code 6, es entsteht kein Entwurf.
  - `outcome.json` und `response.json` bleiben im Laufordner.
  - Die Meldung weist auf `--no-ai` hin.

**Ohne KI** (`--no-ai`), und automatisch, wenn weder Snapshots noch Notizen den Tag betreffen:

- Kein Claude-Aufruf.
- Die inhaltlichen Abschnitte zeigen die Notizen nach Typ gruppiert und die `derived`-Aussagen der Analysen mit ihren Belegen, gekennzeichnet als „aus Work-Log übernommen“.
- `mode: no_ai`.

**Entwurf schreiben**

- `journal/drafts/<day>-<runId>.json` (§9.10) und `.md` exklusiv anlegen (I-09).
- `sources` listet jede zitierte Referenz mit Art, Pfad, Snapshot und SHA-256.

**Markdown-Aufbau**

Kopf:

- Tag, Erstellzeit, `runId`, Modus
- Modelle und Prompt-Version
- Hinweis: „KI-generierter Entwurf – persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen.“

Abschnitte in dieser Reihenfolge:

1. Geplante Arbeiten
2. Ausgeführte Arbeiten
3. Probleme und Lösungen
4. Entscheidungen
5. Tests
6. Abweichungen von der Planung
7. Erkenntnisse
8. Nächste Schritte
9. Zeitaufwand (deterministische Tabelle; Summen gemessen und geschätzt getrennt; Verzögerungen separat mit dem Hinweis „nicht zusätzlich summiert“; Notizen ohne Zeit als „Zeit unbekannt“)
10. Unklare Tageszuordnung
11. Offene Analysen und Erfassungslücken
12. Unbekannt/offen
13. Quellen

Weitere Regeln:

- Aussagen enden mit Referenzen in eckigen Klammern.
- Leere Abschnitte erscheinen als „nicht erfasst“ (I-13).
- Tests ohne frischen Bericht erscheinen als „Ergebnis unbekannt“. Der Zusatz „getesteter Codezustand nicht nachgewiesen“ steht bei jedem Testergebnis.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/journal/`
  - `prompts/journal.md`
  - `schemas/journal-input.schema.json`, `journal-output.schema.json`, `journal-record.schema.json`
- Erweitert: `src/cli/` (`journal`)
- Genutzt: `readNotes`, `analysisStatus`, `readManifest`, `ClaudeRunner` und die Datenmodelle aus §9.10 und §15
- Schnittstelle: `generateJournal` (spec.md §10)

## 6. Fehler- und Randfälle

- Tag ohne Snapshots, nur mit Notizen zu Recherche: Der Entwurf entsteht. Zeiten stammen nur aus den Notizen.
- Tag ohne Snapshots und ohne Notizen: `--no-ai`-Entwurf mit „keine Belege erfasst“ und der Lücke „keine Aufnahme“.
- Snapshot von 16:00 bis 09:00 am Folgetag: Er erscheint an beiden Tagen unter „Unklare Tageszuordnung“ und nicht als ausgeführte Arbeit.
- Zwei Journal-Läufe in derselben Sekunde: Die `runId` unterscheiden sich, beide Entwürfe entstehen.
- `journal/final/<day>.md` existiert: Die Datei bleibt byte-gleich, und das Tool liest sie auch nicht.
- Claude zitiert eine Notiz eines anderen Tages: R-01 wird verletzt, weil die Notiz nicht in `allowedEvidenceIds` steht.
- Claude meldet einen Test als `passed` ohne frischen Bericht: R-03 wird verletzt.
- Die Notizdatei des Tages enthält eine beschädigte Zeile: Sie wird im Abschnitt „Offene Analysen und Erfassungslücken“ gemeldet.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-07-01 | An einem Tag mit abgeschlossener Analyse und Notizen erzeugt `ipa journal` mit Fake-CLI einen Entwurf `.md` und `.json`. Alle Abschnitte stehen in der festen Reihenfolge, und jede Referenz löst sich in `sources` auf. |
| AK-07-02 | An einem Tag nur mit Notizen (Recherche, 45 min gemessen, 30 min geschätzt, 20 min Verzögerung) entsteht ein Entwurf. Die Zeittabelle zeigt 45 gemessen und 30 geschätzt getrennt, die Verzögerung separat. Es gibt keine Gesamtsumme mit Verzögerung und keine Zeit aus Snapshots oder Commits. |
| AK-07-03 | Ein zweiter Lauf erzeugt einen neuen Entwurf. Frühere Entwürfe und eine vorhandene `journal/final/<day>.md` sind nach beiden Läufen byte-gleich. |
| AK-07-04 | `input.json` eines Journal-Laufs enthält keine Inhalte früherer Entwürfe. Ein Test legt einen Entwurf mit Marker-Text an und sucht ihn in der Eingabe. Alle `allowedEvidenceIds` sind Original-Belege, Notizen oder Kontext. |
| AK-07-05 | Ein Snapshot über zwei Tage erscheint an beiden Tagen nur unter „Unklare Tageszuordnung“. |
| AK-07-06 | Offene, blockierte, erschöpfte und übersprungene Analysen, Lücken nach `baseline` und Tage ohne Aufnahme erscheinen im Abschnitt „Offene Analysen und Erfassungslücken“. |
| AK-07-07 | Bei einem Fehler der Fake-CLI endet der Lauf mit Exit-Code 6, und es entsteht kein Entwurf. `ipa journal --no-ai` erzeugt dann ohne Claude-Aufruf einen Entwurf mit `mode: no_ai`. |
| AK-07-08 | Antworten mit unbekannter Referenz, mit `passed` ohne frischen Bericht, mit Begründung ohne Notiz- oder Commit-Beleg oder mit `done` ohne passenden Beleg werden abgelehnt. |
| AK-07-09 | Leere Abschnitte erscheinen als „nicht erfasst“. Eine geänderte Testdatei ohne Bericht erscheint als „Ergebnis unbekannt“. |
| AK-07-10 | Inhalte des Ausgangs-Snapshots erscheinen nicht unter „Ausgeführte Arbeiten“. |
| AK-07-11 | Ohne `--day` gilt der heutige Tag in der Zeitzone, geprüft mit injizierter Uhr um 23:30 UTC. Ein ungültiges `--day` führt zu Exit-Code 2. `ipa --help` listet `journal`. |
| AK-07-12 | `prompts/journal.md` enthält die Zusatzregeln aus spec.md §13.5. Eine Journal-Zeile steht in `ai-usage.jsonl`, und der Repository-Fingerprint bleibt unverändert. |

## 8. Notwendige Tests und Validierung

- Unit-Tests:
  - Tageszuordnung
  - `timeSummary`
  - Validator mit jeder Regel positiv und negativ
  - Renderer als Snapshot-Test
  - `--no-ai`-Renderer
- Integrationstests mit Test-Repository, Notizen und Fake-CLI für AK-07-01 bis AK-07-12. Tage werden mit injizierter Uhr erzeugt.
- Live-Test nach Freigabe: ein Journal für einen künstlichen Testtag. Die Ausgabe wird stichprobenweise auf belegte Aussagen geprüft und das Ergebnis in der Checkliste vermerkt.

## 9. Offene Annahmen

- Das Journalformat ist neutral gewählt (O-04). Eine spätere Anpassung betrifft nur Renderer und Prompt, nicht die Datenmodelle.
