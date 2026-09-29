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
| 01 – CLI-Grundlage | offen | [checklist](packages/01-cli-grundlage/checklist.md) | – |
| 02 – Snapshot-Erfassung | offen | [checklist](packages/02-snapshot-erfassung/checklist.md) | – |
| 03 – Änderungszuordnung | offen | [checklist](packages/03-aenderungszuordnung/checklist.md) | – |
| 04 – Notizen | offen | [checklist](packages/04-notizen/checklist.md) | – |
| 05 – Claude-Anbindung | offen | [checklist](packages/05-claude-anbindung/checklist.md) | – |
| 06 – Analyse-Pipeline | offen | [checklist](packages/06-analyse-pipeline/checklist.md) | – |
| 07 – Tagesjournal | offen | [checklist](packages/07-tagesjournal/checklist.md) | – |
| 08 – Zeitsteuerung und Abnahme | offen | [checklist](packages/08-zeitsteuerung-und-abnahme/checklist.md) | – |

- [ ] Paket 01 abgeschlossen
- [ ] Paket 02 abgeschlossen
- [ ] Paket 03 abgeschlossen
- [ ] Paket 04 abgeschlossen
- [ ] Paket 05 abgeschlossen
- [ ] Paket 06 abgeschlossen
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

- [ ] Claude-Vorabprüfung aus Paket 01 durchgeführt, Ergebnis in spec.md §18 (AK-01-18). Bei widerlegtem A-01 oder A-02 ist O-02 vor Paket 05 entschieden.
- [ ] Alle Annahmen A-01 bis A-08 in spec.md §18 als bestätigt oder widerlegt eingetragen
- [ ] Offene Entscheidungen O-02 bis O-08 mit dem Benutzer geklärt oder bewusst mit Standardwert belassen, Ergebnis in spec.md §18. O-01 ist bereits entschieden.
- [ ] Stichprobenprüfung „Beleg trägt Aussage“ für Work-Logs und Journale im Abnahmeprotokoll dokumentiert (AK-08-08)
- [ ] README im Repository-Root vollständig, ohne ungeprüfte Plattform- oder Schutzzusagen (AK-08-09)
- [ ] Organisatorische Klärungen vor Einsatz in der echten IPA (O-03, Konzept §14) durch den Benutzer bestätigt
