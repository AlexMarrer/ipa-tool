# Paket 05 – Claude-Anbindung

Die gemeinsamen Verträge stehen in `docs/implementation/spec.md`. Dieses Dokument verweist mit `spec.md §…` darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Nach diesem Paket gibt es einen getesteten `ClaudeRunner`. Er startet die installierte Claude-Code-CLI gemäss spec.md §13.1 ohne Shell und ohne Werkzeuge, übergibt die Eingabe über stdin, wertet die Antwort gemäss §13.3 aus und protokolliert jede KI-Nutzung. `ipa doctor` prüft Git, die Claude-Version, die Anmeldung und die unterstützten Optionen ohne Modellaufruf. `ipa doctor --live` weist mit einem kleinen echten Aufruf nach, dass keine Werkzeuge verfügbar sind. `ipa init` führt die Prüfung ohne Modellaufruf aus.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/claude/`:
  - Prozessstart mit Timeout
  - Auswertung des Antwortumschlags
  - Fehlerklassen (§13.3)
  - `probeClaude` mit Versionsabfrage, Auswertung von `claude auth status` ohne Übernahme von E-Mail- oder Organisationsfeldern und Flag-Prüfung über den Unknown-Option-Pfad (§13.2)
  - Protokoll `ai-usage.jsonl` (§9.12)
- Schemas `ai-usage`, `doctor` und `attempt-outcome`
- Hilfsfunktion zur Prüfung von Ausgabeschemas: draft-07, kein `format`, `$schema` oder `$id`, kompakt unter 8000 Zeichen (§8.4)
- Befehl `ipa doctor [--live]`. Ausserdem führt `ipa init` nach dem Ausgangs-Snapshot `doctor` ohne `--live` aus, ein Fehler dabei ist nur eine Warnung.
- Test-Helfer `test/helpers/fake-claude.mjs` (§16.2), gesteuert über Umgebungsvariablen:
  - Modi: Erfolg, ungültiges JSON, Fehler-Subtype, fehlendes `structured_output`, Exit-Code ≠ 0, Hängen
  - Unknown-Option-Verhalten für die Flag-Prüfung
  - stream-json-Init-Ereignis für `--live`
- Skript `npm run test:live` mit `IPA_LIVE_CLAUDE=1` und ein Live-Test für den Doctor
- `ipa status` erhält das Feld `claude`.
- Ersatz der Vorabprüfung aus Paket 01 (D-24):
  - `scripts/claude-probe.mjs` und das npm-Skript `probe:claude` werden entfernt.
  - Das README verweist auf `ipa doctor --live`.
  - Die Ergebnisse der Vorabprüfung in spec.md §18 bleiben als Nachweis erhalten.
- README: Voraussetzungen für Claude, `doctor`, Schutzwirkung und Grenzen gemäss §13.4 im Wortlaut sinngemäss

Nicht im Umfang:

- Analyse-Eingabepakete, Prompts für Analyse und Journal und fachliche Validierung (Pakete 06 und 07)
- Wiederholungslogik pro Snapshot (Paket 06)

## 3. Voraussetzungen und abhängige Pakete

- Paket 01 ist abgeschlossen, einschliesslich des Ergebnisses der Vorabprüfung in spec.md §18.
  - Hat die Vorabprüfung A-01 oder A-02 widerlegt, muss der Benutzer vor Beginn über O-02 entschieden haben.
- Paket 02 ist abgeschlossen, weil `init` den Ausgangs-Snapshot vor der Prüfung aufnimmt.
- Die Pakete 03 und 04 sind nicht erforderlich.

## 4. Zu implementierendes Verhalten

**`ClaudeRunner.run(ctx, req)`**

1. Das Claude-Arbeitsverzeichnis gemäss D-22 neu und leer anlegen.
   - Prüfen, dass es weder in `ctx.repoRoot` noch im Arbeitsbereich liegt. Andernfalls endet der Aufruf mit Exit-Code 2, ohne Prozessstart.
   - `prompt.md` hineinkopieren.
   - Verwaiste Ordner älter als 24 Stunden entfernen.
2. Das Ausgabeschema mit der Hilfsfunktion prüfen und kompakt serialisieren.
3. Die Argumente exakt in der Reihenfolge von §13.1 bilden.
   - `--safe-mode` nur, wenn `doctor.json` die Option als unterstützt meldet.
   - `--setting-sources project,local` nur, wenn `doctor.json` `settingSourcesAuthOk: true` meldet.
   - `--model` nur, wenn konfiguriert.
4. `spawn(command[0], [...command.slice(1), ...args], { cwd: <claude-arbeitsverzeichnis>, shell: false, windowsHide: true })` starten, stdin schreiben und schliessen. Nach dem Ende das Arbeitsverzeichnis löschen, auch bei Fehlern.
5. Nach `timeoutSeconds` den Prozess beenden und `timeout` melden.
6. stdout vollständig lesen, stderr auf höchstens 64 KiB begrenzen.
7. Den Umschlag gemäss §13.3 auswerten. `meta` enthält:
   - `cliVersion` aus `doctor.json` oder `null`
   - `models` aus den Schlüsseln von `modelUsage`
   - `costUsd`, `durationMs`, `exitCode`
   - `rawStdout` und `rawStderr` zur Ablage durch den Aufrufer
8. Pro Aufruf genau eine Zeile in `ai-usage.jsonl` schreiben, bei Erfolg und bei Fehler. Die Zeile enthält keine Inhalte.

**`probeClaude(ctx, { live })`**

- Git: `git --version` über den `GitRunner`. Der Aufruf steht auf der Leseliste (spec.md §14.2).
- Claude:
  - `claude --version` liefert die Version.
  - `claude auth status` liefert `loggedIn` und `authMethod` aus dem JSON. Alle anderen Felder werden verworfen.
  - Flag-Prüfung: pro Option `claude -p <option> [wert] --zz-ipa-probe x` mit leerem stdin und Timeout 20 s.
    - Meldet stderr `unknown option '--zz-ipa-probe'`, ist die Option unterstützt.
    - Meldet es die geprüfte Option als unbekannt, ist sie nicht unterstützt.
    - Jede andere Ausgabe gilt als „unbekannt“ und damit als nicht unterstützt.
  - Geprüft werden alle Optionen aus §13.1 einschliesslich `--safe-mode`.
- `--live` übernimmt die Logik der Vorabprüfung aus Paket 01 in den Produktcode. Grundlage ist ein Aufruf mit denselben Pflichtoptionen, aber `--output-format stream-json --verbose`, einem trivialen Schema (`{ ok: boolean }`) und einer kurzen festen Eingabe. Ein zweiter Aufruf mit `--setting-sources project,local` ermittelt `settingSourcesAuthOk` (A-08).
  - Ausgewertet werden die Felder `tools` und `mcp_servers` des Ereignisses `system/init` und das `structured_output` des Ergebnisses.
  - `live.ok` ist `true`, wenn beide Listen leer sind und `structured_output` dem Schema entspricht.
  - Vor dem Aufruf erscheint auf stderr der Hinweis, dass ein echter Modellaufruf Kontingent verbraucht.
- Ergebnis:
  - `doctor.json` atomar schreiben.
  - `ok` ist `true`, wenn Git gefunden, Claude gefunden und angemeldet ist, alle Pflichtoptionen unterstützt werden und, bei `--live`, auch `live.ok` gilt.
  - Exit-Code 0 oder 7.
- Ausgabe: eine kompakte Liste der Prüfungen mit Ergebnis. Bei `authMethod` wird darauf hingewiesen, dass die geschäftliche Zulassung organisatorisch zu bestätigen ist (W-07).

**Aufrufer ohne erfolgreichen Doctor**

- Pakete 06 und 07 rufen `run` nur auf, wenn `doctor.json` existiert und alle Pflichtoptionen als unterstützt meldet.
- Andernfalls führen sie die Prüfung ohne `--live` automatisch einmal aus. Scheitert sie, endet der Lauf mit Exit-Code 6.
- In jedem Fall folgt ein frisches `claude auth status` ohne Modellaufruf (Nachtrag vom 30.09.2026). Meldet es `loggedIn: false`, liefert es kein auswertbares JSON (`loggedIn: null`) oder antwortet es nicht innerhalb von 20 s, endet der Lauf mit `claude_not_ready` und Exit-Code 6, bevor ein Versuch entsteht.
- Die Hilfsfunktion `ensureClaudeReady(ctx)` gehört zu diesem Paket.

**Kostenschutz (Nachtrag vom 30.09.2026, D-25, spec.md §13.1)**

- Standard ist die Abo-Anmeldung. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY` (nicht leer) und die Anmeldeart `third_party` gelten als kostenpflichtig.
- Nur `claude.allowPaidUsage: true` erlaubt sie. Standard und fehlendes Feld bedeuten `false`.
- `callClaude` prüft vor jedem Modellaufruf die Umgebung für `claude`, `ensureClaudeReady` zusätzlich die Anmeldeart aus `doctor.json`. Greift der Schutz: kein Prozessstart, keine Zeile in `ai-usage.jsonl`, `IpaError` `paid_usage_blocked` mit Exit-Code 6 und deutscher Meldung ohne Werte.
- `ipa doctor` zeigt die Zeilen „API-Schlüssel“, „Externer Anbieter“ und „Kostenpflichtige Nutzung“ neben der Anmeldeart. Greift der Schutz, ist `ok` `false` (Exit-Code 7), und `--live` entfällt.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/claude/`
  - `schemas/ai-usage.schema.json`, `schemas/doctor.schema.json`, `schemas/attempt-outcome.schema.json`
  - `test/helpers/fake-claude.mjs`
- Erweitert: `src/cli/` (`doctor`, `init`, `status`)
- Schnittstellen:
  - `ClaudeRequest`, `ClaudeResult`, `ClaudeRunner`, `probeClaude` (spec.md §10)
  - Fehlerklassen (§9.9, §13.3)
  - `doctor.json` (§9.13), `ai-usage.jsonl` (§9.12)
  - Kostenschutz: `src/claude/billing.ts`, `claude.allowPaidUsage` in `config.json` (spec.md §7, §13.1)

## 6. Fehler- und Randfälle

- `claude` ist nicht im PATH: `not_found`, und `doctor` meldet „nicht gefunden“.
- `claude.command` zeigt auf eine `.cmd`-Datei: Node meldet `EINVAL`. Das ergibt `not_executable` mit Hinweis auf einen absoluten Node- oder `.exe`-Befehl (A-05).
- Leeres Argument `""` für `--tools` unter Windows (A-04): Ein Test mit der Fake-CLI prüft, dass ein leerer String ankommt.
- stdout enthält zusätzliche Zeilen vor dem JSON, zum Beispiel Update-Hinweise: `invalid_envelope`. Die rohe Ausgabe bleibt für die Diagnose erhalten.
- Hängender Prozess: Er wird nach Ablauf des Timeouts beendet, ein Zombie-Prozess bleibt nicht zurück, und es wird `timeout` gemeldet.
- `claude auth status` meldet nicht angemeldet (Exit-Code 1): `loggedIn: false`.
- Grosse stdin-Eingabe knapp unter dem Limit: Sie wird vollständig übertragen, auch bei vollem Pipe-Puffer.
- Ungültiges Ausgabeschema, zum Beispiel mit `format`: Programmierfehler vor dem Start.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-05-01 | Die Fake-CLI protokolliert:<br>• exakt die Argumentliste aus spec.md §13.1, einschliesslich des leeren Arguments nach `--tools`, und ohne Shell<br>• genau die übergebene Eingabe auf stdin<br>• ihr Arbeitsverzeichnis: leer ausser `prompt.md` und ausserhalb von Repository und Arbeitsbereich, auch wenn der Arbeitsbereich `.ipa/` im Repository ist<br><br>Nach dem Aufruf ist das Arbeitsverzeichnis gelöscht. Zeigt `TMP` in das Repository, wird der Aufruf vor dem Start abgelehnt. |
| AK-05-02 | Eine Erfolgsantwort der Fake-CLI liefert `ok: true`, `structuredOutput` und `meta` mit Modellnamen und Kosten. |
| AK-05-03 | Jede Fehlerklasse aus §13.3, also `not_found`, `not_executable`, `timeout`, `invalid_envelope`, `error_result`, `nonzero_exit` und `missing_structured_output`, wird über die Fake-CLI oder einen ungültigen Befehl erzeugt und korrekt gemeldet, ohne unbehandelte Ausnahme. Ein Timeout endet spätestens 5 s nach dem konfigurierten Wert. |
| AK-05-04 | Jeder Aufruf schreibt genau eine schemagültige Zeile in `ai-usage.jsonl` mit Zweck, Zeitpunkten, CLI-Version, Modellen, Prompt- und Schema-Version, `inputSha256` und Ergebnis. Eingabetext und Antworttext kommen darin nicht vor. |
| AK-05-05 | `ipa doctor` mit Fake-CLI meldet Version, Anmeldestatus und Optionsunterstützung und schreibt `doctor.json`. Fehlt eine Pflichtoption, ergibt das Exit-Code 7. `--safe-mode` wird nur dann übergeben, wenn es als unterstützt gemeldet ist. |
| AK-05-06 | `doctor.json` und die Ausgabe enthalten weder E-Mail noch Organisationsnamen noch Token, auch wenn die Fake-CLI solche Felder liefert. |
| AK-05-07 | `ipa init` führt `doctor` ohne `--live` aus. Scheitert die Prüfung, bleibt der Exit-Code von `init` 0, es erscheint eine Warnung, und der Arbeitsbereich ist vollständig. |
| AK-05-08 | Die Schema-Hilfsfunktion lehnt `format`, `$schema`, `$id` und Schemas über 8000 Zeichen ab und akzeptiert ein gültiges draft-07-Schema. |
| AK-05-09 | **Manuell (live, nach Freigabe):** `ipa doctor --live` mit der installierten Claude-Version meldet leere Listen für `tools` und `mcp_servers` und ein gültiges `structured_output`. Version, Datum und Ergebnis stehen in der Checkliste. Die Annahmen A-01 bis A-05 und A-08 sind in spec.md §18 als bestätigt oder widerlegt eingetragen, zusätzlich zum Ergebnis der Vorabprüfung aus Paket 01. |
| AK-05-10 | `ipa status --json` enthält `claude`, und `ipa --help` listet `doctor`. `scripts/claude-probe.mjs` und `probe:claude` sind entfernt, und das README verweist auf `ipa doctor --live`. |
| AK-05-11 | `--setting-sources project,local` wird nur übergeben, wenn `doctor.json` `settingSourcesAuthOk: true` meldet. Der Test prüft beide Fälle mit der Fake-CLI. |
| AK-05-12 | Kostenschutz (Nachtrag, D-25): Mit einer der fünf Variablen oder der Anmeldeart `third_party` und ohne `claude.allowPaidUsage: true` startet weder `ClaudeRunner.run` noch `doctor --live` noch `capture` noch `journal` einen Modellaufruf; `capture` und `journal` enden mit Exit-Code 6 (`paid_usage_blocked`), `doctor` mit 7. Werte der Variablen erscheinen weder in Ausgaben noch in Dateien. Die Abo-Anmeldung funktioniert unverändert, und mit `allowPaidUsage: true` sind die Aufrufe erlaubt. `doctor` zeigt Anmeldeart, API-Schlüssel, externen Anbieter und Freigabe. |

## 8. Notwendige Tests und Validierung

- Unit-Tests: Argumentbildung, Umschlagauswertung mit festen JSON-Beispielen (Erfolg und jede Fehlervariante), Schema-Hilfsfunktion, Filter für die Auth-Felder, Kostenschutz
- Integrationstests mit `fake-claude.mjs` über `claude.command = [process.execPath, <pfad>]` für AK-05-01 bis AK-05-08 und AK-05-10 bis AK-05-12
- Live-Test (`npm run test:live`): AK-05-09, nur nach ausdrücklicher Freigabe durch den Benutzer

## 9. Offene Annahmen

- A-01 bis A-05, A-07 und A-08: Die Vorabprüfung in Paket 01 prüft sie zuerst, AK-05-09 bestätigt sie mit Produktcode.
- Widerlegt die Live-Prüfung A-01, weil unter 2.1.114 trotzdem Werkzeuge gemeldet werden, ist Paket 06 blockiert. Die Umsetzung stoppt dann, und der Benutzer entscheidet über ein Claude-Update (O-02).

Folgen aus der Umsetzung (29.09.2026, Einzelheiten in spec.md §18):

- Die Umsetzung lief in einem Linux-Container mit Claude Code 2.1.284 und Node.js 22 (zusätzlich Node.js 24). 2.1.284 erkennt alle Optionen einschliesslich `--safe-mode`. Die vom Benutzer freigegebene Live-Prüfung (AK-05-09) ist dort bestanden: nur `StructuredOutput`, keine MCP-Server, gültiges `structured_output`, Anmeldung auch mit `--setting-sources project,local`. Auf dem Entwicklungsrechner unter Windows mit 2.1.114 steht sie noch aus und soll vor Paket 06 laufen; dort fehlt `--safe-mode`, der Runner lässt es dann weg.
- Der Runner gibt Variablen einer umgebenden Claude-Code-Sitzung nicht an `claude` weiter; Anmelde- und Anbietervariablen bleiben. Das ersetzt `--isolate-env` der Vorabprüfung.
- `ipa doctor` braucht ein initialisiertes Repository, nimmt keinen Lock und schreibt nicht in `runs.jsonl`. `--live` macht zwei Modellaufrufe: `stream-json` für Werkzeuge und MCP-Server, dann `json` mit `--setting-sources project,local` für A-02, A-03 und A-08. Wiederholt abgelehnte Anmeldungen brechen den ersten Aufruf ab, statt bis zum Timeout zu warten.
- Ohne `--live` bleibt ein früheres Live-Ergebnis bei gleicher Claude-Version erhalten, damit `--setting-sources` nicht durch ein einfaches `ipa doctor` wegfällt.
- `ClaudeRequest` erhält `outputSchemaVersion`; Paket 06 und 07 übergeben dort die Version ihres Ausgabeschemas. `outcomeForErrorCode` in `src/claude/usage.ts` bildet die Fehlerklassen auf die Ergebnisse von `outcome.json` ab (§9.9), das Schema `attempt-outcome` liegt bereit.
- In den Tests ist `claude` aus dem PATH genommen, und das Temp-Verzeichnis liegt im Test-Ordner. `ipa init` warnt dort daher „nicht gefunden“. Tests binden die Fake-CLI über `test/helpers/claude.ts` ein.
- Die Vorabprüfung (`scripts/claude-probe.mjs`, `npm run probe:claude`) ist mit ihrem Test und ihrer Fake-CLI entfernt; ihre Ergebnisse bleiben in spec.md §18.
