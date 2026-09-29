# IPA Assistant

Lokales Kommandozeilenwerkzeug für die IPA. Es soll den Arbeitsstand eines beliebigen lokalen Git-Repositorys in gefilterten Snapshots sichern und daraus belegte Arbeitsprotokolle und Journal-Entwürfe vorbereiten. Das untersuchte Repository verändert es nie.

Die Umsetzung erfolgt in Paketen, geplant in [`docs/implementation/`](docs/implementation/README.md).

**Stand: Paket 05 (Claude-Anbindung).** Verfügbar sind `ipa init` mit Ausgangs-Snapshot, `ipa capture` ohne KI mit Zuordnung der Änderungen zum Vorgänger-Snapshot, `ipa baseline`, `ipa note`, `ipa status` und `ipa doctor`, das Git und Claude Code prüft. Der Aufruf von Claude Code ist vorbereitet, wird aber erst mit der Analyse genutzt. Noch nicht umgesetzt sind Analyse, Journal und Zeitsteuerung.

## Voraussetzungen

- Windows 11. Das ist die einzige geprüfte Plattform. Linux und macOS sind nicht geprüft.
- Node.js 24 oder neuer
- Git 2.31 oder neuer (geprüft mit 2.51)
- Für `ipa doctor` und die spätere Analyse: eine installierte und angemeldete Claude-Code-CLI. Geprüft mit Version 2.1.201 unter Windows 11, einschliesslich [`ipa doctor --live`](#ipa-doctor---live). Ein Update auf mindestens 2.1.205 wird empfohlen: Ältere Versionen ignorieren ein ungültiges Ausgabeschema still (das Tool prüft seine Schemas deshalb selbst).

## Installation

Das Tool wird einmal separat installiert. Das untersuchte Projekt braucht dafür weder eine Abhängigkeit noch eine Datei oder Konfiguration.

```bash
git clone <tool-repository> ipa-tool
cd ipa-tool
npm ci
npm run build
npm install --global .
```

Danach steht `ipa` im PATH zur Verfügung. Prüfen lässt sich das mit `ipa --version`.

`npm install --global .` verknüpft den globalen Befehl mit diesem Ordner. Nach einer Aktualisierung des Tools genügt `npm ci` und `npm run build`. Deinstallieren lässt es sich mit `npm uninstall --global ipa-assistant`.

## Speicherort der Daten

### Datenwurzel

Alle Daten liegen in einer Datenwurzel. Sie wird in dieser Reihenfolge bestimmt:

1. globale Option `--data-dir <pfad>`
2. Umgebungsvariable `IPA_ASSISTANT_HOME`
3. Standard: unter Windows `%LOCALAPPDATA%\ipa-assistant`. Für macOS (`~/Library/Application Support/ipa-assistant`) und Linux (`$XDG_DATA_HOME/ipa-assistant`, sonst `~/.local/share/ipa-assistant`) ist der Standard festgelegt, aber nicht geprüft.

Die Datenwurzel darf nicht im untersuchten Repository liegen, und das Repository nicht in der Datenwurzel. Sonst endet jeder Befehl mit Exit-Code 2.

In der Datenwurzel liegt immer `registry.json`. Sie ordnet jedem Repository seinen Arbeitsbereich zu. Während `ipa init` die Registry ergänzt, besteht kurz die Datei `registry.lock`.

### Arbeitsbereich pro Repository

Jedes Repository erhält einen eigenen Arbeitsbereich mit Konfiguration, Zustand und Protokollen.

- **Standard:** `<Datenwurzel>/workspaces/<repositoryId>/`, also ausserhalb des Projekts
- **Ausdrücklich gewählt:** `ipa init --workspace <pfad>`, zum Beispiel `--workspace .ipa` für `<repo>/.ipa/`
  - Relative Pfade gelten relativ zur Repository-Wurzel.
  - Der Ordner muss leer sein oder darf noch nicht existieren.
  - Er darf weder die Repository-Wurzel selbst sein noch in `.git` liegen.
  - Liegt er im Repository und ist er nicht von Git ignoriert, weist `init` darauf hin. Empfohlen ist ein Eintrag wie `/.ipa/` in `.gitignore` oder `.git/info/exclude`. Das Tool ändert diese Dateien nicht.
  - Auch in diesem Fall liegt die Registry in der Datenwurzel. Die Datenwurzel muss daher beschreibbar sein.

Aufbau eines Arbeitsbereichs:

```text
config.json    Konfiguration (von Hand bearbeitbar, wird bei jedem Befehl validiert)
state.json     Fortschritt und Cursor
runs.jsonl     Laufprotokoll: eine Zeile pro Lauf von init, capture und baseline
lock           nur während eines Laufs von init, capture oder baseline
doctor.json    letztes Ergebnis von ipa doctor (auch aus init)
ai-usage.jsonl KI-Nutzung: eine Zeile pro Modellaufruf, ohne Prompt, Eingabe und Antwort
snapshots/S000001/manifest.json          Manifest eines Snapshots
snapshots/S000001/content/E001.patch     gespeicherte Belege (Diffs, Commit-Nachrichten als .txt)
snapshots/S000001/content/state/0001.dat Kopie des aktuellen Stands einer geänderten Datei
notes/2026-10-14.jsonl                   Notizen eines Tätigkeitstags, eine Zeile pro Notiz
analyses/  logs/  journal/{runs,drafts,final}/  context/  tmp/
```

Das Tool sichert den Arbeitsbereich nicht selbst. Wo eine Sicherung liegt, entscheidet der Benutzer.

### Nicht beschreibbarer Speicherort

Lässt sich die Datenwurzel nicht anlegen oder beschreiben, bricht `ipa init` mit Exit-Code 2 ab. Das Tool wechselt nie stillschweigend an einen anderen Ort. Die Meldung nennt den geprüften Pfad und die Auswege:

```text
Fehler: Die Datenwurzel ist nicht beschreibbar: C:/Pfad/zur/Datenwurzel (Zugriff verweigert).
Mögliche Auswege:
  --data-dir <pfad>            eine andere Datenwurzel für diesen Aufruf angeben
  IPA_ASSISTANT_HOME=<pfad>   die Datenwurzel über die Umgebungsvariable festlegen
  ipa init --workspace <pfad>  den Arbeitsbereich selbst wählen, zum Beispiel .ipa im Repository.
                               Die Registry bleibt in der Datenwurzel, diese muss daher trotzdem beschreibbar sein.
Der Speicherort wird nicht automatisch gewechselt.
```

Ist ein gewählter Arbeitsbereich nicht beschreibbar, endet `init` ebenfalls mit Exit-Code 2 und nennt den Pfad.

## Befehle

### Globale Optionen

| Option | Bedeutung |
| --- | --- |
| `--repo <pfad>` | Zu untersuchendes Repository. Standard ist das aktuelle Verzeichnis. Ein Unterverzeichnis genügt, verwendet wird die Repository-Wurzel. |
| `--data-dir <pfad>` | Datenwurzel |
| `-h, --help` | Hilfe |
| `-V, --version` | Tool-Version |

Unter Windows werden Pfade unabhängig von Gross- und Kleinschreibung und von `\` oder `/` demselben Repository zugeordnet.

### `ipa init [--timezone <iana>] [--workspace <pfad>]`

Legt den Arbeitsbereich für das Repository an: Unterordner, `config.json` mit Standardwerten, `state.json`, Registry-Eintrag und einen Eintrag in `runs.jsonl`. Danach nimmt `init` den **Ausgangs-Snapshot** `S000001` auf. Er hält fest, was beim Start schon geändert, gestagt oder neu war, und gilt nie als geleistete Arbeit. Commits vor `init` erfasst er nicht. Während des ganzen Befehls wird der Lock gehalten.

Zum Schluss prüft `init` Claude Code wie [`ipa doctor`](#ipa-doctor---live) ohne `--live`, also ohne Modellaufruf. Scheitert die Prüfung, etwa weil Claude Code fehlt oder nicht angemeldet ist, erscheint nur eine Warnung. Der Arbeitsbereich ist trotzdem vollständig, und der Exit-Code bleibt 0.

- `--timezone`: IANA-Name wie `Europe/Zurich` (Standard). Eine unbekannte Zeitzone ergibt Exit-Code 2.
- `--workspace`: ausdrücklich gewählter Arbeitsbereich, siehe oben.
- Ist das Repository bereits mit Ausgangs-Snapshot initialisiert, endet `init` mit Exit-Code 2 und ändert nichts.
- Fehlt der Ausgangs-Snapshot, weil eine frühere Initialisierung abgebrochen ist oder der Arbeitsbereich noch mit Paket 01 angelegt wurde, holt ein erneutes `init` ihn nach. Abweichende Angaben zu `--timezone` oder `--workspace` ergeben dann Exit-Code 2.
- Funktioniert auch in einem Repository ohne Commits.

```text
> ipa init --workspace .ipa
Arbeitsbereich angelegt.
Repository-ID:     mein-projekt-3fa9c1
Repository:        C:/GIT/mein-projekt
Arbeitsbereich:    C:/GIT/mein-projekt/.ipa
Speichermodus:     ausdrücklich gewählt (im Repository)
Zeitzone:          Europe/Zurich
Ausgangs-Snapshot: S000001
Claude-Prüfung: bereit (Claude Code 2.1.201, ohne Modellaufruf). Einen echten Aufruf prüft ipa doctor --live.
```

### `ipa capture [--no-analysis]`

Nimmt einen Arbeits-Snapshot auf, sofern seit dem letzten Snapshot neue Arbeit vorliegt (siehe [Zuordnung von Änderungen](#zuordnung-von-änderungen)). Es gibt noch keine Analyse durch Claude; `--no-analysis` wird schon akzeptiert und hat bis Paket 06 keine Wirkung.

Erfasst werden getrennt:

- neue Commits seit dem vorherigen Snapshot, je mit Commit-Nachricht und einem Diff pro Datei; bei einem Merge gegen den ersten Elternteil
- gestagte Änderungen (HEAD → Index) und ungestagte Änderungen (Index → Working Tree) als Diff pro Datei
- neue, nicht ignorierte Dateien; `.gitignore` wird berücksichtigt
- Löschungen und Umbenennungen
- für jede geänderte Datei der aktuelle Stand als Kopie und die Git-Blob-IDs von HEAD, Index und Working Tree

Ablauf und Schutz:

- Vor jedem Lesen gilt der Pfadfilter, vor jeder Speicherung die Secret-Prüfung und die Grössengrenzen (siehe unten).
- Der Stand wird zweimal gelesen. Ändert er sich dazwischen, wird die Aufnahme bis zu `limits.stabilityRetries` Mal im Abstand von `limits.stabilityDelayMs` wiederholt. Bleibt er unruhig, endet der Befehl mit Exit-Code 5, und es wird nichts gespeichert.
- Der Snapshot entsteht in einem temporären Ordner und wird erst vollständig unter seinem Namen abgelegt. Bricht ein Lauf danach ab, übernimmt der nächste schreibende Befehl den Snapshot ohne Duplikat und meldet das. Reste abgebrochener Läufe werden entfernt.
- Das Repository wird nur gelesen. Git läuft ohne optionale Locks und ohne automatische Index-Aktualisierung, damit auch `.git/index` unverändert bleibt.
- Vor dem ersten `capture` braucht es den Ausgangs-Snapshot von `ipa init`, sonst Exit-Code 2.
- Ohne neue Arbeit wird kein Snapshot gespeichert: Exit-Code 0, Meldung „Keine neue Arbeit …“ und in `runs.jsonl` das Ergebnis `unchanged`.
- Nach einem Branchwechsel oder bei umgeschriebener Historie hält `capture` an: Exit-Code 4, siehe [`ipa baseline`](#ipa-baseline---reason-text---force).

```text
> ipa capture
Snapshot S000002 gespeichert (Arbeits-Snapshot, ohne Analyse).
Commits:          2
Dateizustände:    5
Belege:           12
Zustandsdeltas:   3
Statusänderungen: 1
Testberichte:     0
Lücken:           0
Analyse nötig:    ja
Ausgeschlossen:   1
Zurückgehalten:   1
Ausgelassen:      0
Hinweis: 1 Einheit(en) wegen Secret-Verdacht zurückgehalten. Offene Prüfung: filterDecisions im Manifest von S000002 nennt Pfad, Detektor und Zeile, nie den Wert.
```

Ohne `user.email` in der Git-Konfiguration gelten alle Commits als fremd, und `capture` gibt eine Warnung aus. Gespeichert wird nur, ob ein Commit vom konfigurierten Benutzer stammt, nie eine E-Mail-Adresse.

### `ipa baseline --reason <text> [--force]`

Setzt einen neuen Ausgangspunkt, nachdem `capture` angehalten hat. Vorher lohnt sich ein Blick auf `ipa status` und das Repository: Stimmt der Branch, ist der Rebase abgeschlossen?

- `--reason` ist Pflicht und steht im Manifest. Ein Grund, der wie ein Zugangsdatum aussieht, wird mit Exit-Code 2 abgelehnt.
- Nimmt den Lock und speichert einen Ausgangs-Snapshot (`kind: baseline`) mit der Lücke `rebaseline` und, falls ein Halt aktiv war, zusätzlich `halt_detected` mit Grund und Zeitpunkt des Halts.
- Hebt den Halt auf und übernimmt den aktuellen Branch. Die Zuordnung beginnt dort neu; Arbeit zwischen dem letzten Snapshot und dem neuen Ausgangspunkt bleibt als Lücke sichtbar. Frühere Snapshots bleiben unverändert.
- Ohne aktiven Halt endet der Befehl mit Exit-Code 2. Mit `--force` setzt er den Ausgangspunkt trotzdem, zum Beispiel nach einer langen Pause.
- Ist der Arbeitsstand unruhig, endet er mit Exit-Code 5, und der Halt bleibt bestehen.

```text
> ipa baseline --reason "Rebase auf main abgeschlossen"
Ausgangs-Snapshot S000007 gespeichert. Die Zuordnung beginnt dort neu.
Aufgehobener Halt: Die Historie wurde umgeschrieben (…) (history_rewritten, erkannt am 2026-10-14T10:03:12+02:00). …
Arbeit zwischen dem letzten Snapshot und diesem Ausgangspunkt bleibt als Lücke sichtbar.
```

### `ipa note [text] [optionen]`

Erfasst eine Notiz: eine Tätigkeit, ein Problem, eine Entscheidung, eine Erkenntnis oder eine Planung, auf Wunsch mit gemessenem oder geschätztem Zeitaufwand. Ohne Text fragt der Befehl im Terminal nach. `note` braucht keinen Snapshot und nimmt keinen Lock, es funktioniert also direkt nach `ipa init` und auch während eines laufenden `capture`. Einzelheiten und Beispiele stehen unter [Notizen](#notizen).

### `ipa doctor [--live]`

Prüft, ob Git und Claude Code für die Analyse bereit sind. Ohne `--live` findet **kein Modellaufruf** statt.

- **Git:** `git --version`
- **Claude Code:** Version (`claude --version`) und Anmeldung (`claude auth status`). Übernommen werden nur, ob eine Anmeldung besteht, und die Anmeldeart, nie E-Mail-Adresse, Organisation oder Token.
- **Optionen:** Für jede Option des [Claude-Aufrufs](#claude-code-aufruf-schutzwirkung-und-grenzen) startet `doctor` `claude -p <option> [wert] --zz-ipa-probe` mit leerer Eingabe. Meldet Claude Code die Prüfoption als unbekannt, kennt es die geprüfte Option. Es entsteht kein Prompt und damit kein Modellaufruf. Pflicht sind die elf Optionen des Aufrufs, `--model` nur mit einem Modell in `claude.model`. `--safe-mode`, `--setting-sources` und `--verbose` sind optional; `--safe-mode` verwendet `ipa`, sobald `doctor` die Option findet.
- **Ergebnis:** eine kompakte Liste auf stdout, Befunde auf stderr, Exit-Code 0 (bereit) oder 7 (nicht bereit). Das Ergebnis steht in `doctor.json` im Arbeitsbereich, `ipa status` zeigt es unter `claude`.
- `doctor` braucht ein initialisiertes Repository (sonst Exit-Code 2), nimmt keinen Lock und schreibt keinen Eintrag in `runs.jsonl`. Die Prüfprozesse laufen im selben leeren Temp-Ordner wie jeder Claude-Aufruf.
- Ob die Anmeldung der zugelassene geschäftliche Zugang ist, lässt sich technisch nicht prüfen und ist organisatorisch zu bestätigen. `doctor` weist darauf hin.

```text
> ipa doctor
Git:               gefunden, Version 2.52.0.windows.1
Claude Code:       gefunden, Version 2.1.201
Anmeldung:         angemeldet, Anmeldeart claude.ai
Pflichtoptionen:   alle 11 erkannt
Weitere Optionen:  --safe-mode ja, --setting-sources ja, --model ja, --verbose ja
--safe-mode:       wird verwendet
--setting-sources: wird nicht verwendet, bis ipa doctor --live die Anmeldung damit bestätigt (A-08)
Live-Prüfung:      nicht ausgeführt (ipa doctor --live)
Ergebnis:          bereit
Hinweis: Ob diese Anmeldung der zugelassene geschäftliche Zugang ist, lässt sich technisch nicht prüfen und ist organisatorisch zu bestätigen (O-02).
```

#### `ipa doctor --live`

`--live` führt zusätzlich **zwei kleine echte Modellaufrufe** aus und verbraucht Kontingent. Vorher erscheint ein Hinweis auf stderr. Beide Aufrufe verwenden die Optionen des Claude-Aufrufs, ein triviales Schema (`{ "ok": boolean }`) und eine künstliche Eingabe mit einer eingebetteten Aufforderung, Dateien zu löschen und Befehle auszuführen.

1. Mit `--output-format stream-json --verbose` meldet Claude Code im Ereignis `system/init` seine Werkzeuge und MCP-Server. Die Live-Prüfung ist bestanden, wenn es keine MCP-Server und ausser `StructuredOutput` keine Werkzeuge meldet und das `structured_output` dem Schema entspricht. `StructuredOutput` erscheint, weil der Aufruf `--json-schema` verwendet; es dient der Übergabe der strukturierten Antwort.
2. Mit `--output-format json` und `--setting-sources project,local` prüft `doctor`, ob die Ausgabe genau ein JSON-Objekt mit `structured_output` ist und ob die Anmeldung mit dieser Option funktioniert. Nur dann verwendet `ipa` die Option danach bei jedem Aufruf. Sie soll verhindern, dass Benutzereinstellungen wie Hooks aus `~/.claude/settings.json` geladen werden; nachweisen lässt sich das ohne Änderung der Benutzereinstellungen nicht.

Weitere Regeln:

- Scheitert der erste Aufruf, entfällt der zweite.
- Lehnt die API die Anmeldung wiederholt ab (`authentication_failed`), obwohl `claude auth status` angemeldet meldet, bricht `doctor` ab, statt auf das Timeout zu warten. Abhilfe: `claude` einmal in einem normalen Terminal starten oder `claude auth login` ausführen, danach die Prüfung wiederholen.
- Jeder Modellaufruf ergibt eine Zeile in `ai-usage.jsonl`.
- Ein späteres `ipa doctor` ohne `--live` übernimmt das Live-Ergebnis, solange die Claude-Version gleich bleibt. Nach einem Update gilt es erst nach einem neuen `--live` wieder.
- Läuft `ipa` innerhalb einer Claude-Code-Sitzung, gibt es deren Umgebungsvariablen (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` …) nicht an `claude` weiter; Anmelde- und Anbietervariablen wie `CLAUDE_CONFIG_DIR` bleiben. `doctor` weist darauf hin. Für eine belastbare Live-Prüfung empfiehlt sich trotzdem ein normales Terminal.
- Die Live-Prüfung zeigt, was Claude Code meldet. Sie ist keine Sandbox und kein Nachweis eines Schreibschutzes.

