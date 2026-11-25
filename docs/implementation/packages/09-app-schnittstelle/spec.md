# Paket 09 – App-Schnittstelle

Die gemeinsamen Verträge stehen in `docs/implementation/spec.md`. Dieses Dokument verweist darauf mit `spec.md §…` und wiederholt sie nicht. Wo dieses Paket einen gemeinsamen Vertrag erweitert, steht die Änderung in `spec.md` (§1.2, §1.3, §3.2 mit D-15 und D-26 bis D-28, §4.2, §6.2, §6.3, §6.5, §6.7, §8.4, §9.11, §10, §14.1, §16.2) und im Protokoll §18. Die Felder der JSON-Ausgabe stehen nur in `spec.md §6.7`.

## 1. Ziel und konkretes Ergebnis

Für die geplante Desktop-App (Electron, Windows 11) bekommt das CLI drei Ergänzungen. Die App startet CLI-Befehle im Hintergrund und liest die Dateien des Arbeitsbereichs direkt. Sie ist lesend ausgerichtet, nur Notizen werden neu angelegt. Das CLI bleibt der Motor. Die App selbst ist nicht Teil dieses Pakets.

1. **Maschinenlesbare Ergebnisse:** `--json` für `init`, `capture`, `journal`, `note`, `skip`, `baseline` und `doctor` als stabiler Vertrag wie bei `ipa status --json`, mit JSON-Schemas unter `schemas/`.
2. **`ipa config`:** `config.json` lesen, prüfen und atomar schreiben, mit allen inhaltlichen Prüfungen von `ipa schedule` und mit Schutz für Felder, die nach `init` nicht mehr ändern.
3. **Zeitplan-Verwaltung:** `ipa schedule install|status|pause|resume|remove|run` verwaltet die Aufgabe `ipa-assistant-<repositoryId>` in der Windows-Aufgabenplanung über `schtasks`. Eine gemeinsame Funktion berechnet die Läufe pro Arbeitstag und die Obergrenze der Claude-Aufrufe pro Tag.

Prinzipien der App (Design-Brief 2 und 6.6 bis 6.10), die dieses Paket einhält:

- **Sicher und sparsam als Standard:** Nichts startet Claude von selbst. `claude.allowPaidUsage` bleibt standardmässig aus und lässt sich nur mit einem ausdrücklichen Flag einschalten (§4.2).
- **Konfiguration pro Projekt:** Es gibt keine globalen Standardwerte. Die Befehle arbeiten immer mit der `config.json` des gewählten Repositorys.
- **Der Zeitplan bleibt in der Windows-Aufgabenplanung.** Die App verwaltet ihn nur über diese Befehle.

## 2. Umfang und Abgrenzung

Im Umfang:

- `--json` der sieben Aktionsbefehle mit gemeinsamer Hülle und einem Schema je Befehl (`schemas/cli-<befehl>.schema.json`)
- Befehl `ipa config get|check|set` mit `--json`
- Befehle `ipa schedule install|status|pause|resume|remove|run` mit `--json`
- `src/schedule/plan.ts`: Läufeplan und Obergrenze der Claude-Aufrufe
- `src/schedule/schtasks.ts`: austauschbarer Runner für `schtasks`, mit dem in Tests keine echte Aufgabenplanung angesprochen wird
- README, `spec.md`-Einarbeitung, Checkliste und Prompt dieses Pakets

Nicht im Umfang:

- die Desktop-App selbst und jede Oberfläche
- `--json` für `schedule --os …` (die Vorlage bleibt Text) und Änderungen an `ipa status --json`
- ein Befehl zum Testen von Pfaden gegen den Dateifilter (Design-Brief 6.10 „Pfad testen“) und ein Befehl zum Lesen von Work-Logs, Notizen oder Journalen. Die App liest diese Dateien direkt. Beides kann ein späteres Paket liefern.
- eine automatische Einrichtung des Zeitplans: Eine Aufgabe entsteht nur durch den ausdrücklichen Befehl `ipa schedule install`.
- Linux, macOS und cron-Verwaltung. `schedule --os cron` bleibt eine ungeprüfte Vorlage.
- globale Standardwerte oder das Übernehmen von Einstellungen auf andere Projekte
- Änderungen an Exit-Codes oder an der menschenlesbaren Standardausgabe

## 3. Voraussetzungen und abhängige Pakete

- Pakete 01 bis 08 sind vorhanden. Das Paket nutzt `resolveContext`, `loadConfig` und `writeConfig` (01), die Befehle der Pakete 01 bis 08, `runs.jsonl`-Ergebnisse (§9.11), `renderWindowsTask` und `scheduleWarnings` (08).
- Die manuelle Prüfung der echten Aufgabenplanung braucht eine Windows-11-Sitzung des Benutzers (AK-09-17).
- Claude wird für dieses Paket nicht echt aufgerufen. Es gibt keine Live-Tests.

