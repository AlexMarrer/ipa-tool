# Paket 08 – Zeitsteuerung und Abnahme

Die gemeinsamen Verträge stehen in `docs/implementation/spec.md`. Dieses Dokument verweist darauf mit `spec.md §…` und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Mit diesem Paket kann `ipa capture` unbeaufsichtigt über den Scheduler des Betriebssystems laufen:

- `--scheduled` prüft das Arbeitszeitfenster in der konfigurierten Zeitzone.
- Eine Laufzeitgrenze verhindert endlose Läufe.
- `ipa schedule` erzeugt eine Vorlage für die Windows-Aufgabenplanung und eine als ungeprüft gekennzeichnete cron-Zeile.

Ausserdem wird V1 mit echten Claude-Aufrufen an einem künstlichen Test-Repository gegen alle Abnahmefälle aus Konzept §17 geprüft. Die Ergebnisse stehen in einem Abnahmeprotokoll.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/schedule/`:
  - Fensterprüfung für `capture --scheduled` (spec.md §11.1, D-15)
  - Vorlagen-Generator
- Aktivierung von `limits.maxRunSeconds`: Das CLI übergibt `deadline = Laufbeginn + maxRunSeconds` an `processQueue`. Nach der Frist wird kein neuer Claude-Aufruf gestartet. Die übrigen Snapshots bleiben offen.
- Befehl `ipa schedule --os <windows|cron> [--output <datei>]`
- Abnahmeprotokoll `docs/abnahme/v1-abnahmeprotokoll.md` mit allen Fällen aus Konzept §17, Durchführung, Ergebnis und Nachweis
- Abschliessendes README:
  - Installation und Verwendung mit mehreren Repositories, Speicherort mit Standard und `--workspace`, Trennung vom Claude-Arbeitsverzeichnis
  - alle Befehle und Exit-Codes
  - Scheduler-Einrichtung unter Windows
  - Grenzen: Schutzwirkung, Secret-Erkennung, Plattformen, Erfassungslücken
  - Sicherung (O-07)

Nicht im Umfang:

- Automatisches Installieren von Aufgaben, `systemd`- oder `launchd`-Vorlagen
- Automatischer Journal-Lauf
- Neue fachliche Funktionen. Findet die Abnahme Fehler in früheren Paketen, werden sie im Protokoll erfasst. Kleine Korrekturen sind mit Test erlaubt und werden in spec.md §18 vermerkt. Grössere Korrekturen werden dem Benutzer gemeldet.

## 3. Voraussetzungen und abhängige Pakete

- Paket 06 ist abgeschlossen (Warteschlange mit `deadline`-Parameter).
- Paket 07 ist abgeschlossen (Journal für die Abnahme).
- Für die Live-Abnahme ist die ausdrückliche Freigabe des Benutzers für echte Claude-Aufrufe nötig.
- Für den Scheduler-Test braucht es eine Windows-11-Sitzung des Benutzers.

## 4. Zu implementierendes Verhalten

**`ipa capture --scheduled`**

- Vor jeder anderen Aktion, auch vor dem Lock, wird geprüft:
  - Wochentag in der konfigurierten Zeitzone liegt in `schedule.workdays`
  - lokale Uhrzeit liegt in `[windowStart, windowEnd]`
- Liegt der Zeitpunkt ausserhalb, endet der Lauf mit Exit-Code 0, ohne Ausgabe auf stdout und mit einem `runs.jsonl`-Eintrag mit `outcome: outside_window`.
- Ohne `--scheduled` gibt es keine Fensterprüfung.

**`ipa schedule --os windows`**

Erzeugt ein XML für die Windows-Aufgabenplanung (Task-Schema 1.2+) mit diesen Eigenschaften:

- Aufgabenname `ipa-assistant-<repositoryId>`
- Trigger:
  - ein wöchentlicher `CalendarTrigger` pro Arbeitstag ab `windowStart`
  - Wiederholung alle `intervalMinutes` Minuten für die Dauer bis `windowEnd`
  - je ein zusätzlicher wöchentlicher Trigger pro Eintrag in `extraRunTimes`
- Aktion: absoluter Pfad von `process.execPath`, Argumente `"<absoluter Pfad zu dist/cli.js>" capture --scheduled --repo "<repoPath>"`, ergänzt um `--data-dir`, falls beim Aufruf gesetzt
- Einstellungen:
  - `MultipleInstancesPolicy IgnoreNew`
  - `StartWhenAvailable true`
  - `ExecutionTimeLimit` = `maxRunSeconds` + 10 min
  - `DisallowStartIfOnBatteries false`
  - Ausführung nur bei angemeldetem Benutzer (`InteractiveToken`), ohne höchste Rechte und ohne gespeichertes Passwort
- Kommentarblock mit Import-Befehl `schtasks /Create /XML <datei> /TN <name>`. Der Hinweis erwähnt:
  - Die Trigger nutzen die Systemzeit. Die fachliche Fensterprüfung erfolgt über `--scheduled`.
  - Ein Konsolenfenster kann kurz erscheinen (O-05).

**`ipa schedule --os cron`**

- Erzeugt eine crontab-Zeile mit absoluten Pfaden und `CRON_TZ=<timezone>`.
- Erster Kommentar: „nicht geprüft – Plattform in V1 nicht getestet“.

**Ausgabe**

- Standard ist stdout.
- Mit `--output <datei>` wird die Datei exklusiv angelegt. Existiert sie, endet der Befehl mit Exit-Code 2.
- `schedule` ändert keine Systemeinstellung.

**Abnahmeprotokoll**

- Pro Fall aus Konzept §17 und der zentralen Checkliste werden festgehalten:
  - Vorgehen mit den konkreten Befehlen an einem künstlichen Test-Repository
  - erwartetes und tatsächliches Ergebnis
  - Nachweis: Testname, Dateiauszug ohne Inhalte oder Befehlsausgabe
  - Datum, Claude-Version und Ergebnis `bestanden` oder `nicht bestanden` mit Begründung
- Zusätzlich eine stichprobenweise inhaltliche Prüfung: Tragen die Belege die Aussagen von mindestens drei Work-Log-Aussagen und drei Journal-Aussagen?
- Messungen aus der Probe-IPA wie Laufzeit, Verbrauch und Korrekturaufwand sind nicht Teil dieses Pakets. Das Protokoll enthält dafür einen leeren Abschnitt zur späteren Ergänzung.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/schedule/`
  - `docs/abnahme/v1-abnahmeprotokoll.md`