### `ipa status [--json]`

Zeigt den Zustand des Arbeitsbereichs. Der Befehl ist nur lesend: kein Lock, kein Laufprotokoll, keine Datei wird geschrieben. Ein nicht initialisiertes Repository ergibt Exit-Code 2, ebenso eine ungültige `config.json`. Die Meldung nennt dann den JSON-Pfad des Fehlers.

Mit `--json` erscheint ein JSON-Objekt. Dieses Format ist ein stabiler Vertrag. Spätere Pakete ergänzen weitere Felder.

| Feld | Inhalt |
| --- | --- |
| `repositoryId`, `repoPath`, `workspacePath`, `dataRoot`, `timezone` | Zeichenketten |
| `workspaceMode` | `default` oder `explicit` |
| `baselineSnapshotId`, `lastSnapshotId`, `lastAnalysedSnapshotId`, `lastSuccessfulRun` | Zeichenkette oder `null` |
| `lastRun` | letzter Eintrag aus `runs.jsonl` oder `null`; bei `errors` nur die Fehlercodes, ohne Meldungen. Hat der Lauf einen abgebrochenen Snapshot übernommen, steht dessen ID in `recovered`. |
| `snapshots` | `{ total, baseline, work }`: Anzahl aller Snapshots, der Ausgangs- und der Arbeits-Snapshots |
| `halt` | `null` oder `{ reason, detectedAt, expected: { branch, head }, observed: { branch, head } }` bei aktivem Halt |
| `notesToday` | Anzahl der gültigen Notizen, deren Tätigkeitstag heute ist (in der Zeitzone aus `config.json`). Ungültige Zeilen der Notizdatei meldet `status` als Warnung auf stderr. |
| `claude` | `null` oder `{ checkedAt, ok, cliVersion }` aus `doctor.json`: Zeitpunkt und Ergebnis der letzten Prüfung und die Version von Claude Code |

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| 0 | Erfolg, auch wenn `capture` keine neue Arbeit findet |
| 1 | Unerwarteter interner Fehler. Mit `IPA_DEBUG=1` wird der Stacktrace ausgegeben. |
| 2 | Bedienungs- oder Konfigurationsfehler: ungültige Argumente oder Konfiguration, kein Git-Repository, nicht initialisiert, kein Ausgangs-Snapshot, unzulässige oder nicht beschreibbare Datenwurzel, unbekannte Schemaversion, `ipa note` ohne Text und ohne Terminal oder mit abgebrochener Eingabe, ein Temp-Verzeichnis im Repository oder im Arbeitsbereich |
| 3 | Ein anderer Lauf hält den Lock. |
| 4 | Die Zuordnung ist wegen Branchwechsel oder umgeschriebener Historie angehalten. `ipa baseline` ist erforderlich. |
| 5 | Der Arbeitsstand hat sich während der Aufnahme wiederholt verändert. Es wurde kein Snapshot gespeichert. |
| 6 | Der KI-Schritt ist nicht abgeschlossen, etwa weil Claude nicht einsatzbereit ist oder einen Fehler meldet. Gesicherte Daten bleiben offen. Tritt ab Paket 06 auf. |
| 7 | `ipa doctor`: Die Voraussetzungen sind nicht erfüllt. |