## 4. Zu implementierendes Verhalten

### 4.1 Maschinenlesbare Ergebnisse (`--json`)

**Geltungsbereich:** `init`, `capture`, `journal`, `note`, `skip`, `baseline`, `doctor` sowie `config` und die Verwaltungsbefehle von `schedule`. `status --json` bleibt unverändert (§6.6) und trägt keine Hülle.

**Ausgabe mit `--json`:**

- stdout enthält genau ein JSON-Objekt (eingerückt, mit abschliessendem Zeilenumbruch) und sonst nichts. Die menschenlesbaren Zeilen entfallen auf stdout.
- stderr und der Exit-Code sind identisch zum Aufruf ohne `--json`. Warnungen, Hinweise und Fehlermeldungen erscheinen dort weiterhin und zusätzlich im Objekt.
- Ohne `--json` ändert sich nichts.
- Bedienungsfehler von Commander vor dem Start des Befehls (unbekannte Option, fehlender Wert) liefern kein JSON, nur stderr und Exit-Code 2. Alle anderen Fehler liefern die Hülle mit `result: null` (siehe unten).
- Pfade im Objekt sind absolut und verwenden `/` als Trennzeichen. Zeitstempel sind ISO 8601 mit Offset in der konfigurierten Zeitzone (§8.3).
- Das Objekt enthält nie Dateiinhalte, Notiztexte, Gründe, erkannte Secret-Werte oder Zugangsdaten (I-12). Notizen erscheinen nur mit ID, Typ, Tag, Zeiten und Verweisen.

**Hülle und Ergebnisse:** Die Felder der Hülle und des `result` jedes Befehls (`init`, `capture`, `journal`, `note`, `skip`, `baseline`, `doctor`, `config`, `schedule`) stehen verbindlich in `spec.md §6.7`. `outcome` und `errors` entsprechen dem Eintrag in `runs.jsonl` (§9.11), auch für Befehle, die dort nichts eintragen. Hinweise zu einem Befund, der schon als Feld im Ergebnis steht (zum Beispiel zu einer blockierten Analyse), erscheinen nur auf stderr; alle anderen Warnungen stehen auch in `warnings`.

**Besonderheiten:**

- `ipa note --json` braucht den Text als Argument. Ohne Text (interaktiver Modus) endet der Befehl mit Exit-Code 2, weil Rückfragen stdout belegen würden. Beginnt der Text mit `-`, steht vor ihm `--`.
- `doctor --json` mit nicht bestandener Prüfung endet mit Exit-Code 7 und liefert das Ergebnis mit `ok: false`. `errors` enthält dann den Code `doctor_failed`.
- Die Berechnung der Felder erfolgt aus den Ergebnissen der Befehle, nicht aus der Textausgabe. Die Schemas `schemas/cli-<befehl>.schema.json` (draft-07, `additionalProperties: false`) beschreiben die Hülle und das Ergebnis. Die Tests validieren jede Ausgabe gegen sie.

### 4.2 `ipa config`

Braucht ein initialisiertes Repository (Exit-Code 2 sonst). Nimmt keinen Lock und schreibt keinen Eintrag in `runs.jsonl`. Ein laufender `capture` behält die Konfiguration, mit der er gestartet wurde; Änderungen gelten ab dem nächsten Lauf.

**`ipa config get [<pfad>] [--json]`**

- Gibt `config.json` oder den Wert unter einem Pfad wie `claude.maxAnalysesPerRun` als formatiertes JSON aus. Pfade bestehen aus Feldnamen, getrennt durch Punkte. Arrays werden als Ganzes gelesen.
- Ein unbekannter Pfad ergibt Exit-Code 2. Ist `config.json` ungültig, endet der Befehl wie jeder andere mit Exit-Code 2 (§7.2).

**`ipa config check [--json]`**

- Prüft die vorhandene `config.json`, auch wenn sie ungültig ist, und meldet alle Befunde statt beim ersten abzubrechen. Exit-Code 0, wenn kein Befund die Schwere `error` hat, sonst 2.
- Prüfungen:
  1. gültiges JSON und Schema `schemas/config.schema.json` (Code `schema_invalid`, `json_invalid`)
  2. Regeln aus §7.2: Zeitzone, reguläre Ausdrücke, `windowStart` vor `windowEnd` (`timezone_unknown`, `pattern_invalid`, `window_order`)
  3. `repositoryId` und `repository.path` passen zum Registry-Eintrag (`config_mismatch`)
  4. die Zeitplanregeln von `ipa schedule` (§4.3): leere `schedule.workdays` (Schwere `error`, Code `schedule_no_workdays`); ein Zusatzlauf ausserhalb des Fensters, ein Intervall länger als das Fenster und ein `claude.timeoutSeconds` über der Reserve von 10 Minuten im `ExecutionTimeLimit` (Schwere `warning`, Codes `schedule_extra_outside_window`, `schedule_interval_exceeds_window`, `claude_timeout_exceeds_reserve`)