- Erweitert:
  - `src/cli/` (`capture --scheduled`, `schedule`)
  - Übergabe von `deadline` an `processQueue` (spec.md §10)
  - `README.md`
- Genutzt: `schedule` in der Konfiguration (§7.1), `runs.jsonl` (§9.11)

## 6. Fehler- und Randfälle

- Die Systemzeitzone weicht von `config.timezone` ab: Die Fensterprüfung nutzt die Konfiguration. Test mit injizierter Uhr und abweichender `TZ`-Umgebung.
- Wechsel zwischen Sommer- und Winterzeit am Arbeitstag
- `windowEnd` liegt vor einem Eintrag in `extraRunTimes`: Die Konfiguration ist gültig, aber `schedule` warnt, dass dieser Lauf durch `--scheduled` übersprungen würde.
- Die Frist läuft ab, während ein Claude-Aufruf läuft: Der Aufruf endet regulär oder per Timeout, danach startet kein weiterer.
- Der Rechner war zur geplanten Zeit ausgeschaltet: `StartWhenAvailable` startet nach. Der Lock verhindert Überschneidungen, und die Lücke bleibt über `observedPeriod` sichtbar.
- Pfade mit Leerzeichen in der XML-Aktion: korrekt gequotet und XML-escaped.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-08-01 | `capture --scheduled` am Samstag oder um 07:59 in `Europe/Zurich` (injizierte Uhr) endet mit Exit-Code 0, ohne Snapshot, ohne Claude-Aufruf und mit `outcome: outside_window`. |
| AK-08-02 | `capture --scheduled` am Dienstag um 10:00 verhält sich wie `capture`. |
| AK-08-03 | Die Fensterprüfung ist unabhängig von der Prozesszeitzone. Getestet wird mit `TZ=UTC` und `TZ=America/New_York` bei gleicher injizierter Uhr, jeweils mit gleichem Ergebnis, auch am Umstellungstag. |
| AK-08-04 | `ipa schedule --os windows` erzeugt wohlgeformtes XML mit Triggern gemäss Konfiguration, absoluten Pfaden zu Node und `dist/cli.js`, `--scheduled --repo`, `IgnoreNew`, `StartWhenAvailable` und `ExecutionTimeLimit`. `--output` auf eine vorhandene Datei ergibt Exit-Code 2. |
| AK-08-05 | `ipa schedule --os cron` erzeugt eine Zeile mit `CRON_TZ` und dem Kommentar „nicht geprüft“. |
| AK-08-06 | Ist die Frist bei der Warteschlangenverarbeitung erreicht, wird kein weiterer Claude-Aufruf gestartet. Die übrigen Snapshots bleiben `pending`. Der Exit-Code ist 0, sofern kein Snapshot `failed`, `blocked` oder `exhausted` ist. |
| AK-08-07 | **Manuell:** Die erzeugte Aufgabe wird unter Windows 11 importiert und einmal manuell ausgelöst. `runs.jsonl` enthält den Lauf. Ein zweiter gleichzeitiger Start wird verhindert, entweder durch den Scheduler oder durch Exit-Code 3. Das Ergebnis steht im Abnahmeprotokoll. |
| AK-08-08 | **Manuell, live, nach Freigabe:** Alle Abnahmefälle aus Konzept §17 sind an einem künstlichen Test-Repository mit echtem Claude durchgeführt und im Abnahmeprotokoll dokumentiert. Nicht bestandene Fälle sind begründet und als offene Punkte in der zentralen Checkliste eingetragen. |
| AK-08-09 | Das README ist vollständig gemäss Abschnitt 2 und behauptet keine ungeprüfte Plattformunterstützung und keinen weitergehenden Schutz als spec.md §13.4. |
| AK-08-10 | `ipa --help` listet `schedule`. Der Repository-Fingerprint bleibt in allen Tests unverändert. |

## 8. Notwendige Tests und Validierung

- Unit-Tests:
  - Fensterprüfung mit injizierter Uhr und `TZ`-Variation
  - XML-Generator (Wohlgeformtheit mit einem einfachen Parser oder einer Struktur-Prüfung ohne neue Abhängigkeit, Pflichtknoten, Escaping)
  - cron-Generator
- Integrationstests: `capture --scheduled` innerhalb und ausserhalb des Fensters, Fristverhalten mit Fake-CLI
- Manuelle Prüfungen gemäss AK-08-07 und AK-08-08, dokumentiert im Abnahmeprotokoll

## 9. Offene Annahmen

- O-05: Zeiten und das Verhalten des Konsolenfensters. Das Standardverhalten ist ein kurz sichtbares Fenster. Alternativen wie „unabhängig von der Anmeldung ausführen“ erfordern die Speicherung eines Passworts durch den Benutzer und sind nicht Teil der Vorlage.