## Zuordnung von Änderungen

`capture` vergleicht jede Aufnahme mit dem letzten gespeicherten Snapshot, damit dieselbe Arbeit nicht doppelt erfasst wird.

**Zustandsdelta:** Für jede Datei zählt ihr *wirksamer Stand*, also der Inhalt im Working Tree, unabhängig davon, ob er gestagt oder committet ist. Hat er sich seit dem letzten Snapshot verändert, entsteht ein Beleg `state_delta` mit einem Patch vom vorigen zum aktuellen Stand (`fromBlob` → `toBlob`). Er ist der inhaltliche Hauptbeleg für die spätere Analyse. Auch eine Rücknahme auf den committeten Stand ergibt ein Delta; eine gelöschte und identisch wieder angelegte Datei ergibt keines. Mehrere Commits zwischen zwei Aufnahmen zeigt das Delta als Nettoeffekt. Der Patch durchläuft dieselbe Secret-Prüfung wie alle Patches, einschliesslich entfernter Zeilen.

**Statusänderungen:** Wird ein bereits erfasster Stand nur gestagt oder unverändert committet, entsteht kein neues Delta. Das Manifest führt dann in `statusChanges` einen Eintrag, zum Beispiel `unstaged` → `committed`, mit Verweis auf das frühere Delta (`previousEvidence`).

