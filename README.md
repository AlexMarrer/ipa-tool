# IPA Assistant

Lokales Kommandozeilenwerkzeug für die IPA. Es soll den Arbeitsstand eines beliebigen lokalen Git-Repositorys in gefilterten Snapshots sichern und daraus belegte Arbeitsprotokolle und Journal-Entwürfe vorbereiten. Das untersuchte Repository verändert es nie.

Die Umsetzung erfolgt in Paketen, geplant in [`docs/implementation/`](docs/implementation/README.md).

**Stand: Paket 01 (CLI-Grundlage).** Verfügbar sind `ipa init` und `ipa status` sowie eine Claude-Vorabprüfung. Snapshots, Notizen, Analyse, Journal und Zeitsteuerung folgen in den nächsten Paketen. `ipa init` nimmt deshalb noch keinen Ausgangs-Snapshot auf.

## Voraussetzungen

- Windows 11. Das ist die einzige geprüfte Plattform. Linux und macOS sind nicht geprüft.
- Node.js 24 oder neuer
- Git
- Für die Claude-Vorabprüfung: eine installierte Claude-Code-CLI (geprüft mit Version 2.1.114)

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
runs.jsonl     Laufprotokoll: eine Zeile pro schreibendem Lauf
lock           nur während eines schreibenden Laufs
snapshots/  analyses/  logs/  notes/  journal/{runs,drafts,final}/  context/  tmp/
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

Legt den Arbeitsbereich für das Repository an: Unterordner, `config.json` mit Standardwerten, `state.json`, Registry-Eintrag und einen Eintrag in `runs.jsonl`. Dabei wird der Lock gehalten.

- `--timezone`: IANA-Name wie `Europe/Zurich` (Standard). Eine unbekannte Zeitzone ergibt Exit-Code 2.
- `--workspace`: ausdrücklich gewählter Arbeitsbereich, siehe oben.
- Ist das Repository bereits initialisiert, endet `init` mit Exit-Code 2 und ändert nichts.
- Funktioniert auch in einem Repository ohne Commits.

```text
> ipa init --workspace .ipa
Arbeitsbereich angelegt.
Repository-ID:  mein-projekt-3fa9c1
Repository:     C:/GIT/mein-projekt
Arbeitsbereich: C:/GIT/mein-projekt/.ipa
Speichermodus:  ausdrücklich gewählt (im Repository)
Zeitzone:       Europe/Zurich
```

### `ipa status [--json]`

Zeigt den Zustand des Arbeitsbereichs. Der Befehl ist nur lesend: kein Lock, kein Laufprotokoll, keine Datei wird geschrieben. Ein nicht initialisiertes Repository ergibt Exit-Code 2, ebenso eine ungültige `config.json`. Die Meldung nennt dann den JSON-Pfad des Fehlers.

Mit `--json` erscheint ein JSON-Objekt. Dieses Format ist ein stabiler Vertrag. Spätere Pakete ergänzen weitere Felder.

| Feld | Inhalt |
| --- | --- |
| `repositoryId`, `repoPath`, `workspacePath`, `dataRoot`, `timezone` | Zeichenketten |
| `workspaceMode` | `default` oder `explicit` |
| `baselineSnapshotId`, `lastSnapshotId`, `lastAnalysedSnapshotId`, `lastSuccessfulRun` | Zeichenkette oder `null` |
| `lastRun` | letzter Eintrag aus `runs.jsonl` oder `null`; bei `errors` nur die Fehlercodes, ohne Meldungen |

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| 0 | Erfolg |
| 1 | Unerwarteter interner Fehler. Mit `IPA_DEBUG=1` wird der Stacktrace ausgegeben. |
| 2 | Bedienungs- oder Konfigurationsfehler: ungültige Argumente oder Konfiguration, kein Git-Repository, nicht initialisiert, unzulässige oder nicht beschreibbare Datenwurzel, unbekannte Schemaversion |
| 3 | Ein anderer Lauf hält den Lock. |
| 4 bis 7 | vorgesehen für spätere Pakete (Halt, instabiler Stand, KI-Schritt, Voraussetzungsprüfung) |

## Grenzen

- **Repository verschoben oder umbenannt:** Die Zuordnung erfolgt über den Pfad. Ein verschobenes Repository muss in V1 neu initialisiert werden. Der alte Arbeitsbereich bleibt liegen und ist nicht mehr zugeordnet.
- **Arbeitsbereich gelöscht:** Verweist die Registry auf einen fehlenden Arbeitsbereich, melden alle Befehle Exit-Code 2. Es gibt keine automatische Neuanlage. Entweder wird der Ordner wiederhergestellt, oder der Eintrag wird aus `registry.json` entfernt und `ipa init` erneut ausgeführt.
- **Lock:** Ein Lock eines beendeten Prozesses auf demselben Rechner wird automatisch entfernt und protokolliert. Ein Lock eines anderen Rechners wird nie automatisch entfernt.
- Geprüft ist nur Windows 11 mit Node.js 24.