- Dieselben Prüfungen erscheinen in `ipa schedule --os …` als Warnungen. Der Text dort bleibt unverändert.

**`ipa config set <pfad=wert>… [--dry-run] [--confirm-paid-usage] [--json]`**

- Jede Zuweisung hat die Form `pfad=wert`. Der Wert ist JSON (`60`, `true`, `null`, `["mon","tue"]`, `{"…":…}`); ist er kein gültiges JSON, gilt er als Text (`claude.model=opus`). Eine Zuweisung ersetzt den Wert unter dem Pfad vollständig, auch bei Arrays und Objekten. Jeder Pfad ausser dem letzten Feld muss existieren. Ein neues Feld auf einem vorhandenen Objekt ist möglich, wenn das Schema es kennt (zum Beispiel `claude.allowPaidUsage` in einer älteren Konfiguration).
- Ablauf: `config.json` lesen, Zuweisungen auf eine Kopie anwenden, den Kandidaten prüfen wie `check` und nur bei fehlerfreiem Ergebnis schreiben. Bei einem Befund der Schwere `error` bleibt die Datei Byte für Byte unverändert (Exit-Code 2). Warnungen verhindern das Schreiben nicht, sie stehen im Ergebnis und auf stderr.
- **Atomar schreiben:** über `writeFileAtomic` (temporäre Datei im selben Ordner, danach `rename`, §8.5). Vor dem Umbenennen wird die Datei erneut gelesen. Hat sie sich seit dem ersten Lesen geändert, endet der Befehl mit Exit-Code 2 und `config_changed`, ohne zu schreiben. Eine neue Konfiguration entsteht also nur auf dem Stand, den der Befehl geprüft hat. Handänderungen an anderen Feldern bleiben erhalten, weil `set` nur die angegebenen Pfade ersetzt.
- `--dry-run` prüft und meldet das Ergebnis, schreibt aber nicht (Exit-Code wie beim Schreiben).
- **Nicht änderbar nach `init`:** `schemaVersion`, `repositoryId`, `repository.path` und `timezone`. Ein Kandidat, in dem eines dieser Felder vom gespeicherten Wert abweicht, ergibt Exit-Code 2 mit Code `config_immutable`, auch wenn die Zuweisung einen übergeordneten Pfad betraf. Ein unveränderter Wert ist erlaubt. Die Zeitzone legt fest, welchem Tag vorhandene Daten zugeordnet sind.
- **`claude.allowPaidUsage`:** Eine Änderung von nicht wahr auf `true` (auch durch eine Zuweisung auf `claude`) braucht das Flag `--confirm-paid-usage`. Ohne es endet der Befehl mit Exit-Code 2 und `paid_usage_confirmation_required`, ohne zu schreiben. Die Meldung erklärt, dass API-Schlüssel und externe Anbieter dann Kosten pro Anfrage verursachen können. Mit Flag erscheint zusätzlich die Warnung, dass kostenpflichtige Nutzung freigegeben ist. Das Flag erlaubt nur und erzwingt nichts: Es setzt den Wert nicht selbst, und es ändert nichts, wenn die Zuweisung ihn auf `false` setzt. Das Abschalten braucht kein Flag. Ein Standardlauf, `init` und jede andere Zuweisung lassen `allowPaidUsage` unberührt.
- Betrifft eine Zuweisung `schedule`, `limits.maxRunSeconds` oder `claude.timeoutSeconds`, erscheint ein Hinweis, dass eine bereits eingerichtete Aufgabe unverändert bleibt und `ipa schedule status` und `ipa schedule install --update` den Abgleich übernehmen.

Die Felder des `result` von `config` stehen in `spec.md §6.7`. Befunde tragen `severity` (`error` oder `warning`), `code`, den JSON-Pointer `path` und `message`; `schedulePlan` ist der Läufeplan der geprüften Konfiguration (§4.3), `null`, wenn der Zeitplan nicht auswertbar ist (Fensterreihenfolge).

### 4.3 Zeitplan-Verwaltung