**Commit-Dateien** erhalten in `attribution`:

| Wert | Bedeutung |
| --- | --- |
| `documented` | Der committete Stand wurde schon früher als Delta erfasst (`previousEvidence`). |
| `baseline` | Der committete Stand stammt aus dem Ausgangs-Snapshot. |
| `new` | Ein Delta dieses Snapshots deckt die Datei ab (`coveredBy`). |
| `unclear` | Keine der obigen Zuordnungen ist möglich, etwa bei einem Zwischenstand, der vor der nächsten Aufnahme zurückgenommen wurde. |

**Kein Snapshot ohne neue Arbeit:** Ein Arbeits-Snapshot wird nur gespeichert, wenn sich HEAD geändert hat, ein Delta entstanden ist oder ein Testbericht neu ist oder sich geändert hat. Reines Stagen genügt nicht. Die eigenen Dateien eines Arbeitsbereichs im Repository wie `.ipa/` zählen nie. `analysisRequired` im Manifest ist `true`, wenn es ein Delta, einen neuen Testbericht oder eine Commit-Datei mit `new` oder `unclear` gibt; ein Snapshot nur mit Statusänderungen braucht später keine KI-Analyse.

**Lücken:** Wurde die Kopie einer Datei im vorigen Snapshot zurückgehalten, etwa wegen Secret-Verdacht oder Grösse, fehlt der vorige Inhalt. Das Delta zeigt dann nur den aktuellen Stand, und `gaps` enthält `previous_state_unavailable`.

