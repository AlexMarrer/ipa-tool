# Paket 13 – App Zeitplan und Konfiguration

Die Spezifikation der App steht in `docs/app/spec.md` (hier `app/spec.md §…`). Die Verträge des CLI stehen in `docs/implementation/spec.md` (`spec.md §…`). Dieses Dokument verweist nur darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Die Seiten Zeitplan und Konfiguration eines Projekts: Zustand und Verwaltung der Windows-Aufgabe mit Vorschau der Läufe und der Obergrenze der Claude-Aufrufe, und die Konfiguration in allen acht Gruppen mit Validierung gegen das Schema des CLI, dem Gefahrenbereich für kostenpflichtige Nutzung und „Pfad testen“. Die App schreibt `config.json` nie selbst, sondern über `ipa config set`.

## 2. Umfang

| Thema | Abschnitt |
| --- | --- |
| Befehle `schedule …` und `config …` mit Ergebnisfeldern und Exit-Codes | `app/spec.md §4.1` |
| Zeitplan: Status-Karte, Formular, Vorschau, Aktionen, Lösch-Dialog, Hinweise, Lauf-Verlauf | `app/spec.md §8.10` |
| Konfiguration: Navigation, Speichern-Leiste, alle acht Gruppen | `app/spec.md §8.11` |
| Vorschau über `config set --dry-run` (AD-09), Wiederverwendung von Pfadfilter und Secret-Scanner | `app/spec.md §2` (AD-09, AD-07), `§3.8` |
| Zeitplan-Zustände, Fehlerzustände, Texte | `app/spec.md §9.1`, `§9.5`, `§9.6` |
| Kostenschutz (`allowPaidUsage`, zweistufige Bestätigung) | `app/spec.md §8.11`, `§12.3` |
| KI-Markierung bei „Jetzt auslösen“, Sperren | `app/spec.md §12.1`, `§12.2`, `§3.7` |
| Sprung „Zur Konfiguration“ aus dem Work-Log bei `blocked` | `app/spec.md §8.4` |

Nicht im Umfang: eine eigene Berechnung des Läufeplans in der App; globale Standardwerte (`app/spec.md §12.4`); Ändern der Zeitzone nach `init`; Änderungen am CLI. Der Sprung „Zeitplan einrichten“ aus dem Assistenten gehört zu Paket 14.

## 3. Voraussetzungen

- Paket 12 ist im Code vorhanden, seine Tests sind grün (Laufanzeige, Sperren, Bestätigungsdialoge).
- Die Verwaltung der echten Aufgabenplanung ist **nicht** automatisch testbar: `schtasks` läuft in allen Tests über den Ersatz-Runner (`test/helpers/scheduler.ts`, AK-09-16). Die manuelle Prüfung (AK-09-17, AK-08-07, Teil von AK-10-80) bleibt dem Benutzer.
- Claude wird nicht aufgerufen.

## 4. Akzeptanzkriterien

AK-10-52 bis AK-10-68 (`app/spec.md §16`, Abschnitt „Paket 13“). Die Artboards der Gruppen `Zeitplan*` und `Konfiguration*` sind abgedeckt (`app/spec.md` Anhang A).

## 5. Tests und Validierung

Nach `app/spec.md §17`: Tests der Befehle `schedule` und `config` mit Ersatz-Runner und echtem CLI (auch `--dry-run` ohne Schreiben, Dateivergleich byte-genau, `config_changed`, `config_immutable`, `paid_usage_confirmation_required`); Komponententests aller Zustände in beiden Themes; Test von „Pfad testen“ gegen die Erfassung des CLI (AK-10-61); Test der Entprellung und des Verzichts auf eigene Berechnung (AK-10-54).

## 6. Offene Punkte

AO-11 (manuelle Prüfung der Aufgabenplanung, Datumsformate, Lauf auf `windowEnd`), AO-05 (interne CLI-Module), AO-16 (Texte des Designs); siehe `app/spec.md §13`, `§18`. Klärungen gehören in `app/spec.md §19`.