**Läufeplan** (`src/schedule/plan.ts`, `planSchedule(schedule, maxAnalysesPerRun)`): eine einzige Funktion für `schedule status`, `schedule install`, `config check` und `config set`. Die Vorlagen (`renderWindowsTask`, `renderCron`) verwenden dieselben Startzeiten. Die Felder stehen in `spec.md §6.7`. Gezählt werden die Startzeiten im Fenster (`windowStart`, jedes Intervall bis einschliesslich `windowEnd`, Zusatzläufe im Fenster). Zusatzläufe ausserhalb des Fensters stehen in `skippedRunTimes` und zählen nicht, weil `capture --scheduled` sie überspringt. Ein Lauf genau auf `windowEnd` zählt **vorsichtig** mit (`includesWindowEndRun`), weil nicht beobachtet ist, ob die Aufgabenplanung ihn auslöst (Paket 08, §18). `maxClaudeCallsPerDay` ist eine Obergrenze: Ohne neue Arbeit ruft ein Lauf Claude nicht auf, und ein Journal wird nur von Hand erzeugt.

Beispiel mit den Standardwerten (§7.1): `runTimes` 08:00, 10:00, 12:00, 14:00, 16:00, 17:45 und 18:00, also 7 Läufe und höchstens 35 Claude-Aufrufe pro Arbeitstag. Ein Zusatzlauf um 18:30 steht in `skippedRunTimes` und zählt nicht.

**Austauschbarer Runner** (`src/schedule/schtasks.ts`): `SchtasksRunner` hat die Methode `run(args): Promise<{ exitCode, stdout, stderr }>`. Die Standardimplementierung startet `schtasks` mit `execFile`, ohne Shell, mit Argument-Array, Frist von 30 Sekunden und ausgeblendetem Fenster. Die Ausgabe von `schtasks` liegt in der OEM-Codepage der Konsole. Der Runner dekodiert sie als `latin1` und ersetzt jedes Zeichen ausserhalb von druckbarem ASCII durch `?`. Das CLI erhält den Runner über die Abhängigkeiten von `main(argv, io, deps)` (Standard: der echte Runner). Tests übergeben immer einen Ersatz. Kein Test spricht die echte Aufgabenplanung an, auch nicht lesend.

Die Befehle brauchen Windows (`process.platform === 'win32'`), sonst Exit-Code 2 mit Code `schedule_platform_unsupported`. Sie brauchen ein initialisiertes Repository, nehmen keinen Lock und schreiben keinen Eintrag in `runs.jsonl`. `--os` gehört nur zum bisherigen Aufruf: `ipa schedule --os windows|cron [--output]` bleibt unverändert und ruft `schtasks` nie auf.

**Befehle** (alle mit `--json`):

| Befehl | Wirkung |
| --- | --- |
| `ipa schedule status` | Liest die Aufgabe und meldet den Zustand. Ändert nichts. |
| `ipa schedule install [--update]` | Legt die Aufgabe an: `schtasks /Create /XML <datei> /TN <name>`. Die XML-Datei entsteht mit `renderWindowsTask` (UTF-16 mit BOM) im Ordner `<os.tmpdir()>/ipa-assistant/schedule/` und wird nach dem Aufruf gelöscht. Existiert die Aufgabe schon, endet der Befehl ohne `--update` mit Exit-Code 2 (`schedule_exists`). Mit `--update` ersetzt `/F` sie. Eine pausierte Aufgabe bleibt dabei pausiert (`<Enabled>false</Enabled>` in der Vorlage): Aktualisieren startet nichts. Fehlt `dist/cli.js`, endet der Befehl mit Exit-Code 2 (`schedule_cli_missing`); ist `schedule.workdays` leer, ebenfalls (`schedule_no_workdays`). |
| `ipa schedule pause` | `schtasks /Change /TN <name> /DISABLE`. Bereits pausiert: Exit-Code 0, `changed: false`. Nicht eingerichtet: Exit-Code 2 (`schedule_not_installed`). |
| `ipa schedule resume` | `schtasks /Change /TN <name> /ENABLE`. Bereits aktiv: Exit-Code 0, `changed: false`. Nicht eingerichtet: Exit-Code 2. |
| `ipa schedule remove` | `schtasks /Delete /TN <name> /F`. Nicht eingerichtet: Exit-Code 0, `changed: false`. |
| `ipa schedule run` | `schtasks /Run /TN <name>`: startet die Aufgabe jetzt, also `capture --scheduled` und damit eine Analyse mit Claude, falls offene Arbeit vorliegt. Nicht eingerichtet oder pausiert: Exit-Code 2 (`schedule_not_installed`, `schedule_paused`). Liegt der Zeitpunkt ausserhalb des Fensters, warnt der Befehl, dass der Lauf ohne Aufnahme endet (`outside_window`). Der Befehl wartet nicht auf das Ende des Laufs. |

Jeder Befehl liest nach der Änderung den Zustand erneut und meldet ihn im Ergebnis. Ein Fehler von `schtasks` bei `install`, `pause`, `resume`, `remove` oder `run` ergibt Exit-Code 1 mit Code `schtasks_failed` und der ersten Zeile von stderr. Bei `status` ergibt er den Zustand `error`.