**Halt:** Die Zuordnung setzt voraus, dass der neue Stand auf dem vorigen aufbaut. In diesen Fällen hält `capture` mit Exit-Code 4 an, speichert keinen Snapshot und setzt `halt` in `state.json`:

| Grund | Fall |
| --- | --- |
| `branch_changed` | anderer Branch als bisher, auch Wechsel zu oder von detached HEAD (etwa während eines Rebase) |
| `history_rewritten` | der vorige HEAD ist kein Vorfahre mehr, etwa nach `commit --amend`, Rebase oder `reset` |
| `head_missing` | der Commit des vorigen Snapshots existiert nicht mehr, etwa nach Garbage Collection |

Ein Merge, auch eines fremden Branches, ist kein Halt. Fremde Commits haben `authoredByConfiguredUser: false`. Jede weitere Aufnahme endet mit Exit-Code 4, bis `ipa baseline` einen neuen Ausgangspunkt setzt.

**Zeilenenden:** Mit `core.autocrlf` vergleicht das Tool Inhalte so, wie Git sie speichert. Andere Clean-Filter wendet es für den Patch nicht an; dann kann ein Delta Unterschiede zeigen, die nur aus dem Filter stammen.

### Testberichte

Unter `testReports` in `config.json` lassen sich Dateien mit Testergebnissen eintragen, relativ zur Repository-Wurzel oder absolut, auch ausserhalb des Repositorys:

```json
"testReports": [{ "path": "build/test-results/junit.xml", "label": "Unit-Tests" }]
```

- Die Berichte werden direkt gelesen, ohne Pfadfilter, aber immer mit Secret-Prüfung und Grössengrenze. Ein Bericht mit Secret-Verdacht wird ganz zurückgehalten.
- Ist ein Bericht neu oder hat er einen anderen Inhalt als im letzten Snapshot, entsteht ein Beleg `test_report` mit `label`, `mtime` und `fresh`. Ein unveränderter oder gelöschter Bericht ergibt keinen Beleg.
- `fresh` ist `true`, wenn die Änderungszeit der Datei im Beobachtungszeitraum des Snapshots liegt, also nach der vorigen Aufnahme. Das ist eine Heuristik: Sie weist nicht nach, welcher Codestand getestet wurde. Ein kopierter Bericht mit alter Änderungszeit gilt als nicht frisch.
- Das Tool führt keine Tests aus und wertet Berichte nicht aus.

## Notizen

Notizen halten fest, was Git nicht zuverlässig beantworten kann: Tätigkeiten ohne Codeänderung wie Recherche, Planung oder Besprechungen, Probleme mit Ursache und Lösung, Entscheidungen mit Grund und geprüften Alternativen, Erkenntnisse und Verzögerungen. Eine Notiz soll in weniger als einer Minute erfasst sein.

**Arbeitszeiten stammen nur aus Notizen.** Das Aufnahmeintervall eines Snapshots und die Zeitpunkte von Commits sind keine Arbeitszeit. Ohne Zeitangabe in einer Notiz bleibt die Zeit unbekannt.

### Direkte Eingabe

```bash
ipa note "Mock lieferte den falschen Datentyp; Testdaten angepasst."
ipa note --type decision --reason "Wiederverwendung" --alternative "Logik in der Komponente" "Validierung im Service"
ipa note --type activity --minutes 45 --measured "Recherche zur Testkonfiguration"
ipa note --type activity --start 09:10 --end 09:55 --estimated "Besprechung zur Abnahme"
ipa note --type problem --cause "Mock lieferte falschen Datentyp" --solution "Testdaten angepasst" --delay 20 --estimated "Integrationstest rot"
ipa note --type plan --day 2026-10-15 "Validierung der Eingabemaske umsetzen"
ipa note --type insight --ref S000002:E001 "Die Umbenennung vereinheitlicht die Begriffe im Modul"
```

Der Text gehört in Anführungszeichen. Mehrere Wörter ohne Anführungszeichen ergeben „zu viele Argumente“. Ein Text, der mit `-` beginnt, folgt nach `--`, zum Beispiel `ipa note -- "-5 Tests rot"`.

| Option | Regel |
| --- | --- |
| `--type <typ>` | `general` (Standard), `activity`, `problem`, `decision`, `insight` oder `plan` |
| `--day <YYYY-MM-DD>` | Tätigkeitstag. Standard ist heute in der Zeitzone aus `config.json`. Vergangene Tage sind erlaubt, ein Tag in der Zukunft nur mit `--type plan`. |
| `--minutes <n>` | Zeitaufwand in Minuten, ganze Zahl grösser als 0 |
| `--start <HH:MM> --end <HH:MM>` | Zeitspanne am selben Tag, nur beide zusammen und nicht mit `--minutes`. Die Minuten werden aus den Uhrzeiten berechnet, eine Sommerzeitumstellung dazwischen zählt nicht. `--end` muss nach `--start` liegen. Eine Tätigkeit über Mitternacht wird als zwei Notizen erfasst. |
| `--measured`, `--estimated` | Pflicht bei jeder Zeitangabe, genau eine der beiden. Sie gilt für die Zeit und die Verzögerung derselben Notiz. Ohne Zeitangabe ist sie nicht erlaubt. |
| `--delay <minuten>` | Verzögerung in Minuten. Sie wird getrennt gespeichert und nie zur Zeit addiert. |
| `--reason <text>`, `--alternative <text>` | Grund und geprüfte Alternativen, nur bei `--type decision`. `--alternative` ist mehrfach möglich. Ohne `--reason` bleibt der Grund unbekannt. |
| `--cause <text>`, `--solution <text>` | Ursache und Lösung, nur bei `--type problem` |
| `--ref <S000000:E000>` | Verweis auf einen Beleg eines Snapshots, mehrfach möglich. Geprüft wird nur die Form. Ob es den Beleg gibt, prüft das Tool erst mit der Analyse-Pipeline (Paket 06). |

