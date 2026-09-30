# IPA Assistant V1 – Übergreifender Fortschritt

Diese Datei zeigt den Stand aller Arbeitspakete und die Abnahme von Version 1. Die Details stehen in den Paketchecklisten. Ein Punkt wird erst abgehakt, wenn die Arbeit durchgeführt und geprüft ist. Planung allein ist kein Nachweis.

## Paketstatus

Statuswerte:

- `offen`
- `in Arbeit`
- `technisch abgeschlossen`: Alle automatisierten Punkte sind erledigt, offen sind nur manuelle Prüfungen oder Live-Prüfungen.
- `abgeschlossen`: Alle Punkte der Paketcheckliste sind erledigt.

Nachfolgende Pakete dürfen beginnen, sobald ihre Voraussetzungen mindestens `technisch abgeschlossen` sind.

| Paket | Status | Checkliste | Offene Punkte / Hinweis |
| --- | --- | --- | --- |
| 01 – CLI-Grundlage | abgeschlossen | [checklist](packages/01-cli-grundlage/checklist.md) | Live-Vorabprüfung am 29.09.2026 ausgeführt: A-02, A-03 und A-08 unklar wegen abgelehnter Anmeldung, Wiederholung vor Paket 05 empfohlen (spec.md §18). |
| 02 – Snapshot-Erfassung | abgeschlossen | [checklist](packages/02-snapshot-erfassung/checklist.md) | AK-02-16 mit echtem Symlink auf dem Entwicklungsrechner übersprungen (Windows ohne Entwicklermodus), D-20 dort über Junction geprüft. Git 2.31 oder neuer nötig. Anzeige zurückgehaltener Einheiten in `status` offen für Paket 06/07 (spec.md §18). |
| 03 – Änderungszuordnung | abgeschlossen | [checklist](packages/03-aenderungszuordnung/checklist.md) | Geprüft am 29.09.2026 unter Linux (Node.js 22, Git 2.43) und Windows (Node.js 24, Git 2.51). Vorbedingungsfehler AK-01-16 unter Linux behoben (spec.md §18). Junction-Test AK-02-16 an die Relevanzprüfung angepasst. |
| 04 – Notizen | technisch abgeschlossen | [checklist](packages/04-notizen/checklist.md) | Offen: manuelle Prüfung der interaktiven Eingabe in der Windows-Konsole mit Zeitmessung (Ziel unter einer Minute). Automatisch geprüft am 29.09.2026 unter Windows (357 bestanden, 1 übersprungen, nach der Korrektur für Node.js 24, spec.md §18) und unter Linux mit Node.js 22 und 24 (Git 2.43), die interaktive Eingabe zusätzlich in einem Linux-Pseudo-Terminal. `note` schreibt keinen Eintrag in `runs.jsonl` (spec.md §9.11, §18). |
| 05 – Claude-Anbindung | abgeschlossen | [checklist](packages/05-claude-anbindung/checklist.md) | Live-Prüfung am 29.09.2026 im Linux-Container (Claude Code 2.1.284) und auf dem Entwicklungsrechner (Windows 11, Claude Code 2.1.201) bestanden: nur `StructuredOutput`, keine MCP-Server, `--setting-sources` bestätigt. Tests: Linux mit Node.js 22 und 24 je 421 bestanden, Windows 423 bestanden. Update auf mindestens 2.1.205 empfohlen (O-02). `doctor` schreibt keinen Eintrag in `runs.jsonl`, `init` prüft Claude ohne Modellaufruf und warnt nur (spec.md §18). |
| 06 – Analyse-Pipeline | abgeschlossen | [checklist](packages/06-analyse-pipeline/checklist.md) | Geprüft am 29.09.2026 unter Linux mit Node.js 22 und 24 (je 467 bestanden, 4 übersprungen); Live-Analyse nach Freigabe im Linux-Container (Claude Code 2.1.285) und am 30.09.2026 auf dem Entwicklungsrechner (Windows) bestanden, dort erst nach neuer Anmeldung (HTTP 401 trotz `loggedIn: true`, spec.md §18); `maxTurns` 5 genügt. Empfohlen: `npm test` auf dem Entwicklungsrechner wiederholen. Halt (4) hat bei `capture` Vorrang vor 6; `status` zeigt `analyses` und `withheld` (spec.md §18). Tests früherer Pakete verwenden für reine Aufnahmen `capture --no-analysis`. |
| 07 – Tagesjournal | technisch abgeschlossen | [checklist](packages/07-tagesjournal/checklist.md) | Offen: Live-Journal eines künstlichen Tages nach Freigabe (`test/live/journal.live.ts`, ein Modellaufruf) mit Stichprobe der Belege. Geprüft am 30.09.2026 unter Windows (Node.js 24.19.0, Git 2.51): 64 Testdateien, 519 bestanden, 2 übersprungen. `journal` nimmt keinen Lock und schreibt keinen Eintrag in `runs.jsonl`; Belege von Snapshots mit unklarer Tageszuordnung sind nicht zitierbar; Planungszeiten zählen nicht zu den Summen; Test-Timeout 300 s wegen Last auf langsamen Rechnern (spec.md §18). |
| 08 – Zeitsteuerung und Abnahme | offen | [checklist](packages/08-zeitsteuerung-und-abnahme/checklist.md) | – |