**Zustand** (`state`):

| Wert | Bedeutung |
| --- | --- |
| `not_installed` | Die Aufgabe `ipa-assistant-<repositoryId>` gibt es nicht. Erkannt wird sie über `schtasks /Query /TN <name> /XML`. Schlägt die Abfrage fehl, entscheidet die Liste `schtasks /Query /FO CSV /NH` (die Meldung ist lokalisiert und taugt nicht dazu). |
| `active` | Die Aufgabe ist eingerichtet, aktiv und aktuell. |
| `paused` | Die Aufgabe ist deaktiviert (`Settings/Enabled` ist `false`) und aktuell. |
| `stale` | Die Aufgabe weicht von dem ab, was `install` jetzt erzeugen würde (siehe `differences`). Sie kann aktiv oder pausiert sein (`enabled`). |
| `error` | Der Zustand liess sich nicht bestimmen. `detail` nennt den Grund. |

`differences` nennt die Abweichungen, jeweils verglichen mit der Aufgabe, die `install` jetzt erzeugen würde:

- `node_path`: Pfad zu Node (`Exec/Command`)
- `cli_path`: Pfad zu `dist/cli.js` (erstes Argument)
- `arguments`: die übrigen Argumente (`capture --scheduled --repo …`, `--data-dir`)
- `triggers`: Wochentag, Startzeit und Wiederholung. Verglichen wird, was ausgelöst wird, nicht die Struktur: Ein Trigger für mehrere Wochentage gilt wie mehrere Trigger. Das Datum von `StartBoundary` zählt nicht.
- `execution_time_limit`: `ExecutionTimeLimit` weicht von `limits.maxRunSeconds` plus 10 Minuten ab

Die Abfrage der Definition erfolgt mit `/XML`. Der Text wird mit einem kleinen eigenen XML-Leser (`src/schedule/xml.ts`, keine neue Abhängigkeit) ausgewertet. Zeichen ausserhalb von ASCII werden vor dem Vergleich auf `?` gesetzt (Pfade mit Umlauten), und Pfade vergleicht der Code ohne Beachtung von Gross- und Kleinschreibung und der Richtung der Trennzeichen.

Nächster und letzter Lauf stammen aus `schtasks /Query /TN <name> /FO CSV /V /NH`. Die Spalten sind lokalisiert, ihre Reihenfolge ist fest: 3. Spalte nächster Lauf, 6. Spalte letzter Lauf, 7. Spalte letztes Ergebnis. Datumsangaben wertet der Code für die üblichen Formate aus (`TT.MM.JJJJ HH:MM:SS`, `MM/TT/JJJJ h:mm:ss AM`, `JJJJ-MM-TT HH:MM:SS`). Bei zweideutigen Angaben mit `/` entscheidet das Datumsformat der Systemsprache und die Plausibilität (der nächste Lauf liegt nicht in der Vergangenheit, der letzte nicht in der Zukunft). Was sich nicht eindeutig auswerten lässt, wird `null`. Die Zeitangaben der Aufgabenplanung sind Systemzeit; das Ergebnis erscheint wie alle Zeitstempel in der konfigurierten Zeitzone (§8.3). „Nicht zutreffend“ und das Ergebnis `267011` (nie gelaufen) ergeben `null`; `267009` bedeutet `running: true`.