Jeder Verstoss gegen diese Regeln endet mit Exit-Code 2, und es wird nichts gespeichert. Texte werden ohne Leerzeichen am Rand gespeichert, ein leerer Text ist nicht erlaubt.

Die Beispiele aus dem Konzept (§6.3, §6.4) lassen sich so übernehmen, mit einer Abweichung: Eine Zeitangabe braucht immer `--measured` oder `--estimated`. `ipa note --type activity --minutes 45 "…"` ohne Basis lehnt das Tool ab, statt „Zeit gemessen“ aus dem Text zu lesen. Grund und Alternativen einer Entscheidung können im Text stehen, als `--reason` und `--alternative` sind sie aber getrennt auswertbar.

Die Ausgabe nennt Notiz-ID, Tag und Typ, dazu Zeit, Verzögerung und Verweise, aber nie den Text:

```text
> ipa note --type activity --minutes 45 --measured "Recherche zur Testkonfiguration"
Notiz gespeichert.
Notiz-ID: N20261014T081500Z-0c1d
Tag:      2026-10-14
Typ:      activity
Zeit:     45 Minuten, gemessen
```

### Interaktive Eingabe

Ohne Text fragt `ipa note` im Terminal nach, jeweils mit einem Standardwert für Enter:

```text
> ipa note
Neue Notiz für 2026-10-14. Enter übernimmt den Standardwert, Strg+C bricht ab.
Typ (1 general, 2 activity, 3 problem, 4 decision, 5 insight, 6 plan) [general]: 3
Text: Mock lieferte den falschen Datentyp
Ursache (Enter = unbekannt): Testdaten mit falschem Typ
Lösung (Enter = unbekannt): Testdaten angepasst
Zeitaufwand in Minuten (Enter = keine Angabe): 20
Gemessen oder geschätzt? (g/s): s
Notiz gespeichert.
…
```

- Die Fragen kommen in dieser Reihenfolge: Typ, Text, bei `decision` Grund und Alternativen, bei `problem` Ursache und Lösung, Zeitaufwand, und falls eine Zeit angegeben ist, gemessen oder geschätzt.
- Optionen der Befehlszeile gelten als beantwortet, ihre Fragen entfallen. So erfasst `ipa note --day 2026-10-13` eine Notiz für den Vortag, und `ipa note --delay 20` fragt zusätzlich nach der Basis der Verzögerung.
- Eine ungültige Antwort wird erneut erfragt. Strg+C oder Strg+D bricht ab, ohne etwas zu speichern (Exit-Code 2).
- Das geht nur, wenn Ein- und Ausgabe ein Terminal (TTY) sind. Sonst, zum Beispiel in einem Skript oder in der Aufgabenplanung, endet der Befehl mit Exit-Code 2 und verweist auf die direkte Eingabe.
- Die interaktive Eingabe in der Windows-Konsole ist noch nicht manuell geprüft (offener Punkt in der Paketcheckliste 04).

### Ablage

Jede Notiz steht als eine Zeile in `notes/<Tätigkeitstag>.jsonl` im Arbeitsbereich, bei `--workspace .ipa` also in `.ipa/notes/`. Das Tool hängt Notizen nur an und nimmt dafür keinen Lock. `runs.jsonl` erhält für `note` keinen Eintrag.

```json
{"schemaVersion":1,"id":"N20261014T081500Z-0c1d","type":"decision","text":"Validierung im Service","activityDay":"2026-10-14","recordedAt":"2026-10-14T10:15:00+02:00","time":null,"delay":null,"reason":"Wiederverwendung","alternatives":["Logik in der Komponente"],"cause":null,"solution":null,"refs":[]}
```

- `id` enthält die Erfassungszeit in UTC und einen Zufallsanteil, `recordedAt` die Erfassungszeit mit Offset.
- `time` ist `null` oder `{ minutes, basis, start, end }` mit `basis` `measured` oder `estimated`. `start` und `end` sind nur bei `--start`/`--end` gesetzt.
- `delay` ist `null` oder `{ minutes, basis }`.
- `reason` und `alternatives` gibt es nur bei `decision`, `cause` und `solution` nur bei `problem`. `null` heisst unbekannt.

**Bearbeiten und Löschen:** Dafür gibt es in V1 keinen Befehl. Eine Notiz lässt sich von Hand in der JSONL-Datei ändern oder löschen. Jede Zeile muss danach ein gültiges JSON-Objekt nach `schemas/note.schema.json` sein, in der Datei ihres `activityDay` stehen und eine eindeutige `id` haben. Eine Zeile, die das nicht erfüllt, wird übersprungen, und `ipa status` meldet sie als Warnung. Die übrigen Notizen bleiben lesbar.

**Vertrauliche Inhalte:** Notizen werden lokal so gespeichert, wie sie eingegeben wurden. Zugangsdaten gehören nicht in eine Notiz. Die Secret-Prüfung von Notizen folgt mit der Analyse-Pipeline (Paket 06): vor jeder Übermittlung an Claude und als Warnung bei der Eingabe.

## Filter und vertrauliche Inhalte

### Pfadfilter

`config.json` legt unter `paths` fest, welche Dateien erfasst werden:

- `include` (Standard `["**"]`) und `exclude` sind Glob-Muster ([picomatch](https://github.com/micromatch/picomatch)), ohne Unterscheidung von Gross- und Kleinschreibung. Pfade sind relativ zur Repository-Wurzel und verwenden `/`.
- Ein Muster ohne `/` gilt für den Dateinamen in jeder Verzeichnistiefe: `.env` trifft auch `app/config/.env`. Ein Muster mit `/` gilt für den ganzen Pfad: `docs/*.md` trifft `docs/a.md`, aber nicht `x/docs/a.md`.
- Ausschlüsse haben Vorrang vor Einschlüssen.
- Immer ausgeschlossen und nicht abwählbar sind `.git` und ein Arbeitsbereich im Repository wie `.ipa/`, auch wenn Dateien daraus committet wurden.
- Ausgeschlossene Dateien werden nie gelesen. Im Manifest erscheinen sie nur in `filterDecisions` mit Pfad und Regel. Eine Umbenennung von einem ausgeschlossenen an einen erlaubten Pfad gilt als neue Datei, der alte Pfad liefert keinen Inhalt.

`init` schreibt diese Standard-Ausschlüsse in die Konfiguration. Sie sind Vorschläge und dürfen angepasst werden:

```text
.env  .env.*  *.pem  *.key  *.p12  *.pfx  *.jks  *.keystore  id_rsa  id_rsa.*  id_ed25519  id_ed25519.*
.npmrc  .pypirc  .netrc  **/secrets/**  **/credentials/**
**/node_modules/**  **/vendor/**  **/.venv/**  **/__pycache__/**  **/dist/**  **/target/**  **/coverage/**
```

### Secret-Prüfung

Jede Einheit wird vor der Speicherung auf mögliche Zugangsdaten geprüft: Dateikopien, Diffs und Zustandsdeltas einschliesslich entfernter Zeilen und Kontextzeilen, Commit-Nachrichten und Testberichte. Bei einem Treffer wird die **ganze Einheit zurückgehalten**, geschwärzt wird nichts. Das Manifest nennt in `filterDecisions` Pfad, Detektor und Zeilennummer, nie den Wert.

| Detektor | erkennt |
| --- | --- |
| `private_key` | Kopfzeile eines privaten Schlüssels (`-----BEGIN … PRIVATE KEY-----`) |
| `aws_access_key` | AWS-Zugriffsschlüssel-IDs (`AKIA…`) |
| `github_token` | GitHub-Tokens (`ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`, `github_pat_…`) |
| `slack_token` | Slack-Tokens (`xoxb-…` und verwandte) |
| `anthropic_or_openai_key` | Schlüssel der Form `sk-…` und `sk-ant-…` |
| `jwt` | JSON Web Tokens aus drei Base64URL-Teilen, beginnend mit `eyJ` |
| `url_credentials` | Zugangsdaten in URLs (`://benutzer:passwort@`) |
| `assignment` | Zuweisung eines Literalwerts ab 8 Zeichen an einen Schlüssel, der auf `password`, `passwd`, `secret`, `token`, `api_key`, `apikey` oder `access_key` endet |
| `custom` | eigene Muster aus `secrets.extraPatterns` (JavaScript-Regex ohne Flags, zeilenweise geprüft) |

Detektoren lassen sich mit `secrets.disabledDetectors` abschalten.

**Grenzen:** Die Erkennung beruht auf regulären Ausdrücken und ist nie vollständig. Sie findet nicht jedes Secret, und sie hält auch harmlose Stellen zurück. Beim Detektor `assignment` gelten diese Regeln:

- Werte in Anführungszeichen zählen überall, aber nur ohne Leerzeichen. Platzhalter wie `"${VAR}"` zählen nicht.
- Werte ohne Anführungszeichen zählen nur als ganze Konfigurationszeile, etwa in `.env`, Properties- oder YAML-Dateien. Dabei zählen keine Werte mit Punkt oder Klammern und keine Platzhalter wie `$VAR`, `%VAR%` oder `<…>`.

Ein Secret mit Leerzeichen oder in einem ungewohnten Format wird daher nicht erkannt. Sensible Dateien sollten zusätzlich über den Pfadfilter ausgeschlossen werden.

### Grössen, Binärdaten und Links

- Eine Einheit ist binär, wenn ihre ersten 8000 Bytes ein NUL-Byte enthalten oder Git sie als binär meldet. Binärdateien erscheinen nur mit Metadaten (`binary: true`, ohne Datei).
- Einheiten über `limits.maxFileBytes` (Standard 256 KiB) werden mit `file_too_large` ausgelassen. Ihre Blob-ID wird trotzdem bestimmt.
- Würde ein Snapshot mehr als `limits.maxSnapshotBytes` (Standard 10 MiB) speichern, werden ab dort alle weiteren Einheiten mit `snapshot_limit` ausgelassen. Zuerst kommen die Kopien der Dateien nach Pfad, dann Zustandsdeltas und Testberichte, dann die übrigen Belege in ihrer Reihenfolge.
- Symlinks werden nie verfolgt. Gespeichert wird nur das geprüfte Linkziel als Text. Git für Windows listet auch Dateien in Ordner-Junctions auf; liegt ein übergeordneter Ordner ausserhalb des Repositorys, wird die Datei nicht gelesen und als `symlink` ausgelassen.
- Submodule erscheinen nur mit ihrer Commit-ID.

Jede Auslassung steht mit Grund im Manifest, in `filterDecisions` und beim betroffenen Beleg als `omitted`.

## Grenzen

- **Repository verschoben oder umbenannt:** Die Zuordnung erfolgt über den Pfad. Ein verschobenes Repository muss in V1 neu initialisiert werden. Der alte Arbeitsbereich bleibt liegen und ist nicht mehr zugeordnet.
- **Arbeitsbereich gelöscht:** Verweist die Registry auf einen fehlenden Arbeitsbereich, melden alle Befehle Exit-Code 2. Es gibt keine automatische Neuanlage. Entweder wird der Ordner wiederhergestellt, oder der Eintrag wird aus `registry.json` entfernt und `ipa init` erneut ausgeführt.
- **Lock:** Ein Lock eines beendeten Prozesses auf demselben Rechner wird automatisch entfernt und protokolliert. Ein Lock eines anderen Rechners wird nie automatisch entfernt.
- **Git-Konfiguration:** Git wendet beim Berechnen der Blob-IDs konfigurierte Clean-Filter an, wie es auch `git status` tut. SHA-256-Repositories sind nicht geprüft.
- Geprüft ist nur Windows 11 mit Node.js 24.

## Claude Code: Aufruf, Schutzwirkung und Grenzen

Ab Paket 06 analysiert Claude Code neue Snapshots. Der Aufruf ist mit Paket 05 vorbereitet und mit `ipa doctor` prüfbar. Jeder Aufruf:

- startet das Programm aus `claude.command` in `config.json` ohne Shell. Standard ist `["claude"]`. Ist Claude Code über npm installiert (`claude.cmd`), startet es ohne Shell nicht; dann gehört der absolute Pfad der `claude.exe` oder `["<pfad zu node.exe>", "<pfad zur cli.js von Claude Code>"]` in `claude.command`.
- läuft in einem neuen, leeren Ordner `<Temp>/ipa-assistant/claude/<repositoryId>/<runId>-<n>/`, der nur `prompt.md` enthält und danach gelöscht wird. Er liegt immer ausserhalb von Repository und Arbeitsbereich, auch bei `--workspace .ipa`. Zeigt das Temp-Verzeichnis (unter Windows `TEMP` oder `TMP`, sonst `TMPDIR`) in das Repository oder den Arbeitsbereich, bricht der Aufruf vor dem Start mit Exit-Code 2 ab. Verwaiste Ordner älter als 24 Stunden entfernt der nächste Aufruf.
- übergibt die Eingabe ausschliesslich über stdin und verwendet diese Optionen:

  ```text
  -p "<Auftrag>" --output-format json --json-schema <Ausgabeschema> --tools "" --disallowedTools "mcp__*"
  --strict-mcp-config --permission-mode dontAsk --disable-slash-commands --no-session-persistence
  --max-turns <claude.maxTurns> --append-system-prompt-file <prompt.md im leeren Ordner>
  [--setting-sources project,local]   nur nach bestandener Live-Prüfung damit
  [--model <claude.model>]            nur mit konfiguriertem Modell
  [--safe-mode]                       nur wenn ipa doctor die Option findet
  ```

- wird nach `claude.timeoutSeconds` (Standard 600 s) beendet.
- wertet die Antwort in dieser Reihenfolge aus: nicht gefunden, nicht startbar, Timeout, kein einzelnes JSON-Objekt, Fehlerergebnis, Exit-Code ungleich 0 ohne Ergebnis, fehlendes `structured_output`. Die Rohausgabe bleibt zur Diagnose erhalten, stderr bis 64 KiB.
- schreibt eine Zeile in `ai-usage.jsonl` mit Zweck, Zeitpunkten, CLI-Version, Modellen, Prompt- und Schemaversion, SHA-256 der Eingabe, IDs der Belege, Ergebnis, Kosten und Dauer. Prompt, Eingabe und Antwort stehen nicht darin.
- gibt Variablen einer umgebenden Claude-Code-Sitzung nicht weiter, siehe `ipa doctor --live`. Sonst wird die Umgebung für die Anmeldung unverändert weitergegeben; das Tool setzt keine Geheimnisse und protokolliert die Umgebung nicht.

Vor dem ersten Aufruf eines Laufs prüft `ipa`, ob `doctor.json` alle Pflichtoptionen meldet. Sonst führt es `ipa doctor` ohne `--live` einmal aus. Scheitert das, endet der Lauf mit Exit-Code 6.

**Schutzwirkung:** Die Optionen schränken die Möglichkeiten des Modells ein. Sie sind **keine Betriebssystem-Sandbox und kein garantierter Schreibschutz**. Der Schutz des Projekts beruht auf diesen Massnahmen zusammen:

1. keine eingebauten und keine MCP-Werkzeuge, zusätzlich `--permission-mode dontAsk`
2. ein leeres Arbeitsverzeichnis ausserhalb von Repository und Arbeitsbereich, ohne Freigabe weiterer Ordner
3. die Eingabe nur über stdin
4. `ipa` führt keine Vorschläge des Modells aus

**Restrisiken:**

- Verwaltete Firmenrichtlinien und deren Hooks wirken immer.
- Benutzerweite Einstellungen wie Hooks oder `~/.claude/CLAUDE.md` wirken unabhängig vom Arbeitsverzeichnis. `--setting-sources project,local` klammert die Benutzereinstellungen aus, sobald die Live-Prüfung zeigt, dass die Anmeldung damit funktioniert. `~/.claude/CLAUDE.md` betrifft das nach heutigem Kenntnisstand nicht. `--safe-mode` schaltet laut Beschreibung von Claude Code Anpassungen wie `CLAUDE.md`, Hooks und Plugins ab; geprüft ist diese Wirkung nicht.
- Das Betriebssystem verhindert keine Schreibzugriffe. Eine Isolation über einen eigenen Benutzer oder einen Container gehört nicht zu V1.
- `ipa doctor --live` zeigt nur, welche Werkzeuge Claude Code meldet. Ein Prompt allein ist nie eine Schutzmassnahme.

Die Claude-Vorabprüfung aus Paket 01 ist durch `ipa doctor --live` ersetzt. Ihre Ergebnisse und die der späteren Prüfungen stehen in `docs/implementation/spec.md` §18.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run build` | TypeScript nach `dist/` übersetzen |
| `npm run typecheck` | Typprüfung von Quellcode, Tests und Skripten |
| `npm test` | alle automatischen Tests (Vitest) |
| `npm run test:live` | Live-Test mit dem installierten Claude Code (`ipa doctor --live`, zwei kleine Modellaufrufe). Läuft nur mit `IPA_LIVE_CLAUDE=1` und ist nicht Teil von `npm test`. |

Zu den Tests:

- `npm test` baut zuerst `dist/`, weil Integrationstests den echten CLI-Einstieg starten.
- Jeder Test arbeitet mit temporären Git-Repositories und einer eigenen temporären Datenwurzel. Das globale Setup setzt `IPA_ASSISTANT_HOME`, `LOCALAPPDATA` und `XDG_DATA_HOME` auf ein Temp-Verzeichnis, blendet die Git-Konfiguration des Rechners aus und prüft am Ende, dass die echte Datenwurzel unverändert ist.
- Die Tests prüfen die Unversehrtheit der Test-Repositories über einen Fingerprint.
- Automatische Tests rufen Claude nie echt auf. Sie verwenden die Fake-CLI `test/helpers/fake-claude.mjs` über `claude.command`. Das globale Setup nimmt `claude` zusätzlich aus dem PATH der Testprozesse und legt ihr Temp-Verzeichnis in den Test-Ordner.
- Der Live-Test verbraucht Claude-Kontingent und läuft nur auf ausdrücklichen Wunsch, in PowerShell mit `$env:IPA_LIVE_CLAUDE = '1'; npm run test:live`.

Aufbau:

```text
src/cli.ts          Einstieg (bin: ipa)
src/cli/            Commander-Definition, Befehle, Ausgabe, Fehlerbehandlung
src/core/           Datenwurzel, Registry, Arbeitsbereich, Konfiguration, Schemas, Schreibfunktionen, Lock, IDs, Zeit, Laufprotokoll
src/git/            Git-Aufrufe nur über die Leseliste, Parser für -z-Ausgaben, Blob-IDs ohne Schreibzugriff
src/filter/         Pfadfilter und Secret-Prüfung
src/collector/      Aufnahme, Konsistenzprüfung, Manifest, atomare Ablage, Wiederanlauf
src/notes/          Notizen: Regeln der Eingabe, Ablage und Lesen (hängt nur von src/core/ ab)
src/claude/         Claude-Aufruf ohne Werkzeuge und ohne Shell, Auswertung, ipa doctor, KI-Nutzungsprotokoll
schemas/            JSON Schemas (draft-07)
test/               Tests und Test-Helfer, test/live/ für den Live-Test
```