- [x] Paket 01 abgeschlossen. Nachweis: 29.09.2026, alle Punkte der Paketcheckliste erledigt.
- [x] Paket 02 abgeschlossen. Nachweis: 29.09.2026, alle Punkte der Paketcheckliste erledigt.
- [x] Paket 03 abgeschlossen. Nachweis: 29.09.2026, alle Punkte der Paketcheckliste erledigt.
- [ ] Paket 04 abgeschlossen
- [x] Paket 05 abgeschlossen. Nachweis: 29.09.2026, alle Punkte der Paketcheckliste erledigt, Live-Prüfung auf dem Entwicklungsrechner bestanden.
- [x] Paket 06 abgeschlossen. Nachweis: 29.09.2026, alle Punkte der Paketcheckliste erledigt, Live-Analyse im Linux-Container bestanden; am 30.09.2026 auch auf dem Entwicklungsrechner (Windows).
- [ ] Paket 07 abgeschlossen
- [ ] Paket 08 abgeschlossen

## Abnahmematrix (Konzept §17)

Eine Zeile wird abgehakt, wenn alle genannten Akzeptanzkriterien nachgewiesen sind und der Fall im Abnahmeprotokoll `docs/abnahme/v1-abnahmeprotokoll.md` als bestanden steht (AK-08-08).

- [ ] **Initialisierung mit vorhandener Arbeit**: Die Ausgangslage ist gespeichert, eine rückwirkende Tagesleistung wird nicht erfunden. Nachweise: AK-02-01, AK-06-12, AK-07-10
- [ ] **Neue Datei, gestagte und ungestagte Änderungen**: Alle erlaubten Inhalte sind getrennt erfasst und später lesbar. Nachweise: AK-02-01, AK-02-02
- [ ] **Änderungen während der Aufnahme**: Die Aufnahme wird wiederholt oder sichtbar abgebrochen, ein gemischter Stand entsteht nicht. Nachweis: AK-02-09
- [ ] **Erfasste Änderung wird später committet**: Die Commit-Zuordnung wird ergänzt, die Umsetzung nicht doppelt gezählt. Nachweise: AK-03-03, AK-03-04, AK-06-05, AK-06-12
- [ ] **Unveränderter Zustand**: Es erfolgt kein KI-Aufruf, ausser für offene Analysen. Nachweise: AK-03-01, AK-03-02, AK-06-02, AK-06-03
- [ ] **Offline, Timeout oder ungültige KI-Antwort**: Der Snapshot bleibt offen, der Cursor unverändert. Nachweise: AK-05-03, AK-06-04, AK-06-05
- [ ] **Abbruch vor Cursor-Update**: Der Wiederanlauf erzeugt keinen Doppeleintrag. Nachweise: AK-02-10, AK-06-06, AK-06-07
- [ ] **Branchwechsel oder Rebase**: Die Zuordnung hält kontrolliert an, frühere Belege bleiben erhalten. Nachweise: AK-03-07, AK-03-08, AK-03-09, AK-03-10, AK-06-16
- [ ] **Nicht erlaubte Testdatei mit künstlichem Secret, auch in altem Diff**: Das KI-Paket enthält keinen solchen Inhalt, und der Ausschluss ist nachvollziehbar. Nachweise: AK-02-05, AK-02-06, AK-03-12, AK-06-10
- [ ] **Modell wird zu Änderungen am Projekt aufgefordert**: Es sind keine Schreib-, Shell- oder MCP-Werkzeuge verfügbar, und das Original ist durch die Analyseumgebung geschützt (Grenzen gemäss spec.md §13.4). Nachweise: AK-01-18 (Vorabprüfung), AK-05-01, AK-05-09, AK-06-21, AK-08-08 (Injektionsfall live mit Fingerprint-Vergleich)
- [ ] **Nur die eigenen Logs ändern sich**: Die eigenen Ausgaben werden nicht erneut als Entwicklungsarbeit dokumentiert, auch nicht mit Arbeitsbereich `.ipa/` im Repository. Nachweise: AK-02-19, AK-03-01, AK-03-15
- [ ] **Notizen zu Recherche ohne Commit**: Ein Journal-Entwurf ist möglich, Zeiten kommen nur aus den erfassten Angaben. Nachweise: AK-04-03, AK-07-02
- [ ] **Vorhandene Testdatei ohne Laufprotokoll**: Das Testergebnis bleibt unbekannt. Nachweise: AK-06-05 (R-03), AK-07-09, AK-03-11
- [ ] **Neues Journal wird erzeugt**: Die persönliche Endfassung und frühere Entwürfe bleiben erhalten. Nachweis: AK-07-03

## Übergreifende Punkte

- [x] Claude-Vorabprüfung aus Paket 01 durchgeführt, Ergebnis in spec.md §18 (AK-01-18). Bei widerlegtem A-01 oder A-02 ist O-02 vor Paket 05 entschieden. Nachweis: 29.09.2026, Claude Code 2.1.114. A-01, A-04 und A-05 bestätigt, A-02, A-03 und A-08 unklar (Anmeldung abgelehnt), keine Annahme widerlegt; O-02 daher nicht vorgezogen. Wiederholung in einem normalen Terminal nach neuer Anmeldung empfohlen.
- [ ] Alle Annahmen A-01 bis A-08 in spec.md §18 als bestätigt oder widerlegt eingetragen
- [ ] Offene Entscheidungen O-02 bis O-08 mit dem Benutzer geklärt oder bewusst mit Standardwert belassen, Ergebnis in spec.md §18. O-01 ist bereits entschieden.
- [ ] Stichprobenprüfung „Beleg trägt Aussage“ für Work-Logs und Journale im Abnahmeprotokoll dokumentiert (AK-08-08)
- [ ] README im Repository-Root vollständig, ohne ungeprüfte Plattform- oder Schutzzusagen (AK-08-09)
- [ ] Organisatorische Klärungen vor Einsatz in der echten IPA (O-03, Konzept §14) durch den Benutzer bestätigt