Das `result` von `schedule` hat für alle Unterbefehle dieselben Felder (`spec.md §6.7`) und beschreibt immer den Zustand **nach** dem Befehl. `changed` ist `true`, wenn der Befehl die Aufgabenplanung verändert hat (bei `run`: die Aufgabe wurde gestartet). `insideWindow` ist nur bei `run` gesetzt: Der Zeitpunkt liegt im Fenster, in dem `capture --scheduled` arbeitet.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/cli/action.ts` (Hülle, `runAction`, Ausgabekanäle), `src/cli/commands/config.ts`, `src/cli/commands/schedule-task.ts`
  - `src/config/` (Befunde, Zuweisungen, Schutzregeln)
  - `src/schedule/plan.ts`, `src/schedule/schtasks.ts`, `src/schedule/xml.ts`, `src/schedule/task.ts`
  - `schemas/cli-init`, `cli-capture`, `cli-journal`, `cli-note`, `cli-skip`, `cli-baseline`, `cli-doctor`, `cli-config`, `cli-schedule` (`.schema.json`)
- Erweitert: die sieben Befehle in `src/cli/commands/` um `--json`, `src/cli/main.ts` (Abhängigkeiten, `config`), `src/cli/commands/schedule.ts` (Unterbefehle), `src/schedule/templates.ts` (Befunde der Zeitplanregeln, `enabled` der Vorlage, gemeinsame Startzeiten), `src/core/schemas.ts` (Schemaregister), `README.md`
- Genutzt: `loadConfig`, `writeConfig`, `locateRepository`, `renderWindowsTask`, `checkScheduleWindow`, `summarizeAnalyses`, `runs.jsonl` (§9.11)

## 6. Fehler- und Randfälle

- `--json` bei einem Fehler nach dem Start des Befehls: Hülle mit `result: null`, Exit-Code wie auf stderr. Eine ungültige Konfiguration ergibt bei allen Befehlen ausser `config check` Exit-Code 2 (§7.2).
- `capture --scheduled --json` ausserhalb des Fensters: Exit-Code 0, `capture: skipped` und `outsideWindow`, ohne Lock und ohne Snapshot.
- `capture --json` bei gehaltenem Lock: Exit-Code 3, `outcome: lock_held`, `result: null`. Die App zeigt das als Hinweis (Design-Brief 6.6).
- `journal --json` bei Exit-Code 6: `result` mit `failure` und ohne Entwurf; die Meldung nennt `--no-ai` auf stderr.
- Pfade im Ergebnis, die nicht existieren, gibt es nicht: `draftPath`, `notePath`, `workLogPath` und `skipPath` zeigen auf Dateien, die der Befehl angelegt hat.
- `config set` mit einem Pfad ohne Wert (`claude.maxTurns`), mit unbekanntem Pfad, mit einem Pfad in ein Array oder ohne Zuweisung: Exit-Code 2.
- `config set schedule.workdays=[]`: Exit-Code 2 (`schedule_no_workdays`), die Datei bleibt unverändert.
- `config set claude={…}` mit einem Objekt, das `allowPaidUsage: true` enthält, braucht dasselbe Flag wie die Einzelzuweisung.
- Zwei gleichzeitige `config set` ohne Lock: Der zweite erkennt die Änderung vor dem Umbenennen (`config_changed`). Ein Rest-Zeitfenster zwischen erneutem Lesen und `rename` bleibt (§9).
- `schedule status` bei einer Aufgabe, die von Hand in der Aufgabenplanung verändert wurde: `stale` mit den Abweichungen. Eine zusätzliche, nicht erwartete Eigenschaft (zum Beispiel eine Bedingung) führt nicht zu `stale`, weil nur die genannten Eigenschaften verglichen werden.
- `schedule install --update` bei einer pausierten Aufgabe: bleibt pausiert. Bei einer laufenden Aufgabe (`IgnoreNew`) ersetzt `schtasks` die Definition, der laufende Lauf endet regulär.
- `schedule run` während ein Lauf aktiv ist: `IgnoreNew` verhindert den zweiten Lauf; der Befehl meldet `running: true` und `changed: false`.
- Die XML-Datei für `install` liegt kurz im Temp-Ordner. Sie enthält den Repository-Pfad, aber keine Zugangsdaten. Sie wird auch bei einem Fehler gelöscht.
- Windows ohne `schtasks` im Pfad oder ohne Rechte: Exit-Code 1 bei Änderungen, Zustand `error` bei `status`.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-09-01 | Jeder der sieben Aktionsbefehle gibt mit `--json` genau ein JSON-Objekt auf stdout aus, das gegen `schemas/cli-<befehl>.schema.json` gültig ist. stdout enthält sonst nichts. |
| AK-09-02 | Das Ergebnis enthält, was die App braucht: bei `capture` Snapshot-ID und Pfad des Manifests, Zähler, Pfade der Work-Logs, offene Analysen und das Ergebnis; bei `journal` den Pfad des Entwurfs; bei `note` ID, Tag und Pfad der Notizdatei; bei `init` Repository-ID, Arbeitsbereich und Ausgangs-Snapshot; bei `skip` und `baseline` Snapshot und Cursor oder aufgehobenen Halt; bei `doctor` Version, Anmeldeart, Optionen und Kostenschutz. |
| AK-09-03 | Mit `--json` sind Exit-Code und stderr identisch zum Aufruf ohne `--json`; ohne `--json` ist die Ausgabe aller Befehle unverändert (die bisherigen Tests laufen unverändert). `ipa status --json` ist unverändert. |
| AK-09-04 | Fehler und Teilergebnisse: Exit-Code 2 (Bedienungsfehler), 3 (Lock), 4 (Halt), 5 (instabil), 6 (Analyse oder Journal) und 7 (doctor) liefern die Hülle mit `ok: false`, passendem `exitCode`, `outcome` und `errors`; bei 4 bis 7 mit Ergebnis, bei 1 bis 3 mit `result: null`. |
| AK-09-05 | Nichts Vertrauliches im Objekt: Der Text einer Notiz, ein Grund und ein künstliches Secret erscheinen in keiner JSON-Ausgabe (I-12). `note --json` ohne Text endet mit Exit-Code 2. |
| AK-09-06 | `ipa config get` liefert `config.json` und einzelne Werte, mit und ohne `--json`; ein unbekannter Pfad ergibt Exit-Code 2. |
| AK-09-07 | `ipa config check` meldet Schemafehler, die Regeln aus §7.2 und die vier Zeitplanregeln mit Code, Schwere und Pfad. Mit Fehlern ist der Exit-Code 2, nur mit Warnungen 0. Auch eine ungültige Datei wird gemeldet statt abgebrochen. |
| AK-09-08 | `ipa config set` schreibt nur gültige Konfigurationen, atomar (temporäre Datei, dann umbenennen, kein Rest im Ordner). Bei einem Fehler bleibt die Datei Byte für Byte unverändert. `--dry-run` schreibt nichts. Eine zwischenzeitliche Änderung der Datei führt zu `config_changed` ohne Schreiben. Die übrigen Felder bleiben erhalten. |
| AK-09-09 | `repositoryId`, `repository.path`, `timezone` und `schemaVersion` lassen sich nicht ändern, auch nicht über einen übergeordneten Pfad (Exit-Code 2, `config_immutable`). |
| AK-09-10 | `claude.allowPaidUsage` lässt sich nur mit `--confirm-paid-usage` auf `true` setzen, auch über `claude={…}`. Das Abschalten braucht kein Flag. `init` und jeder andere `set` lassen den Wert unberührt. |
| AK-09-11 | `planSchedule` liefert für die Standardwerte 7 Läufe und höchstens 35 Claude-Aufrufe pro Arbeitstag, zählt einen Lauf genau auf `windowEnd` mit, zählt Zusatzläufe ausserhalb des Fensters nicht mit und behandelt ein Intervall länger als das Fenster und leere Arbeitstage. `schedule install`, `schedule status`, `config check` und `config set` verwenden dieselbe Funktion; die Startzeiten der Vorlagen stimmen mit `runTimes` und `skippedRunTimes` überein. |
| AK-09-12 | `ipa schedule install` ruft `schtasks /Create /XML <datei> /TN ipa-assistant-<repositoryId>` mit der Vorlage aus `renderWindowsTask` auf (Ersatz-Runner), löscht die Datei danach, lehnt eine vorhandene Aufgabe ohne `--update` ab und lässt eine pausierte Aufgabe mit `--update` pausiert. |
| AK-09-13 | `ipa schedule status` meldet `not_installed`, `active`, `paused`, `stale` (Pfad zu Node, Pfad zu `cli.js`, Argumente, Trigger, Zeitlimit) und `error`, dazu nächsten und letzten Lauf aus Ausgaben im Format der deutschen und der englischen Windows-Anzeige. Eine Definition im Export-Format der Aufgabenplanung (mit zusätzlichen Eigenschaften und anderem `StartBoundary`-Datum) gilt als aktuell. |
| AK-09-14 | `pause`, `resume`, `remove` und `run` rufen genau die genannten `schtasks`-Befehle auf, sind bei erreichtem Zielzustand Exit-Code 0 mit `changed: false` (`run` ausgenommen), melden Exit-Code 2 bei fehlender Aufgabe und starten `run` nicht bei pausierter Aufgabe. `run` warnt ausserhalb des Fensters. |
| AK-09-15 | `ipa schedule --os windows\|cron [--output]` ist unverändert (die Tests aus Paket 08 laufen ohne Änderung) und ruft `schtasks` nie auf. `ipa schedule --help` nennt die Unterbefehle, `ipa --help` listet `config`. |
| AK-09-16 | Kein Test spricht die echte Aufgabenplanung an. Der Standard-Runner wird nur mit einem Ersatzprogramm geprüft (Dekodierung, Exit-Code, Frist, Argumente ohne Shell). `schedule`-Unterbefehle werden nur im selben Prozess mit Ersatz-Runner getestet. |
| AK-09-17 | **Manuell, vom Benutzer:** `install`, `status`, `pause`, `resume`, `run` und `remove` an der echten Aufgabenplanung unter Windows 11 geprüft, einschliesslich Überschneidungsschutz (AK-08-07), des Verhaltens bei einem Lauf genau auf `windowEnd` und der Auswertung von nächstem und letztem Lauf auf der Systemsprache des Benutzers. Anleitung in der Paketcheckliste. |
| AK-09-18 | Das README beschreibt `--json`, `config` und die Zeitplan-Verwaltung, nennt das Flag für `allowPaidUsage` und behauptet keine ungeprüfte Plattformunterstützung. Der Repository-Fingerprint bleibt in allen Tests unverändert. |

## 8. Notwendige Tests und Validierung

- Unit-Tests: `planSchedule`, Befunde der Konfiguration, Zuweisungen und Schutzregeln, XML-Leser, Definition und Abweichungen der Aufgabe, Auswertung der CSV-Ausgabe und der Datumsformate, Runner mit Ersatzprogramm
- Integrationstests mit dem echten CLI-Einstieg (`runCli`): `--json` aller sieben Befehle mit der Fake-CLI, Schema-Prüfung, Fehlerfälle, `config get|check|set`
- Integrationstests im selben Prozess (`main(argv, io, deps)`) mit Ersatz-Runner: alle Unterbefehle von `schedule`
- Schema-Tests: Beispielausgaben gegen die Schemas, ein absichtlich falsches Objekt wird abgelehnt
- Bestehende Tests laufen unverändert, ausser der Liste der Befehle in `test/cli/main.test.ts` und der Liste der Schemas in `test/core/schemas.test.ts`
- Manuelle Prüfung gemäss AK-09-17, offen für den Benutzer

## 9. Offene Annahmen

- **Datumsformate der Aufgabenplanung:** Die Auswertung von nächstem und letztem Lauf ist für die Formate belegt, die dieses Paket kennt. Auf dem Entwicklungsrechner (Windows 11, deutsche Anzeige, Codepage 850) wurde einmal lesend die Ausgabe einer Systemaufgabe betrachtet (Spaltenreihenfolge, `Nicht zutreffend`, Format `TT.MM.JJJJ HH:MM:SS`). Andere Systemsprachen sind nicht beobachtet. Die App soll `null` als „unbekannt“ anzeigen.
- **Lauf genau auf `windowEnd`:** Bleibt unbeobachtet (Paket 08). Der Plan zählt ihn vorsichtig mit.
- **`config set` ohne Lock:** Eine Änderung von Hand und eine gleichzeitige Änderung durch `set` können sich in dem kurzen Zeitraum zwischen erneutem Lesen und Umbenennen überschneiden. Der Befehl schützt vor dem Überschreiben einer Änderung, die vor der Prüfung kam.
- **`ipa schedule run` ausserhalb des Fensters:** Der Befehl startet die Aufgabe wie die Aufgabenplanung. Weil die Aufgabe `capture --scheduled` ausführt, endet ein Lauf ausserhalb des Fensters ohne Aufnahme. Ein Lauf ausserhalb des Fensters ist von Hand mit `ipa capture` ohne `--scheduled` möglich; die App entscheidet, was sie anbietet.
- **Meldungen von `schtasks`:** Sie sind lokalisiert und werden nur als erste Zeile durchgereicht (Zeichen ausserhalb von ASCII als `?`). Die Fehlererkennung stützt sich auf Exit-Codes und die Aufgabenliste, nicht auf den Text.
- **`--os` als gewöhnliche Option:** Commander prüft die Pflichtoption eines Elternbefehls auch für dessen Unterbefehle. `ipa schedule --os` prüft das Fehlen deshalb in der Aktion; Meldung und Exit-Code 2 sind unverändert.
- **Hinweise für die App:** Die App liest weiterhin Arbeitsbereichsdateien direkt. `--json` ist der Weg für Aktionen. Notiztexte mit `-` am Anfang brauchen `--` vor dem Text.

Folgen aus der Umsetzung (25.11.2026, Einzelheiten in spec.md §18):

- Die Felder der JSON-Ausgabe stehen in spec.md §6.7, nicht in diesem Dokument. Ein Befund oder Ergebnis, das ein Feld des Ergebnisses ersetzt (zum Beispiel eine blockierte Analyse in `analysis.open`), erscheint dort und im Hinweis auf stderr, nicht in `warnings`.
- `ipa schedule` hat die Zeitplanregeln als Befunde (`scheduleFindings`) herausgelöst; der Text von `ipa schedule --os` ist unverändert. Leere `schedule.workdays` sind in `ipa config` ein Fehler (nicht speicherbar), in der Datei aber weiterhin ladbar, wie bisher.
- `ipa schedule install` schreibt die XML-Datei für `/Create` kurz nach `<os.tmpdir()>/ipa-assistant/schedule/`; liegt dieses Verzeichnis im Repository, endet der Befehl mit Exit-Code 2 (`schedule_temp_in_repository`, I-01).
- Der Läufeplan zählt die Läufe im Fenster. Ob ein Lauf mit `windowStart` und Intervall genau auf `windowEnd` fällt, hängt nur von der Konfiguration ab; ob die Aufgabenplanung ihn auslöst, ist weiter unbeobachtet (Paket 08).
- Offen für den Benutzer: die manuelle Prüfung an der echten Aufgabenplanung (AK-09-17) und, aus Paket 08, AK-08-07 und AK-08-08.