## Claude-Vorabprüfung

Ein Skript prüft früh und nur mit künstlichen Daten, ob die installierte Claude-Code-CLI mit den vorgesehenen Optionen funktioniert. Es liest und schreibt nichts im Repository oder im Arbeitsbereich. Jeder Claude-Aufruf läuft ohne Shell in einem neuen, leeren Ordner unter dem Temp-Verzeichnis. Paket 05 ersetzt das Skript durch `ipa doctor --live`.

```bash
npm run probe:claude
```

Ohne `--live` findet **kein Modellaufruf** statt. Geprüft werden `claude --version`, `claude auth status` (übernommen werden nur `loggedIn` und `authMethod`) und alle vorgesehenen Optionen. Die Optionen prüft das Skript über die Meldung zu einer unbekannten Option.

```bash
npm run probe:claude -- --live
```

`--live` führt höchstens drei kleine echte Modellaufrufe aus und verbraucht Kontingent. Nach einem Timeout folgen keine weiteren Aufrufe. Die Eingabe ist ein künstliches Paket mit einer eingebetteten Aufforderung, Dateien zu löschen und Befehle auszuführen. Ausgewertet werden:

- die im Ereignis `system/init` gemeldeten Werkzeuge und MCP-Server
- ob stdout genau ein JSON-Objekt ist
- ob `structured_output` dem Schema entspricht
- ob die Anmeldung auch mit `--setting-sources project,local` funktioniert
- ob im Temp-Ordner Dateien entstanden sind

Das Ergebnis erscheint als JSON auf stdout, ohne E-Mail-Adresse, Organisation oder Token. Pro Annahme steht `bestätigt`, `widerlegt` oder `unklar`. Exit-Codes: 0 alles in Ordnung, 1 Claude nicht startbar, 2 ungültige Argumente, 3 Befunde.

Hinweise:

- Die Prüfung sollte in einem normalen Terminal laufen, nicht innerhalb einer Claude-Code-Sitzung. Deren Umgebungsvariablen (`CLAUDECODE`, `CLAUDE_CODE_*`) verändern das Verhalten von `claude`. Das Skript erkennt diesen Fall. Mit `--isolate-env` gibt es diese Variablen nicht an `claude` weiter.
- `claude auth status` meldet nur, ob Anmeldedaten vorhanden sind. Meldet die Live-Prüfung `authentication_failed`, hilft es, `claude` einmal interaktiv in einem normalen Terminal zu starten oder `claude auth login` auszuführen und die Prüfung zu wiederholen.
- Die Prüfung zeigt, welche Werkzeuge Claude Code meldet. Sie ist keine Sandbox und kein Nachweis eines Schreibschutzes.
- Die Ergebnisse der bisherigen Prüfungen stehen in `docs/implementation/spec.md` §18.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run build` | TypeScript nach `dist/` übersetzen |
| `npm run typecheck` | Typprüfung von Quellcode, Tests und Skripten |
| `npm test` | alle automatischen Tests (Vitest) |
| `npm run probe:claude` | Claude-Vorabprüfung, siehe oben |

Zu den Tests:

- `npm test` baut zuerst `dist/`, weil Integrationstests den echten CLI-Einstieg starten.
- Jeder Test arbeitet mit temporären Git-Repositories und einer eigenen temporären Datenwurzel. Das globale Setup setzt `IPA_ASSISTANT_HOME`, `LOCALAPPDATA` und `XDG_DATA_HOME` auf ein Temp-Verzeichnis, blendet die Git-Konfiguration des Rechners aus und prüft am Ende, dass die echte Datenwurzel unverändert ist.
- Die Tests prüfen die Unversehrtheit der Test-Repositories über einen Fingerprint.
- Automatische Tests rufen Claude nie echt auf.

Aufbau:

```text
src/cli.ts          Einstieg (bin: ipa)
src/cli/            Commander-Definition, Befehle, Ausgabe, Fehlerbehandlung
src/core/           Datenwurzel, Registry, Arbeitsbereich, Konfiguration, Schemas, Schreibfunktionen, Lock, IDs, Zeit, Laufprotokoll
src/git/runner.ts   Git-Aufrufe nur über die Leseliste
schemas/            JSON Schemas (draft-07)
scripts/            Claude-Vorabprüfung
test/               Tests und Test-Helfer
```
