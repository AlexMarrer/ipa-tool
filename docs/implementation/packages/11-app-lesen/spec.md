# Paket 11 – App Lesen

Die Spezifikation der App steht in `docs/app/spec.md` (hier `app/spec.md §…`). Die Verträge des CLI stehen in `docs/implementation/spec.md` (`spec.md §…`). Dieses Dokument verweist nur darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Alle Leseansichten der App auf dem Gerüst aus Paket 10: Tagesansicht mit Zeitstrahl und Kalender, Work-Logs, Notizenliste, Journal lesen, Projektübersicht mit Halt-Banner und Claude-Warnung, gerendertes Markdown mit Referenz-Chips und KI-Etiketten, Live-Aktualisierung. Die App zeigt, was das CLI geschrieben hat, und verändert nichts. Aktionen folgen in Paket 12.

## 2. Umfang

| Thema | Abschnitt |
| --- | --- |
| Lesen, Validieren, Beobachten, Öffnen von Dateien | `app/spec.md §3.8`, `§4.2`, `§4.3` |
| Ansichtsmodelle: Tag, Analyse-Status, Tageszuordnung, Notizen, Zeitwerte, Hinweise, Belegliste, Referenz-Index, Lauf-Verlauf | `app/spec.md §5.2` bis `§5.8` |
| Tagesansicht (Kopf, Kalender, Zusammenfassung, Hinweise, Zeitstrahl, Tabs) | `app/spec.md §8.3` |
| Work-Logs (Liste, Anzeige, Ersatzansicht, Zustände; ohne die Aktionen Erneut versuchen und Überspringen) | `app/spec.md §8.4` |
| Notizenliste (Tab) | `app/spec.md §8.6` |
| Journal lesen (Entwurfsliste, Anzeige, Gliederung, Aktionen Öffnen und Kopieren, leerer Zustand) | `app/spec.md §8.5` |
| Projektübersicht, Halt-Banner (Anzeige), Claude-Warnung (Anzeige), Seitenleistenstatus | `app/spec.md §8.2`, `§5.1` |
| Zustände, Chips und Texte | `app/spec.md §9.2`, `§9.4`, `§9.5`, `§9.6` |
| Markdown: Sicherheit, Elemente, Etiketten, Referenz-Chips, Links | `app/spec.md §11` |
| Vertraulichkeit der Anzeige | `app/spec.md §12.6` |

Nicht im Umfang: Aktionen (Jetzt erfassen, Journal erzeugen, Erneut versuchen, Überspringen, Ausgangspunkt, Prüfen, Notiz anlegen); die Schaltflächen erscheinen mit ihren Zuständen erst in Paket 12. Zeitplan-Kurzstatus in der Übersicht liest `schedule status` (Paket 13 liefert die Seite). Diff-Ansicht (Nicht-Ziel, `app/spec.md §14`).

## 3. Voraussetzungen

- Paket 10 ist im Code vorhanden, seine Tests sind grün.
- Arbeitsbereiche für Tests erzeugt das echte CLI mit der Fake-CLI in temporären Datenwurzeln; die Fixtures decken alle Analyse-Status, Halt, Lücken, unklare Tageszuordnung, zurückgehaltene Notizen und Journal-Entwürfe mit und ohne KI ab.
- Claude wird nicht aufgerufen.

## 4. Akzeptanzkriterien

AK-10-17 bis AK-10-35 (`app/spec.md §16`, Abschnitt „Paket 11“). Die Artboards der Gruppen `Main`, `Tagesansicht-Kalender`, `WorkLog*`, `Notizen*`, `Journal*` (ohne Fehlerzustand), `Uebersicht*` und `Halt-*` sind abgedeckt (`app/spec.md` Anhang A).

## 5. Tests und Validierung

Nach `app/spec.md §17`: Reader-Tests gegen Arbeitsbereiche des echten CLI und gegen gezielt beschädigte Dateien; Vergleich der Ableitungen mit `ipa status --json` (AK-10-18); Komponententests aller Zustände in beiden Themes (Zustandsgalerie); Markdown-Sicherheitstest mit feindlichem Dokument (AK-10-28); Text-Vergleich der Darstellung mit den Quelldateien (AK-10-29); Prüfung des Repository- und Arbeitsbereich-Fingerprints nach dem Lesen (AK-10-35).

## 6. Offene Punkte

AO-12 (Zuverlässigkeit von `fs.watch`, Messung hier), AO-14 und AO-16 (Rückgabe der Abweichungen an das Design); siehe `app/spec.md §13`, `§18`. Klärungen gehören in `app/spec.md §19`.
