# IPA Assistant

Der IPA Assistant hilft dir, während einer IPA (oder eines anderen Projekts) nachvollziehbar festzuhalten, was du wann gemacht hast. Er sichert den Arbeitsstand eines lokalen Git-Repositorys in Momentaufnahmen, lässt Claude Code daraus **belegte** Arbeitsprotokolle schreiben und bereitet einen Journal-Entwurf pro Tag vor. Dein Repository verändert er dabei nie.

Es gibt zwei Teile:

- **Das Kommandozeilenwerkzeug `ipa`** (dieser Ordner): erfasst, analysiert und schreibt die Entwürfe.
- **Die Desktop-App** (Ordner [`app/`](app/README.md), in Arbeit): eine grafische Oberfläche, die `ipa` im Hintergrund startet und anzeigt, was gesammelt wurde.

Du kannst `ipa` allein benutzen. Die App ist optional und braucht `ipa`.

**Wichtig zu wissen:** Das Journal ist immer nur ein **Entwurf**. Prüfen, korrigieren und die Endfassung schreibst du selbst. Das Werkzeug erfindet keine Arbeitszeit: Zeiten stehen nur im Journal, wenn du sie selbst in einer Notiz angegeben hast.

## Inhalt

- [Begriffe](#begriffe)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Schnellstart](#schnellstart)
- [Desktop-App](#desktop-app)
- [Fehlerbehebung](#fehlerbehebung)
- [Projektstand und Dokumentation](#projektstand-und-dokumentation)
- Referenz: [Speicherort der Daten](#speicherort-der-daten), [Befehle](#befehle), [Analyse und Work-Logs](#analyse-und-work-logs), [Tagesjournal](#tagesjournal), [Zeitsteuerung](#zeitsteuerung), [Notizen](#notizen), [Filter und vertrauliche Inhalte](#filter-und-vertrauliche-inhalte), [Claude Code](#claude-code-aufruf-schutzwirkung-und-grenzen), [Entwicklung](#entwicklung)

## Begriffe

| Begriff | Bedeutung |
| --- | --- |
| Repository | Dein Git-Projekt, an dem du arbeitest. Wird nie verändert. |
| Snapshot | Eine Momentaufnahme deines Arbeitsstands (Commits, geänderte und neue Dateien), gefiltert und ohne Passwörter oder Schlüssel. `S000001` ist der Ausgangs-Snapshot beim Start. |
| Work-Log | Ein Protokoll zu einem Snapshot: was geändert wurde, jede Aussage mit Beleg. Entsteht mit Claude Code (`KI-Entwurf`) oder, ohne Claude, rein aus den Fakten. |
| Notiz | Ein eigener Eintrag von dir (Tätigkeit, Problem, Entscheidung, Erkenntnis, Planung), auf Wunsch mit Zeitaufwand. |
| Journal | Ein Entwurf pro Tag aus Work-Logs, Commits und Notizen. |
| Arbeitsbereich | Der Ordner, in dem das Werkzeug alles zu einem Repository ablegt, standardmässig ausserhalb des Repositorys. |
| Datenwurzel | Der Ordner mit allen Arbeitsbereichen und der Projektliste (`registry.json`), unter Windows `%LOCALAPPDATA%\ipa-assistant`. |

## Voraussetzungen

| Was | Version | Prüfen mit |
| --- | --- | --- |
| Windows | 11 (die einzige geprüfte Plattform; Linux und macOS sind nicht geprüft) | |
| Node.js | 24 oder neuer | `node --version` |
| Git | 2.31 oder neuer (geprüft mit 2.51) | `git --version` |
| Claude Code (optional) | angemeldet mit einem Claude-Abo, empfohlen ab 2.1.205 | `claude --version`, `claude auth login` |

**Claude Code ist nur für die KI-Analyse nötig.** Ohne Claude funktionieren `ipa init`, `ipa note`, `ipa capture --no-analysis`, `ipa journal --no-ai` und `ipa status`. API-Schlüssel und externe Anbieter sind standardmässig gesperrt, damit nichts Kosten verursacht, siehe [Kostenschutz](#kostenschutz). Geprüft mit Version 2.1.201 unter Windows 11, einschliesslich [`ipa doctor --live`](#ipa-doctor---live). Ältere Versionen als 2.1.205 ignorieren ein ungültiges Ausgabeschema still (das Tool prüft seine Schemas deshalb selbst).

Für die Desktop-App brauchst du zusätzlich Internet beim ersten Start (Electron lädt dann einmalig rund 100 MB nach).

## Installation

Das Tool wird einmal separat installiert. Das untersuchte Projekt braucht dafür weder eine Abhängigkeit noch eine Datei oder Konfiguration. In einem Terminal (PowerShell):

```powershell
git clone <tool-repository> ipa-tool
cd ipa-tool
npm ci
npm run build
npm install --global .
```

1. `npm ci` installiert die Abhängigkeiten des Werkzeugs.
2. `npm run build` übersetzt den Quellcode nach `dist/`.
3. `npm install --global .` macht den Befehl `ipa` überall verfügbar.

Prüfen: Öffne ein **neues** Terminal und gib `ipa --version` ein. Es sollte eine Versionsnummer erscheinen.

`npm install --global .` verknüpft den globalen Befehl mit diesem Ordner. Lösche oder verschiebe ihn also nicht. Nach einer Aktualisierung (`git pull`) genügt `npm ci` und `npm run build`. Deinstallieren lässt es sich mit `npm uninstall --global ipa-assistant`.

### Mehrere Repositories

Eine Installation genügt für beliebig viele Repositories. Jedes Repository wird einmal mit `ipa init` eingerichtet und erhält einen eigenen Arbeitsbereich (siehe [Speicherort der Daten](#speicherort-der-daten)). Jeder Befehl arbeitet mit genau einem Repository: mit dem aktuellen Verzeichnis oder dem mit `--repo <pfad>` genannten.

```bash
ipa --repo C:/GIT/projekt-a init
ipa --repo C:/GIT/projekt-b init --workspace .ipa
ipa --repo C:/GIT/projekt-a capture
```

Für geplante Läufe erzeugt `ipa schedule` je Repository eine eigene Aufgabe `ipa-assistant-<repositoryId>`.

## Schnellstart

Ein erster Durchlauf in zehn Minuten, zuerst **ohne Claude**. Wechsle in das Repository, an dem du arbeitest (hier `C:\GIT\mein-projekt`):

```powershell
cd C:\GIT\mein-projekt
```

**1. Projekt einrichten** (einmal pro Repository):

```powershell
ipa init
```

Das legt den Arbeitsbereich an und nimmt den Ausgangs-Snapshot `S000001` auf. Er hält fest, was schon da war, und zählt nie als geleistete Arbeit. Am Ende erscheint vermutlich eine **Warnung**, dass Claude Code nicht angemeldet ist. Das ist in Ordnung: Der Arbeitsbereich ist trotzdem vollständig, und Claude brauchst du erst in Schritt 5.

**2. Arbeiten und eine Notiz festhalten.** Ändere oder erstelle Dateien wie sonst auch, dann:

```powershell
ipa note "Recherche zu Electron-Sicherheit, Sandbox und Kontext-Isolation verstanden"
```

Eine Notiz braucht keinen Snapshot und geht jederzeit. Zeiten, Probleme, Entscheidungen und Verweise gehören auch dazu, siehe [Notizen](#notizen).

**3. Arbeitsstand erfassen:**

```powershell
ipa capture --no-analysis
```

Das nimmt einen Snapshot auf (`S000002`) und ruft Claude **nicht** auf. Gibt es seit dem letzten Snapshot nichts Neues, meldet `capture` das und speichert nichts.

**4. Zustand ansehen und einen Journal-Entwurf erzeugen:**

```powershell
ipa status
ipa journal --no-ai
```

`status` zeigt Snapshots, Analysen und Notizen. `journal --no-ai` schreibt einen Entwurf für heute aus Notizen und Fakten, ohne Claude. Den Pfad der Datei nennt der Befehl; öffne sie und prüfe sie.

**5. Mit Claude (optional).** Melde Claude Code einmal an und prüfe die Voraussetzungen:

```powershell
claude auth login
ipa doctor
```

Danach analysiert `ipa capture` (ohne `--no-analysis`) offene Snapshots mit Claude Code und schreibt belegte Work-Logs, und `ipa journal` (ohne `--no-ai`) erzeugt den Journal-Entwurf mit Claude. Beides verbraucht Kontingent deines Claude-Abos, deshalb startet das Werkzeug Claude nie von selbst. `ipa doctor --live` macht zusätzlich zwei kleine echte Modellaufrufe. Ablauf und Schutz sind unter [Analyse und Work-Logs](#analyse-und-work-logs) beschrieben.

Wo liegen die Ergebnisse? `ipa status` nennt den Arbeitsbereich. Darin liegen `logs/` (Work-Logs), `notes/`, `journal/drafts/` (Entwürfe) und `journal/final/` für deine Endfassung, die das Werkzeug nie anfasst. Mehr dazu unter [Speicherort der Daten](#speicherort-der-daten).

## Desktop-App

Die Desktop-App zeigt dieselben Daten grafisch an und startet `ipa` im Hintergrund. Sie liegt im Ordner [`app/`](app/README.md) mit eigenem `package.json`, damit `ipa` auch ohne App installierbar bleibt.

**Stand:** Die App ist in Arbeit. Heute kann sie: die Projekte aus der Projektliste mit einem Statuspunkt anzeigen, zwischen den Bereichen wechseln und sich dem Hell- oder Dunkelmodus von Windows anpassen. Die Inhalte der Bereiche (Tagesansicht, Work-Logs, Journal, Zeitplan, Konfiguration) und alle Aktionen wie „Neue Notiz“ oder „Jetzt erfassen“ folgen in den nächsten Paketen und sind noch gesperrt oder leer. Einen Installer kannst du bauen (siehe unten), er ist aber noch nicht abgenommen.

**Starten (Entwicklung):** im Ordner des Werkzeugs, nachdem du die [Installation](#installation) des CLI gemacht hast.

```powershell
npm run app:install    # einmalig: installiert die App
npm run app:dev        # baut das CLI und startet die App
```

Die App nutzt dabei `node` aus dem PATH und das gebaute `dist/` dieses Ordners. Richtest du in diesem Betrieb mit `ipa schedule install` eine Windows-Aufgabe ein, zeigt sie auf diesen Entwicklungsordner. Später liefert ein Installer ein eigenes Node und das CLI mit.

Beim allerersten Start lädt Electron einmalig seine Programmdatei herunter (rund 100 MB, Internet nötig). Das kann einen Moment dauern.

**Als normales Programm mit Desktop-Link:** `npm run app:install` installiert nur die Entwicklungs-Abhängigkeiten und erzeugt keine `.exe`. Für ein Programm zum Doppelklicken baust du den Installer:

```powershell
npm run app:dist
```

Das erzeugt `app\release\IPA Assistant Setup 0.1.0.exe` (rund 140 MB). Ein Doppelklick installiert die App ohne Administratorrechte nach `%LOCALAPPDATA%\Programs\IPA Assistant` und legt einen Desktop-Link und einen Startmenü-Eintrag an. Windows kann beim Start vor dem unsignierten Installer warnen („Weitere Informationen“ › „Trotzdem ausführen“). Einzelheiten stehen in [`app/README.md`](app/README.md#als-programm-installieren-mit-desktop-link).

**Was du siehst:** Links die Projekte, die du mit `ipa init` eingerichtet hast. Ein neues Projekt legst du vorerst im Terminal mit `ipa init` an, die App liest die Projektliste daraus. Die App und das Terminal benutzen dieselben Daten (dieselbe Datenwurzel). Die App ändert nie selbst etwas an Arbeitsbereich oder Repository und ruft Claude nie von selbst auf.

Aufbau, Tests, Sicherheit und Versionen der App stehen in [`app/README.md`](app/README.md).

## Fehlerbehebung

| Problem | Ursache und Lösung |
| --- | --- |
| `ipa` wird nicht gefunden | Öffne ein **neues** Terminal (der PATH wird erst dort neu gelesen). Hilft das nicht, wiederhole `npm install --global .` im Ordner des Werkzeugs. |
| `ipa` meldet, das Repository sei „nicht initialisiert“ (Exit-Code 2) | Führe einmal `ipa init` im Repository aus, oder gib es mit `--repo <pfad>` an. |
| Warnung „Claude Code ist nicht angemeldet“ bei `ipa init` | Nur eine Warnung. Ohne Claude arbeiten: `--no-analysis` und `--no-ai`. Mit Claude: `claude auth login`, danach `ipa doctor`. |
| `ipa capture` meldet „Ein anderer Lauf hält den Lock“ (Exit-Code 3) | Gleichzeitig läuft schon ein Lauf, etwa ein geplanter oder in einem anderen Terminal. Warte, bis er endet. Es wurde nichts verändert. |
| `ipa capture` meldet keine neue Arbeit | Seit dem letzten Snapshot hat sich nichts geändert. Das ist normal. |
| `ipa capture` hält an (Exit-Code 4) | Du hast den Branch gewechselt oder die Historie umgeschrieben. Mit `ipa baseline --reason "<Grund>"` setzt du einen neuen Ausgangspunkt. |
| Die Analyse scheitert (Exit-Code 6) | Claude war nicht erreichbar oder die Antwort war ungültig. Der Snapshot bleibt gespeichert, der nächste `capture` versucht es erneut. Journal ohne Claude: `ipa journal --no-ai`. |
| `npm ci` oder `npm run build` scheitert | Prüfe `node --version`: Node 24 oder neuer ist nötig. |
| Die App startet nicht oder meldet „Die mitgelieferte CLI-Laufzeit fehlt“ | Starte sie mit `npm run app:dev` aus dem Ordner des Werkzeugs (das baut das CLI zuerst) und prüfe `node --version` (24 oder neuer, im PATH). |
| Die App zeigt „Noch kein Projekt“ | Es gibt noch kein eingerichtetes Projekt, oder die Datenwurzel ist eine andere (Umgebungsvariable `IPA_ASSISTANT_HOME` gesetzt?). Richte ein Projekt mit `ipa init` ein. |
| Beim ersten Start der App erscheint „Downloading Electron binary…“ und es hängt | Der Download braucht Internet. Prüfe die Verbindung (Firmennetz, Proxy) und starte `npm run app:dev` erneut. |
| `npm test` zeigt 2 fehlgeschlagene Tests (`schedule-task`, `config`) | Bekannt und nur ein Testproblem: Windows meldet deine Zeitzone als `Europe/Berlin`, die Tests erwarten `Europe/Zurich`. Das Werkzeug selbst ist nicht betroffen, Einzelheiten in [`docs/app/spec.md` §19](docs/app/spec.md). |

Weitere Fehler erklärt die Meldung des Werkzeugs meist mit dem nächsten Schritt. Die Bedeutung der Exit-Codes steht unter [Exit-Codes](#exit-codes).

## Projektstand und Dokumentation

Die Umsetzung erfolgt in Paketen, geplant in [`docs/implementation/`](docs/implementation/README.md).

- **Das CLI** ist mit allen Befehlen von Version 1 umgesetzt (Pakete 01 bis 09): `ipa init`, `capture`, `skip`, `baseline`, `note`, `journal`, `schedule` (inklusive Verwaltung der Windows-Aufgabe), `config`, `status` und `doctor`, dazu maschinenlesbare Ergebnisse mit `--json`. Offen sind die Live-Abnahme mit echtem Claude und die manuelle Prüfung der Aufgabenplanung, siehe [Abnahmeprotokoll](docs/abnahme/v1-abnahmeprotokoll.md).
- **Die Desktop-App** ist bei Paket 10 von 14 (Gerüst). Fortschritt: [`docs/implementation/checklist.md`](docs/implementation/checklist.md).

Wo was steht:

| Ort | Inhalt |
| --- | --- |
| diese Datei | Einrichtung, Befehle, Datenablage, Kostenschutz |
| [`app/README.md`](app/README.md) | Desktop-App: Aufbau, Befehle, Tests, Sicherheit |
| [`docs/implementation/`](docs/implementation/README.md) | Pakete, Verträge des CLI (`spec.md`) und Fortschritt (`checklist.md`) |
| [`docs/app/spec.md`](docs/app/spec.md) | Spezifikation der Desktop-App |
| [`schemas/`](schemas/) | JSON-Schemas der Dateien und der `--json`-Ausgabe |
| [`CLAUDE.md`](CLAUDE.md) | Arbeitsregeln für Claude Code in diesem Repository |

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
runs.jsonl     Laufprotokoll: eine Zeile pro Lauf von init, capture, baseline und skip
lock           nur während eines Laufs von init, capture, baseline oder skip
doctor.json    letztes Ergebnis von ipa doctor (auch aus init)
ai-usage.jsonl KI-Nutzung: eine Zeile pro Modellaufruf, ohne Prompt, Eingabe und Antwort
snapshots/S000001/manifest.json          Manifest eines Snapshots
snapshots/S000001/content/E001.patch     gespeicherte Belege (Diffs, Commit-Nachrichten als .txt)
snapshots/S000001/content/state/0001.dat Kopie des aktuellen Stands einer geänderten Datei
notes/2026-10-14.jsonl                   Notizen eines Tätigkeitstags, eine Zeile pro Notiz
analyses/S000002/attempt-1/              ein Analyseversuch: input.json, prompt.md, schema.json, response.json, stderr.txt, outcome.json
analyses/S000002/analysis.json           geprüfter Analyse-Datensatz
analyses/S000002/complete.json           Abschlussmarkierung; skip.json nach ipa skip, retry-<n>.json nach --retry
logs/S000002.md                          Work-Log eines Snapshots
journal/runs/R20261014T160500Z-a3f9/     ein Journal-Lauf mit Claude: input.json, prompt.md, schema.json, response.json, stderr.txt, outcome.json
journal/drafts/2026-10-14-R….md und .json Journal-Entwürfe; jeder Lauf legt neue Dateien an, nichts wird überschrieben
journal/final/                           nur für die eigenen Endfassungen: das Tool legt den Ordner an, liest und schreibt dort aber nie
context/                                 optionale Ablage für Kontextdateien (Anforderungen, Planung)
tmp/                                     Hilfsdateien, zu Beginn jedes Laufs mit Lock geleert
```

### Getrennt vom Claude-Arbeitsverzeichnis

Claude Code läuft nie im Repository und nie im Arbeitsbereich, sondern in einem neuen, leeren Ordner unter `<Temp>/ipa-assistant/claude/<repositoryId>/`, der nach dem Aufruf gelöscht wird. Das gilt auch mit `--workspace .ipa`. Einzelheiten stehen unter [Claude Code](#claude-code-aufruf-schutzwirkung-und-grenzen).

### Sicherung

Das Tool sichert weder den Arbeitsbereich noch die Registry. Wo die Sicherung liegt, entscheidet der Benutzer beziehungsweise der Betrieb (offene Entscheidung O-07). Empfohlen:

- den ganzen Arbeitsbereich sichern, mindestens `snapshots/`, `analyses/`, `logs/`, `notes/`, `journal/` und `config.json`, dazu `registry.json` der Datenwurzel
- nur eine zugelassene Sicherung verwenden: Der Arbeitsbereich enthält Auszüge aus dem Quellcode (Diffs, Kopien geänderter Dateien)
- nicht während eines Laufs mit Lock sichern, oder die Sicherung danach wiederholen
- Liegt der Arbeitsbereich ausserhalb des Repositorys (Standard), erfasst eine Sicherung des Repositorys ihn nicht. Liegt er im Repository (`.ipa/`), gehört er trotzdem nicht ins Git-Repository, siehe den Hinweis zu `.gitignore` oben.

Wiederherstellen lässt sich ein Arbeitsbereich am gleichen Ort; die Registry verweist über den Pfad auf ihn.

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

### `ipa capture [--no-analysis] [--retry <snapshotId>] [--scheduled]`

Nimmt einen Arbeits-Snapshot auf, sofern seit dem letzten Snapshot neue Arbeit vorliegt (siehe [Zuordnung von Änderungen](#zuordnung-von-änderungen)). Danach verarbeitet `capture` die offenen Analysen, siehe [Analyse und Work-Logs](#analyse-und-work-logs).

- `--no-analysis`: nur aufnehmen. Offene Analysen bleiben offen und folgen im nächsten Lauf.
- `--retry <snapshotId>`: gibt für einen Snapshot im Status `exhausted` weitere Versuche frei (Datei `retry-<n>.json`) und verarbeitet danach die offenen Analysen. Für einen Snapshot in einem anderen Status endet der Befehl mit Exit-Code 2.
- `--scheduled`: für geplante Läufe, siehe [Zeitsteuerung](#zeitsteuerung). Vor allem anderen, auch vor dem Lock, prüft `capture` das Zeitfenster aus `schedule` in `config.json` in der konfigurierten Zeitzone. Ausserhalb endet der Lauf mit Exit-Code 0, ohne Aufnahme, ohne Claude und ohne Ausgabe auf stdout; auf stderr steht ein Hinweis, und `runs.jsonl` erhält einen Eintrag mit `outcome: outside_window`. Ohne `--scheduled` gibt es keine Fensterprüfung.

**Laufzeitgrenze:** Nach `limits.maxRunSeconds` (Standard 1800 s) seit dem Start des Laufs beginnt `capture` keinen neuen Claude-Aufruf mehr. Ein laufender Aufruf endet regulär oder mit seinem Timeout (`claude.timeoutSeconds`). Die übrigen Snapshots bleiben offen und folgen im nächsten Lauf; Snapshots ohne Analysepflicht schliesst `capture` weiterhin ohne Claude ab. Die Grenze allein ergibt keinen Fehler: Der Exit-Code ist 0, solange kein Snapshot `failed`, `blocked` oder `exhausted` ist, und stderr nennt den nächsten offenen Snapshot.

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
- Die offenen Analysen laufen auch nach einem Halt, ohne neue Arbeit und nach einem unruhigen Stand, damit gesicherte Snapshots nicht warten.
- Exit-Code: 0, wenn Aufnahme und Analysen ohne offene Fehler enden, auch ausserhalb des Zeitfensters mit `--scheduled`; 6, wenn danach ein Snapshot `failed`, `blocked` oder `exhausted` ist oder Claude nicht einsatzbereit ist; 4 bei einem Halt, auch wenn zusätzlich eine Analyse scheitert; 5 bei unruhigem Stand, ausser eine Analyse ist nicht abgeschlossen (dann 6).

```text
> ipa capture
Snapshot S000002 gespeichert (Arbeits-Snapshot).
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
Analyse S000001 abgeschlossen (ohne KI), Work-Log: logs/S000001.md
Analyse S000002 abgeschlossen (Claude), Work-Log: logs/S000002.md
Analyse-Cursor: S000002; offene Analysen: keine
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

### `ipa skip <snapshotId> --reason <text>`

Lässt die Analyse eines offenen Snapshots bewusst aus, zum Beispiel wenn Claude für diesen Stand dauerhaft scheitert oder das Eingabepaket zu gross ist. Der Snapshot bleibt gespeichert, die Lücke bleibt in `ipa status` und später im Journal sichtbar.

- Erlaubt nur für offene Analysen (`pending`, `failed`, `blocked`, `exhausted`). Für abgeschlossene, bereits übersprungene, unbekannte Snapshots und für Snapshots ohne Analysepflicht (`not_required`) endet der Befehl mit Exit-Code 2.
- `--reason` ist Pflicht und steht in `analyses/<snapshotId>/skip.json`. Ein leerer Grund oder einer, der wie ein Zugangsdatum aussieht, ergibt Exit-Code 2.
- Nimmt den Lock, schreibt `skip.json`, führt den Analyse-Cursor nach und protokolliert den Lauf in `runs.jsonl`. Claude wird nicht aufgerufen.

```text
> ipa skip S000004 --reason "Nur generierte Dateien, keine eigene Leistung"
Analyse S000004 übersprungen (vorher exhausted). Die Lücke bleibt in status und im Journal sichtbar.
Analyse-Cursor: S000004
```

### `ipa note [text] [optionen]`

Erfasst eine Notiz: eine Tätigkeit, ein Problem, eine Entscheidung, eine Erkenntnis oder eine Planung, auf Wunsch mit gemessenem oder geschätztem Zeitaufwand. Ohne Text fragt der Befehl im Terminal nach. `note` braucht keinen Snapshot und nimmt keinen Lock, es funktioniert also direkt nach `ipa init` und auch während eines laufenden `capture`. Einzelheiten und Beispiele stehen unter [Notizen](#notizen). Ein Verweis mit `--ref` muss auf einen gespeicherten Beleg zeigen, und bei einem möglichen Zugangsdatum warnt `note`, ohne den Wert zu nennen.

### `ipa journal [--day <YYYY-MM-DD>] [--no-ai]`

Erzeugt einen belegten Journal-Entwurf für einen Tag aus den Analysen, Commits, Notizen und Kontextdateien dieses Tages. Einzelheiten stehen unter [Tagesjournal](#tagesjournal).

- `--day`: Tag des Journals, Standard ist heute in der Zeitzone aus `config.json`. Ein ungültiger Tag (zum Beispiel `2026-02-30` oder `14.10.2026`) ergibt Exit-Code 2.
- `--no-ai`: Der Entwurf entsteht deterministisch ohne Claude, aus den Notizen und den Aussagen der Work-Logs. Das ist der Rückweg, wenn Claude nicht verfügbar ist oder das Limit erreicht ist. Gibt es für den Tag weder Snapshots noch verwendbare Notizen, arbeitet `journal` auch ohne `--no-ai` so.
- Jeder Lauf legt einen neuen Entwurf `journal/drafts/<Tag>-<runId>.md` mit Datensatz `.json` an. Frühere Entwürfe und `journal/final/` bleiben unverändert.
- `journal` nimmt keinen Lock, läuft also auch während eines `capture`, und schreibt keinen Eintrag in `runs.jsonl`. Nachweis eines Laufs sind der Entwurf, bei Claude zusätzlich `journal/runs/<runId>/` und die Zeile in `ai-usage.jsonl`.
- Scheitert Claude, ist die Antwort ungültig oder die Eingabe grösser als `limits.maxJournalInputBytes` (Standard 512 KiB), entsteht kein Entwurf: Exit-Code 6, die Meldung nennt `ipa journal --day <Tag> --no-ai`. Die Eingabe wird nie gekürzt.

```text
> ipa journal
Journal-Entwurf für 2026-10-14 gespeichert: KI-Entwurf mit Claude.
Entwurf:              C:/Users/…/workspaces/mein-projekt-3fa9c1/journal/drafts/2026-10-14-R20261014T160500Z-a3f9.md
Datensatz:            C:/Users/…/workspaces/mein-projekt-3fa9c1/journal/drafts/2026-10-14-R20261014T160500Z-a3f9.json
Offene Analysen:      keine
Lücken und Prüfungen: 1
Bitte persönlich prüfen, korrigieren und die Endfassung manuell nach journal/final/ übernehmen.
```

### `ipa schedule --os <windows|cron> [--output <datei>]`

Gibt eine Vorlage für den Scheduler des Betriebssystems aus. Der Aufruf mit `--os` **installiert nichts** und ändert keine Systemeinstellung; die Einrichtung von Hand ist in [Zeitsteuerung](#zeitsteuerung) beschrieben. Die Unterbefehle `install`, `status`, `pause`, `resume`, `remove` und `run` verwalten dagegen die Aufgabe selbst (siehe [Zeitplan-Verwaltung](#ipa-schedule-install--status--pause--resume--remove--run)).

- `--os windows`: XML für die Windows-Aufgabenplanung (Aufgabenschema 1.2) mit der Aufgabe `ipa-assistant-<repositoryId>`.
- `--os cron`: crontab-Zeilen mit `CRON_TZ`, gekennzeichnet als „nicht geprüft – Plattform in V1 nicht getestet“.
- Ohne `--output` erscheint die Vorlage auf stdout. `--output <datei>` legt eine **neue** Datei an; existiert sie, endet der Befehl mit Exit-Code 2 und ändert nichts. Die Windows-Vorlage wird dabei als UTF-16 mit BOM geschrieben, wie sie die Aufgabenplanung selbst exportiert.
- Die Ausgabedatei darf nicht im untersuchten Repository liegen, sonst erfasste der nächste Lauf die Vorlage als Entwicklungsarbeit (Exit-Code 2). Erlaubt ist ein Ort ausserhalb oder der eigene Arbeitsbereich, nicht aber `journal/final/`.
- Die Vorlage ruft Node.js und `dist/cli.js` dieser Installation mit absoluten Pfaden auf: `"<node.exe>" "<…/dist/cli.js>" capture --scheduled --repo "<repository>"`. Stammt die Datenwurzel aus `--data-dir` oder `IPA_ASSISTANT_HOME`, kommt `--data-dir "<datenwurzel>"` dazu, weil eine geplante Aufgabe eine nur in der Sitzung gesetzte Variable nicht sieht.
- Warnungen auf stderr, die Vorlage entsteht trotzdem: ein Zusatzlauf aus `schedule.extraRunTimes` ausserhalb des Zeitfensters (`--scheduled` würde ihn überspringen), ein `intervalMinutes` länger als das Fenster, ein `claude.timeoutSeconds` über 10 Minuten (siehe unten), eine fehlende `dist/cli.js`.
- Ist `schedule.workdays` leer, endet der Befehl mit Exit-Code 2.
- `schedule` braucht ein initialisiertes Repository, nimmt keinen Lock und schreibt keinen Eintrag in `runs.jsonl`.

```text
> ipa schedule --os windows --output C:\Users\anna\ipa-projekt.xml
Vorlage für die Windows-Aufgabenplanung geschrieben: C:/Users/anna/ipa-projekt.xml
Aufgabe: ipa-assistant-mein-projekt-3fa9c1
Import von Hand (ändert die Aufgabenplanung, ipa installiert nichts): schtasks /Create /XML "C:\Users\anna\ipa-projekt.xml" /TN ipa-assistant-mein-projekt-3fa9c1
```

### `ipa schedule install | status | pause | resume | remove | run`

Verwaltet die Aufgabe `ipa-assistant-<repositoryId>` in der Windows-Aufgabenplanung über `schtasks`. Anders als `ipa schedule --os …` **ändern diese Befehle die Aufgabenplanung**, aber nur auf ausdrücklichen Aufruf: Nichts richtet einen Zeitplan von selbst ein, und `ipa init` tut es nicht. Der Zeitplan bleibt in der Windows-Aufgabenplanung und läuft auch ohne die App. Die Befehle laufen nur unter Windows (sonst Exit-Code 2), brauchen ein initialisiertes Repository, nehmen keinen Lock und schreiben keinen Eintrag in `runs.jsonl`. Alle kennen `--json`.

| Befehl | Wirkung |
| --- | --- |
| `status` | Zeigt den Zustand der Aufgabe und ändert nichts (siehe unten). |
| `install [--update]` | Richtet die Aufgabe mit der Vorlage von `ipa schedule --os windows` ein (`schtasks /Create /XML`). Existiert sie schon, endet der Befehl mit Exit-Code 2; `--update` ersetzt sie durch die aktuelle Konfiguration. Eine pausierte Aufgabe bleibt dabei pausiert. |
| `pause` | Deaktiviert die Aufgabe (`schtasks /Change /DISABLE`); sie startet dann nichts mehr. |
| `resume` | Aktiviert sie wieder. |
| `remove` | Entfernt sie (`schtasks /Delete /F`). Gibt es sie nicht, ist das Exit-Code 0 ohne Änderung. |
| `run` | Startet die Aufgabe jetzt (`schtasks /Run`), also `ipa capture --scheduled` und damit **eine Analyse mit Claude**, wenn offene Arbeit vorliegt. Ausserhalb des Zeitfensters endet dieser Lauf ohne Aufnahme (`outside_window`); der Befehl warnt dann. Er wartet nicht auf das Ende des Laufs. |

Zustand (`status` und jeder andere Befehl danach):

| Zustand | Bedeutung |
| --- | --- |
| nicht eingerichtet | Die Aufgabe gibt es nicht. |
| aktiv | Eingerichtet, aktiviert und aktuell |
| pausiert | Deaktiviert, sonst aktuell |
| veraltet | Die Aufgabe weicht von dem ab, was `install` jetzt erzeugen würde: Pfad zu Node, Pfad zu `dist/cli.js`, die übrigen Argumente, die Trigger (Wochentag, Startzeit, Wiederholung) oder das Zeitlimit. Der Vergleich liest die Definition aus der Aufgabenplanung; eine von Hand geänderte Aufgabe wird erkannt. |
| Fehler | Der Zustand liess sich nicht bestimmen (zum Beispiel `schtasks` fehlt oder verweigert den Zugriff). |

Dazu zeigt `status` den nächsten und den letzten Lauf mit dem Ergebnis der Aufgabenplanung. Diese Angaben liest `ipa` aus der lokalisierten Ausgabe von `schtasks`; erkennt es ein Datumsformat nicht eindeutig, steht „unbekannt“ (`null` in `--json`).

Dieselbe Funktion berechnet die **Läufe pro Arbeitstag** und die **Obergrenze der Claude-Aufrufe pro Tag**: Anzahl der Läufe im Zeitfenster mal `claude.maxAnalysesPerRun`. Ein Lauf genau am Fensterende wird vorsichtig mitgezählt, weil nicht beobachtet ist, ob die Aufgabenplanung ihn auslöst. Zusatzläufe ausserhalb des Fensters zählen nicht, denn `--scheduled` beendet sie ohne Aufnahme. Mit den Standardwerten sind das 7 Läufe und höchstens 35 Aufrufe pro Arbeitstag; ohne neue Arbeit ruft ein Lauf Claude gar nicht auf.

```text
> ipa schedule status
Aufgabe:       ipa-assistant-mein-projekt-3fa9c1
Zustand:       aktiv
Aktiviert:     ja
Nächster Lauf: 2026-10-14T16:00:00+02:00
Letzter Lauf:  2026-10-14T14:00:03+02:00, Ergebnis 0
Läufe:         08:00, 10:00, 12:00, 14:00, 16:00, 17:45, 18:00 (7 Läufe); höchstens 35 Claude-Aufrufe pro Arbeitstag (der Lauf am Fensterende ist vorsichtig mitgezählt)
```

Hinweise:

- Eine Änderung an `schedule`, `limits.maxRunSeconds` oder `claude.timeoutSeconds` verändert die eingerichtete Aufgabe nicht. `status` zeigt sie dann als „veraltet“, `install --update` gleicht sie ab.
- Die Aufgabe läuft nur bei angemeldetem Benutzer. Verpasste Läufe holt sie nach.
- Automatische Tests sprechen die echte Aufgabenplanung nie an: `schtasks` läuft über einen austauschbaren Runner, den die Tests ersetzen. Das Verhalten an der echten Aufgabenplanung ist noch nicht manuell geprüft, siehe [Zeitsteuerung](#zeitsteuerung).

### `ipa doctor [--live]`

Prüft, ob Git und Claude Code für die Analyse bereit sind. Ohne `--live` findet **kein Modellaufruf** statt.

- **Git:** `git --version`
- **Claude Code:** Version (`claude --version`) und Anmeldung (`claude auth status`). Übernommen werden nur, ob eine Anmeldung besteht, und die Anmeldeart, nie E-Mail-Adresse, Organisation oder Token.
- **Optionen:** Für jede Option des [Claude-Aufrufs](#claude-code-aufruf-schutzwirkung-und-grenzen) startet `doctor` `claude -p <option> [wert] --zz-ipa-probe` mit leerer Eingabe. Meldet Claude Code die Prüfoption als unbekannt, kennt es die geprüfte Option. Es entsteht kein Prompt und damit kein Modellaufruf. Pflicht sind die elf Optionen des Aufrufs, `--model` nur mit einem Modell in `claude.model`. `--safe-mode`, `--setting-sources` und `--verbose` sind optional; `--safe-mode` verwendet `ipa`, sobald `doctor` die Option findet.
- **Kostenschutz:** ob ein API-Schlüssel oder ein externer Anbieter erkannt ist, aus Umgebung, Claude-Einstellungen und `claude auth status` (siehe [Kostenschutz](#kostenschutz)), und ob `claude.allowPaidUsage` kostenpflichtige Nutzung erlaubt. Genannt werden nur Namen, nie Werte. Ist ein solcher Weg erkannt, aber nicht erlaubt, ist das Ergebnis „nicht bereit“, und `--live` entfällt. Mit gesetztem `ANTHROPIC_API_KEY` meldet `claude auth status` weiterhin die Anmeldeart `claude.ai`, obwohl Claude Code den Schlüssel verwendet; massgebend ist dann die Zeile „API-Schlüssel“. Siehe [Kostenschutz](#kostenschutz).
- **Ergebnis:** eine kompakte Liste auf stdout, Befunde auf stderr, Exit-Code 0 (bereit) oder 7 (nicht bereit). Das Ergebnis steht in `doctor.json` im Arbeitsbereich, `ipa status` zeigt es unter `claude`.
- `doctor` braucht ein initialisiertes Repository (sonst Exit-Code 2), nimmt keinen Lock und schreibt keinen Eintrag in `runs.jsonl`. Die Prüfprozesse laufen im selben leeren Temp-Ordner wie jeder Claude-Aufruf.
- Ob die Anmeldung der zugelassene geschäftliche Zugang ist, lässt sich technisch nicht prüfen und ist organisatorisch zu bestätigen. `doctor` weist darauf hin.

```text
> ipa doctor
Git:                      gefunden, Version 2.52.0.windows.1
Claude Code:              gefunden, Version 2.1.201
Anmeldung:                angemeldet, Anmeldeart claude.ai
Pflichtoptionen:          alle 11 erkannt
Weitere Optionen:         --safe-mode ja, --setting-sources ja, --model ja, --verbose ja
--safe-mode:              wird verwendet
--setting-sources:        wird nicht verwendet, bis ipa doctor --live die Anmeldung damit bestätigt (A-08)
API-Schlüssel:            nicht erkannt
Externer Anbieter:        nicht erkannt
Kostenpflichtige Nutzung: nicht erlaubt (claude.allowPaidUsage: false)
Live-Prüfung:             nicht ausgeführt (ipa doctor --live)
Ergebnis:                 bereit
Hinweis: Ob diese Anmeldung der zugelassene geschäftliche Zugang ist, lässt sich technisch nicht prüfen und ist organisatorisch zu bestätigen (O-02).
```

Mit gesetztem `ANTHROPIC_API_KEY` und ohne Freigabe lauten die betroffenen Zeilen so (Exit-Code 7):

```text
API-Schlüssel:            erkannt: ANTHROPIC_API_KEY
Kostenpflichtige Nutzung: nicht erlaubt (claude.allowPaidUsage: false), Modellaufrufe sind gesperrt
Ergebnis:                 nicht bereit
Hinweis: Ein API-Schlüssel hat bei claude -p Vorrang vor der Abo-Anmeldung, auch wenn die Anmeldeart claude.ai lautet.
```

Aus den Claude-Einstellungen erscheint die Quelle in Klammern, etwa `apiKeyHelper (Benutzereinstellungen)` oder `env.CLAUDE_CODE_USE_BEDROCK (Richtlinie HKLM)`. Einstellungen, die kein gültiges JSON-Objekt sind, meldet `doctor` als Befund, ohne deswegen zu sperren.

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
| `analyses` | `{ pending, failed, blocked, exhausted, complete, skipped, notRequired, openIds }`: Anzahl der Snapshots je [Status](#status-einer-analyse) und die IDs der offenen (`pending`, `failed`, `blocked`, `exhausted`). `notRequired` zählt Snapshots ohne Analysepflicht, die der nächste `capture` ohne Claude abschliesst. |
| `withheld` | `{ units, notes }`: wegen Secret-Verdacht zurückgehaltene Einheiten aller Snapshots und Notizen mit möglichem Zugangsdatum. Beides sind offene Prüfungen; die Werte selbst erscheinen nie. |

### `ipa config get | check | set`

Liest, prüft und ändert die `config.json` des Repositorys. Die Konfiguration gilt pro Projekt; es gibt keine globalen Standardwerte. Die Befehle brauchen ein initialisiertes Repository, nehmen keinen Lock und schreiben keinen Eintrag in `runs.jsonl`. Alle kennen `--json`. Ein laufender `capture` behält die Konfiguration, mit der er gestartet ist; Änderungen gelten ab dem nächsten Lauf. Von Hand lässt sich die Datei weiterhin bearbeiten, jeder Befehl prüft sie beim Laden.

```text
ipa config get [<pfad>]
ipa config check
ipa config set <pfad=wert>... [--dry-run] [--confirm-paid-usage]
```

- **`get`** gibt die Datei oder einen Wert aus, etwa `ipa config get claude.maxAnalysesPerRun`. Pfade bestehen aus Feldnamen mit Punkten; Arrays werden als Ganzes gelesen. Ein unbekannter Pfad ergibt Exit-Code 2.
- **`check`** prüft die Datei und meldet alle Befunde mit Schwere (`error` oder `warning`), Code und Pfad, auch bei einer ungültigen Datei. Exit-Code 0 ohne Fehler, sonst 2. Geprüft werden das Schema, die Regeln (Zeitzone, reguläre Ausdrücke, `windowStart` vor `windowEnd`), die Übereinstimmung mit dem Eintrag in der Registry und die Zeitplanregeln von `ipa schedule`: leere `schedule.workdays` (Fehler), ein Zusatzlauf ausserhalb des Fensters, ein Intervall länger als das Fenster und ein `claude.timeoutSeconds` über 10 Minuten (Warnungen). Dazu die [Läufe pro Arbeitstag und die Obergrenze der Claude-Aufrufe](#ipa-schedule-install--status--pause--resume--remove--run).
- **`set`** ersetzt die genannten Felder. Jede Zuweisung hat die Form `pfad=wert`; der Wert ist JSON (`60`, `true`, `null`, `["mon","tue"]`), sonst Text (`claude.model=opus`). Arrays und Objekte werden als Ganzes ersetzt. Der Befehl prüft das Ergebnis wie `check` und schreibt nur, wenn kein Befund die Schwere `error` hat; Warnungen verhindern das Schreiben nicht. Bei einem Fehler bleibt die Datei Byte für Byte unverändert (Exit-Code 2). `--dry-run` prüft nur.
- **Atomar:** Geschrieben wird in eine temporäre Datei im selben Ordner und danach umbenannt. Hat sich `config.json` seit der Prüfung geändert, etwa durch eine Handänderung, ersetzt der Befehl sie nicht (Exit-Code 2, `config_changed`). Weil nur die genannten Felder ersetzt werden, bleiben Handänderungen an anderen Feldern erhalten.
- **Nicht änderbar nach `init`:** `repositoryId`, `repository.path`, `timezone` und `schemaVersion`. Die Zeitzone bestimmt, welchem Tag vorhandene Daten zugeordnet sind. Eine solche Änderung ergibt Exit-Code 2 `config_immutable`, auch über einen übergeordneten Pfad wie `repository={…}`.
- **Kostenpflichtige Nutzung:** `claude.allowPaidUsage` bleibt standardmässig `false`. Es lässt sich nur mit dem ausdrücklichen Flag `--confirm-paid-usage` auf `true` setzen: `ipa config set claude.allowPaidUsage=true --confirm-paid-usage`. Ohne das Flag endet der Befehl mit Exit-Code 2 (`paid_usage_confirmation_required`) und schreibt nichts, auch wenn die Zuweisung ein ganzes Objekt wie `claude={…}` betrifft. Das Flag erlaubt nur; es setzt nichts selbst. Das Abschalten braucht kein Flag. Mit freigegebener Nutzung können API-Schlüssel und externe Anbieter Kosten pro Anfrage verursachen, siehe [Kostenschutz](#kostenschutz).
- Betrifft eine Änderung `schedule`, `limits.maxRunSeconds` oder `claude.timeoutSeconds`, weist der Befehl darauf hin, dass eine eingerichtete Aufgabe unverändert bleibt.

```text
> ipa config set schedule.intervalMinutes=60 claude.maxAnalysesPerRun=3
config.json aktualisiert: schedule.intervalMinutes, claude.maxAnalysesPerRun.
Läufe pro Arbeitstag: 08:00, 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 17:45, 18:00 (12 Läufe); höchstens 36 Claude-Aufrufe pro Arbeitstag
Hinweis: Eine bereits eingerichtete Aufgabe der Aufgabenplanung bleibt unverändert. ipa schedule status zeigt Abweichungen, ipa schedule install --update gleicht sie ab.
```

### Maschinenlesbare Ergebnisse (`--json`)

`ipa init`, `capture`, `journal`, `note`, `skip`, `baseline` und `doctor`, dazu `config` und die Befehle der [Zeitplan-Verwaltung](#ipa-schedule-install--status--pause--resume--remove--run), geben mit `--json` genau **ein JSON-Objekt** auf stdout aus statt der Textzeilen. Das Format ist wie `ipa status --json` ein stabiler Vertrag für andere Programme, etwa eine Oberfläche. Die Schemas liegen unter `schemas/cli-<befehl>.schema.json`.

- stderr und Exit-Code sind identisch zum Aufruf ohne `--json`; Warnungen und Fehlermeldungen erscheinen dort weiterhin. Ohne `--json` ändert sich nichts. `ipa status --json` behält sein eigenes Format ohne Hülle.
- Ein Bedienungsfehler von Commander vor dem Start (unbekannte Option, fehlender Wert) liefert kein JSON, nur stderr und Exit-Code 2.
- Pfade sind absolut mit `/`, Zeitstempel ISO 8601 mit Offset in der Zeitzone aus `config.json`. Das Objekt enthält nie Dateiinhalte, Notiztexte, Gründe oder erkannte Secret-Werte.
- `ipa note --json` braucht den Text als Argument (kein interaktiver Modus). Beginnt er mit `-`, steht `--` davor: `ipa note --json -- "- Recherche"`.

Hülle aller Befehle:

| Feld | Inhalt |
| --- | --- |
| `schemaVersion` | `1` |
| `command` | `init`, `capture`, `journal`, `note`, `skip`, `baseline`, `doctor`, `config` oder `schedule` |
| `runId` | ID des Aufrufs, `null` bei einem Fehler vor dem Start des Befehls |
| `ok`, `exitCode` | `ok` ist `exitCode === 0` |
| `outcome` | `ok`, `unchanged`, `halted`, `unstable`, `lock_held`, `analysis_failed`, `outside_window`, `usage_error` oder `error`, wie in `runs.jsonl` |
| `errors` | `{ code, message }`, wie `errors` in `runs.jsonl`; bei Exit-Code 0 leer |
| `warnings` | die Warnungen und Hinweise, die auch auf stderr stehen |
| `result` | Ergebnis des Befehls, `null` bei Exit-Code 1, 2 und 3. Ein Halt (4), ein instabiler Stand (5), ein unvollständiger KI-Schritt (6) und eine nicht bestandene Prüfung (7) liefern ein Ergebnis. |

Inhalt von `result`:

| Befehl | Felder |
| --- | --- |
| `capture` | `scheduled`, `outsideWindow` (`weekday`, `time`, `reason` oder `null`), `capture` (`created`, `unchanged`, `halted`, `unstable`, `skipped`), `snapshot` (`id`, `kind`, `manifestPath`, `commits`, `fileStates`, `evidence`, `stateDeltas`, `statusChanges`, `testReports`, `gaps`, `excluded`, `withheld`, `omitted`, `analysisRequired` oder `null`), `halt`, `recovered`, `retry`, `analysis` (`claudeCalls`, `completed` mit `workLogPath`, `failed`, `caughtUp`, `stoppedBy`, `cursor`, `open`; `null` mit `--no-analysis`), `analyses` (Stand aller Analysen wie bei `status`, mit den offenen IDs) |
| `init` | `created`, `repositoryId`, `repoPath`, `workspacePath`, `workspaceMode`, `dataRoot`, `timezone`, `baselineSnapshotId`, `baselineAdopted`, `recovered`, `claude` (Prüfung ohne Modellaufruf) |
| `journal` | `day`, `mode`, `noAiReason`, `draftPath`, `recordPath`, `runDir`, `failure`, `openItems` (offene Analysen und Lücken) |
| `note` | `noteId`, `type`, `activityDay`, `recordedAt`, `notePath`, `time`, `delay`, `refs`, `secretFindings` (Feld und Detektor, nie der Wert). Die Notiz wird auch bei einem Treffer gespeichert. |
| `skip` | `snapshotId`, `previousStatus`, `cursor`, `skipPath`, `recovered` |
| `baseline` | `snapshotId`, `manifestPath`, `forced`, `endedHalt`, `recovered` |
| `doctor` | `live`, `checkedAt`, `ok`, `git`, `claude`, `liveCheck`, `liveCarriedOver`, `missingFlags`, `billing`, `findings` |
| `config` | `action`, `configPath`, `path`, `value`, `valid`, `findings`, `changes`, `written`, `dryRun`, `schedulePlan` |
| `schedule` | `action`, `taskName`, `changed`, `state`, `enabled`, `differences`, `detail`, `nextRun`, `lastRun`, `lastResult`, `running`, `insideWindow`, `plan` |

```text
> ipa capture --no-analysis --json
{
  "schemaVersion": 1,
  "command": "capture",
  "runId": "R20261014T160300Z-a3f9",
  "ok": true,
  "exitCode": 0,
  "outcome": "ok",
  "errors": [],
  "warnings": [],
  "result": {
    "capture": "created",
    "snapshot": { "id": "S000002", "manifestPath": "C:/Users/…/snapshots/S000002/manifest.json", "evidence": 12, "analysisRequired": true, … },
    "analysis": null,
    "analyses": { "pending": 1, "openIds": ["S000002"], … },
    …
  }
}
```

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| 0 | Erfolg, auch wenn `capture` keine neue Arbeit findet oder mit `--scheduled` ausserhalb des Zeitfensters startet |
| 1 | Unerwarteter interner Fehler. Mit `IPA_DEBUG=1` wird der Stacktrace ausgegeben. Dazu zählt ein Fehler von `schtasks` bei einem Befehl der Zeitplan-Verwaltung, der die Aufgabenplanung ändert. |
| 2 | Bedienungs- oder Konfigurationsfehler: ungültige Argumente oder Konfiguration (auch ein ungültiger Tag bei `ipa journal --day`), kein Git-Repository, nicht initialisiert, kein Ausgangs-Snapshot, unzulässige oder nicht beschreibbare Datenwurzel, unbekannte Schemaversion, `ipa note` ohne Text und ohne Terminal oder mit abgebrochener Eingabe, ein Temp-Verzeichnis im Repository oder im Arbeitsbereich, bei `ipa schedule` ein unbekanntes `--os`, eine vorhandene Ausgabedatei, eine Ausgabedatei im Repository oder keine Arbeitstage, bei den Unterbefehlen von `ipa schedule` eine andere Plattform als Windows, eine vorhandene (`install`) oder fehlende (`pause`, `resume`, `run`) Aufgabe, bei `ipa config` ein unbekannter Pfad, ein Befund der Schwere `error`, ein Versuch, ein nach `init` fixes Feld zu ändern, oder `claude.allowPaidUsage=true` ohne `--confirm-paid-usage`, bei `--json` bei `ipa note` ein fehlender Text |
| 3 | Ein anderer Lauf hält den Lock. |
| 4 | Die Zuordnung ist wegen Branchwechsel oder umgeschriebener Historie angehalten. `ipa baseline` ist erforderlich. |
| 5 | Der Arbeitsstand hat sich während der Aufnahme wiederholt verändert. Es wurde kein Snapshot gespeichert. |
| 6 | Der KI-Schritt ist nicht abgeschlossen: Claude ist nicht einsatzbereit oder meldet einen Fehler, kostenpflichtige Nutzung ist erkannt, aber nicht freigegeben ([Kostenschutz](#kostenschutz)), die Antwort ist ungültig, das Eingabepaket ist zu gross (`blocked`) oder die Versuche sind erschöpft (`exhausted`). Gesicherte Daten bleiben offen. Bei `ipa journal` entsteht dann kein Entwurf; `--no-ai` erzeugt ihn ohne Claude. |
| 7 | `ipa doctor`: Die Voraussetzungen sind nicht erfüllt. |

Treffen mehrere Fälle zu, gilt der höchste Code. Ausnahmen: Code 1 hat immer Vorrang, und bei `capture` geht ein Halt (4) einer nicht abgeschlossenen Analyse (6) vor, weil erst `ipa baseline` die Aufnahme wieder ermöglicht.

## Analyse und Work-Logs

Nach jeder Aufnahme verarbeitet `ipa capture` die offenen Snapshots der Reihe nach. Das Ziel ist ein belegter Entwurf pro Snapshot: Jede Aussage nennt die Belege, auf die sie sich stützt. Der Entwurf ersetzt die persönliche Prüfung nicht.

### Ablauf

1. Verarbeitet wird in aufsteigender Reihenfolge ab dem **Analyse-Cursor** (`lastAnalysedSnapshotId` in `ipa status`).
2. **Ohne Claude** abgeschlossen werden Ausgangs-Snapshots und Snapshots ohne neuen Inhalt, die nur Statusänderungen bereits dokumentierter Stände enthalten (`analysisRequired: false`). Sie erhalten einen deterministischen Work-Log. Der Log eines Ausgangs-Snapshots trägt die Überschrift „Ausgangslage – keine neu erbrachte Leistung“.
3. Für alle anderen baut das Tool ein **Eingabepaket**, prüft dessen Grösse, ruft Claude Code auf (siehe [Claude Code](#claude-code-aufruf-schutzwirkung-und-grenzen)) und prüft die Antwort.
4. Nur eine gültige Antwort wird übernommen: zuerst `analysis.json`, dann `logs/<snapshotId>.md`, dann `complete.json`. Erst danach rückt der Cursor vor.
5. Die Verarbeitung hält beim ersten Snapshot an, der offen bleibt. Der Cursor springt nie über einen offenen Snapshot.

Grenzen pro Lauf: höchstens `claude.maxAnalysesPerRun` (Standard 5) Aufrufe von Claude, und nach `limits.maxRunSeconds` (Standard 1800 s) seit dem Start des Laufs beginnt kein neuer Aufruf mehr (siehe [`ipa capture`](#ipa-capture---no-analysis---retry-snapshotid---scheduled)). Weitere Snapshots folgen im nächsten Lauf. Ist nichts offen, ruft `capture` Claude nicht auf, auch nicht für die Prüfung der Voraussetzungen.

### Eingabepaket

Claude erhält ausschliesslich `attempt-<n>/input.json` über stdin:

- aus dem Snapshot die Zustandsdeltas, Commit-Nachrichten und Testberichte mit Inhalt; Commit-, Staged- und Unstaged-Diffs gehen nicht an Claude
- die Commits ohne Blob-IDs, die Statusänderungen und ob ein Commit vom konfigurierten Benutzer stammt
- die Notizen, die im Beobachtungszeitraum `(von, bis]` des Snapshots erfasst wurden oder mit `--ref` auf ihn verweisen; ein Verweis auf einen nicht vorhandenen Beleg wird mit Warnung ignoriert
- die Kontextdateien aus `context.files` in `config.json`, etwa Anforderungen oder eine Planung, mit den IDs `C01`, `C02` … in der Reihenfolge der Konfiguration. Pfade sind relativ zur Repository-Wurzel oder absolut; die Ablage `context/` im Arbeitsbereich eignet sich dafür. Wie Testberichte umgehen sie den Pfadfilter, werden aber bei jedem Versuch neu gelesen und geprüft. Eine fehlende, binäre oder über `limits.maxContextFileBytes` (Standard 128 KiB) grosse Datei wird mit Grund ausgelassen, ohne Abbruch.
- in `filterSummary` nur die Anzahl ausgeschlossener, zurückgehaltener und ausgelassener Einheiten, nie ihre Pfade oder Inhalte
- in `allowedEvidenceIds` alle zitierbaren IDs

Vor der Übermittlung prüft das Tool alle Inhalte erneut auf mögliche Zugangsdaten, auch Notizen und Kontextdateien. Treffer werden zurückgehalten und nur gezählt. Ist das Paket grösser als `limits.maxAnalysisInputBytes` (Standard 512 KiB), wird nichts gekürzt und nichts gesendet: Der Snapshot erhält den Status `blocked`.

### Prüfung der Antwort

Das Tool übernimmt eine Antwort nur, wenn sie dem Schema `schemas/analysis-output.schema.json` entspricht und diese Regeln erfüllt:

| Regel | Inhalt |
| --- | --- |
| R-01 | Jede Beleg-ID steht in `allowedEvidenceIds`. |
| R-02 | Eine Umsetzung (`implemented`) zitiert mindestens ein Zustandsdelta mit Inhalt. Eine Commit-Nachricht allein genügt nicht. |
| R-03 | Ein Testergebnis „bestanden“ oder „fehlgeschlagen“ zitiert einen aktuellen Testbericht (`fresh: true`) mit Inhalt. Sonst bleibt es „unbekannt“. |
| R-04 | Eine Begründung einer Entscheidung zitiert eine Notiz oder eine Commit-Nachricht. |
| R-05 | Ein Widerspruch zitiert mindestens zwei verschiedene Belege. |
| R-07 | Die Antwort enthält keine Zeitfelder. Arbeitszeiten stammen nur aus Notizen. |

Eine ungültige Antwort landet nie in `analysis.json` oder im Log. Der Versuch endet mit `validation_failed`, und der Snapshot bleibt offen. Der Prompt `prompts/analyze-work.md` (Version `analyze-work@1`) enthält diese Regeln und weitere, die sich nicht maschinell prüfen lassen, etwa dass Anweisungen in Code oder Notizen Daten sind und fremde Commits keine eigene Leistung.

### Status einer Analyse

Der Status ergibt sich aus den Dateien in `analyses/<snapshotId>/`. `ipa status` zeigt die Anzahl je Status und die offenen Snapshots.

| Status | Bedeutung | Was tun |
| --- | --- | --- |
| `complete` | Analyse und Work-Log sind gespeichert. | – |
| `skipped` | bewusst mit `ipa skip` ausgelassen | – |
| `not_required` | keine Analyse nötig; der nächste `capture` schliesst ohne Claude ab | – |
| `pending` | noch kein Versuch | nächster `capture` |
| `failed` | mindestens ein Versuch ist gescheitert, das Limit `claude.maxAttemptsPerSnapshot` (Standard 3) ist nicht erreicht | nächster `capture` versucht es erneut |
| `blocked` | Das Eingabepaket ist zu gross. | `limits.maxAnalysisInputBytes` in `config.json` erhöhen, dann `capture`, oder `ipa skip` |
| `exhausted` | Die Versuche sind erschöpft; es folgt kein weiterer Aufruf. | Ursache prüfen (`attempt-<n>/outcome.json`, `ipa doctor`), dann `ipa capture --retry <snapshotId>` oder `ipa skip` |

Jeder Versuch liegt in `analyses/<snapshotId>/attempt-<n>/` mit Eingabe, Prompt, Schema, roher Antwort (`response.json`), stderr und Ergebnis (`outcome.json`). `outcome` ist `success`, `claude_error`, `invalid_response`, `validation_failed`, `input_too_large` oder `interrupted`, dazu die Fehlerklasse. Ein Versuch mit `input_too_large` zählt nicht zum Limit; solange das Paket zu gross bleibt, entsteht kein weiterer Versuchsordner.

### Work-Log

`logs/<snapshotId>.md` beginnt mit dem Hinweis „Automatisch erzeugter KI-Entwurf – vor Verwendung persönlich prüfen.“ (ohne Claude: „Automatisch erzeugter Entwurf ohne KI …“). Der Kopf nennt Snapshot, Vorgänger, Beobachtungszeitraum, Branch, HEAD, Herkunft und die Commits mit geprüfter Nachricht. Danach folgen immer diese Abschnitte:

1. Zusammenfassung
2. Umgesetzt
3. Entscheidungen
4. Probleme
5. Tests
6. Widersprüche
7. Statusänderungen (vom Tool, nicht von Claude)
8. Unbekannt/offen
9. Erfassungshinweise: Anzahl und Gründe von Auslassungen, Lücken
10. Belege: Tabelle mit ID, Art, Pfad und Datei im Arbeitsbereich

Jede Aussage endet mit ihren Beleg-IDs, zum Beispiel `[E003, N20261014T081500Z-0c1d]`. Eine leere Liste erscheint als „nicht erfasst“: Sie bedeutet nicht, dass es nichts gab. Ein Test ohne passenden Bericht erscheint als „Ergebnis unbekannt – kein passender Testbericht“.

### Abbruch und Wiederanlauf

- Bricht ein Lauf nach `complete.json`, aber vor dem Cursor ab, führt der nächste Lauf den Cursor ohne Aufruf von Claude und ohne zweiten Log nach.
- Bricht er vorher ab, zählt der Versuch als `interrupted`. Der nächste Lauf analysiert den Snapshot erneut und überschreibt `analysis.json` und den Log unter denselben Pfaden.
- Scheitert das Speichern, etwa bei voller Platte, bleibt der Snapshot offen und der Cursor unverändert; `outcome.json` nennt den Grund.

## Tagesjournal

`ipa journal` fasst einen Tag als Entwurf für das persönliche Journal zusammen. Der Entwurf stützt jede Aussage auf Belege und ersetzt die persönliche Prüfung nicht. Das Format ist neutral gewählt; ein von Schule oder Betrieb verlangtes Format ist noch offen (O-04).

### Eingabe eines Tages

- **Snapshots:** alle Arbeits-Snapshots, deren Beobachtungszeitraum den Tag berührt. Liegen Beginn und Ende am selben Tag, gehört der Snapshot zu diesem Tag. Überspannt er mehrere Tage, zum Beispiel von 16:00 bis 09:00 am Folgetag, erscheint er an jedem dieser Tage nur unter „Unklare Tageszuordnung“ und nie als ausgeführte Arbeit. Ausgangs-Snapshots zählen nie als Arbeit.
- **Analysen:** Die Aussagen abgeschlossener Analysen gehen als abgeleitete Aussagen ein, mit qualifizierten Beleg-IDs wie `S000004:E003`. Sie sind keine eigenständigen Belege: Claude darf nur die Original-Belege zitieren.
- **Belege und Commits:** nur Beschreibungen der Belege (Art, Pfad, Commit, Snapshot, ob ausgelassen), keine Diffs. Commit-Nachrichten werden erneut geprüft; eine zurückgehaltene Nachricht erscheint nur als Referenz.
- **Notizen:** alle Notizen mit diesem Tätigkeitstag. Notizen vom Typ `plan` sind die Tagesplanung. Eine Notiz mit möglichem Zugangsdatum wird zurückgehalten und als offene Prüfung ausgewiesen, ihr Zeitaufwand zählt trotzdem.
- **Kontext:** die Kontextdateien aus `context.files`, geprüft wie bei der Analyse.
- **Offene Punkte:** offene, blockierte, erschöpfte und übersprungene Analysen, Lücken aus den Manifesten (neuer Ausgangspunkt, Halt, fehlender Vorgängerstand), Läufe des Tages mit Exit-Code ungleich 0 aus `runs.jsonl`, ein aktiver Halt, beschädigte Notizzeilen, zurückgehaltene Inhalte und „keine Aufnahme“, wenn kein Snapshot den Tag berührt.

Frühere Journal-Entwürfe und `journal/final/` liest das Tool nie. Zitierbar sind nur die IDs in `allowedEvidenceIds`: Belege der Snapshots des Tages, die Notizen des Tages und die Kontextdateien.

### Prüfung der Antwort

Claude erhält die Eingabe über stdin wie bei der Analyse, mit dem Prompt `prompts/journal.md` (Version `journal@1`). Das Tool übernimmt nur eine Antwort, die dem Schema `schemas/journal-output.schema.json` entspricht und diese Regeln erfüllt:

| Regel | Inhalt |
| --- | --- |
| R-01 | Jede Referenz steht in `allowedEvidenceIds`. Eine Notiz eines anderen Tages oder ein Beleg eines Snapshots mit unklarer Tageszuordnung ist nicht zitierbar. |
| R-03 | Ein Test „bestanden“ oder „fehlgeschlagen“ zitiert einen aktuellen Testbericht (`fresh: true`) mit Inhalt. |
| R-04 | Eine Begründung zitiert eine Notiz oder eine Commit-Nachricht mit Inhalt. |
| R-06 | Eine ausgeführte Arbeit zitiert einen Beleg eines Snapshots des Tages mit Inhalt oder eine Notiz vom Typ `activity`, `general` oder `problem`. |
| R-07 | Die Antwort enthält keine Zeitfelder. |

Bei einem Fehler bleiben `outcome.json` und `response.json` in `journal/runs/<runId>/`, und es entsteht kein Entwurf.

### Aufbau des Entwurfs

Der Entwurf beginnt mit dem Hinweis „KI-generierter Entwurf – persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen.“ (ohne Claude: „Automatisch erzeugter Entwurf ohne KI – …“). Der Kopf nennt Tag, Erstellzeit, Lauf, Modus, Modelle und Prompt-Version. Danach folgen immer diese Abschnitte:

1. Geplante Arbeiten
2. Ausgeführte Arbeiten
3. Probleme und Lösungen
4. Entscheidungen
5. Tests: jedes Ergebnis mit dem Zusatz „getesteter Codezustand nicht nachgewiesen“; ohne aktuellen Bericht „Ergebnis unbekannt“
6. Abweichungen von der Planung
7. Erkenntnisse
8. Nächste Schritte
9. Zeitaufwand (vom Tool, nicht von Claude)
10. Unklare Tageszuordnung
11. Offene Analysen und Erfassungslücken
12. Unbekannt/offen
13. Quellen: jede zitierte Referenz mit Art, Pfad, Snapshot und SHA-256

Aussagen enden mit ihren Referenzen in eckigen Klammern. Ein leerer Abschnitt erscheint als „nicht erfasst“: Er bedeutet nicht, dass es nichts gab. Ohne Claude (`--no-ai`) zeigen die Abschnitte die Notizen nach Typ und die Aussagen der Work-Logs des Tages, gekennzeichnet als „aus Work-Log übernommen“; Abweichungen und nächste Schritte bleiben dann „nicht erfasst (ohne KI)“.

**Zeitaufwand:** Zeiten stammen nur aus Notizen, nie aus Beobachtungszeiträumen oder Commit-Zeitpunkten. Die Tabelle hat eine Zeile pro Notiz mit Zeit. Summen gibt es getrennt für gemessene und geschätzte Zeiten, eine Gesamtsumme gibt es nicht. Verzögerungen stehen separat und werden nicht zusätzlich summiert. Zeiten von Planungsnotizen sind geplanter Aufwand und zählen nicht zu den Summen. Notizen ohne Zeit erscheinen als „Zeit unbekannt“.

### Tagesabschluss

1. Letzten `ipa capture` ausführen, damit die Arbeit des Tages gesichert und analysiert ist.
2. Mit `ipa status` offene Analysen, zurückgehaltene Inhalte und Lücken prüfen.
3. `ipa journal` ausführen, bei Problemen mit Claude `ipa journal --no-ai`.
4. Den Entwurf lesen und mit dem tatsächlichen Tagesablauf vergleichen. Die Referenzen im Abschnitt „Quellen“ führen zu Notizen, Work-Logs und gespeicherten Belegen.
5. Fehlende persönliche Begründungen und Zeitabweichungen ergänzen, falsche Aussagen korrigieren.
6. Die überarbeitete Endfassung **von Hand** nach `journal/final/`, zum Beispiel `journal/final/2026-10-14.md`, kopieren und dort weiterbearbeiten. Das Tool schreibt nie in diesen Ordner und liest ihn nie.

Ein weiterer Lauf am selben Tag legt einen neuen Entwurf an. Welche Fassung gilt, entscheidet der Benutzer; einen Freigabebefehl oder eine Versionsverwaltung für Journale gibt es in V1 nicht.

**Sicherung:** Das Tool sichert weder Entwürfe noch Endfassungen. `journal/final/` und am besten der ganze Arbeitsbereich gehören in die zugelassene Sicherung des Betriebs (O-07), siehe [Sicherung](#sicherung). Liegt der Arbeitsbereich ausserhalb des Repositorys, erfasst eine Sicherung des Repositorys ihn nicht.

## Zeitsteuerung

Der Scheduler des Betriebssystems kann `ipa capture --scheduled` regelmässig starten, zum Beispiel alle zwei Stunden während der Arbeitszeit. Er startet nur; Zustand, Wiederanlauf und Fehlerbehandlung bleiben im Tool. Ein geplanter Lauf erzeugt keine Arbeitszeit, und das Journal bleibt bewusst ein manueller Schritt (`ipa journal`). `ipa capture` lässt sich weiterhin jederzeit von Hand ausführen, etwa vor einer Pause.

### Zeitfenster

Das Zeitfenster steht unter `schedule` in `config.json`:

```json
"schedule": {
  "workdays": ["mon", "tue", "wed", "thu", "fri"],
  "windowStart": "08:00",
  "windowEnd": "18:00",
  "intervalMinutes": 120,
  "extraRunTimes": ["17:45"]
}
```

- `workdays`: Arbeitstage, `mon` bis `sun`
- `windowStart`, `windowEnd`: Zeitfenster im Format `HH:MM`, Beginn vor Ende. Beide Grenzen gehören dazu. Verglichen wird minutengenau, ein um 18:00 ausgelöster Lauf zählt also noch.
- `intervalMinutes`: Abstand der geplanten Läufe im Fenster
- `extraRunTimes`: zusätzliche Läufe, zum Beispiel 17:45 zum Abschluss des Tages
- Massgebend ist die Zeitzone aus `config.json` (`timezone`), nicht die des Betriebssystems. Sommer- und Winterzeit werden berücksichtigt.
- Die Werte sind Vorschläge und vor Ort anzupassen (offene Entscheidung O-05).

### Einrichtung unter Windows

Mit `ipa schedule install` richtet `ipa` die Aufgabe selbst ein (siehe [Zeitplan-Verwaltung](#ipa-schedule-install--status--pause--resume--remove--run)); `ipa schedule status` zeigt danach den Zustand und `ipa schedule install --update` gleicht sie nach einer Änderung der Konfiguration ab. Der Weg über eine Vorlagendatei bleibt möglich:

1. In einem normalen Terminal `ipa doctor` ausführen: Claude Code muss gefunden und angemeldet sein. Die Aufgabe läuft mit der dauerhaften Umgebung des Benutzers; nur in der Sitzung gesetzte Variablen und PATH-Einträge fehlen dort.
2. Vorlage erzeugen, mit einer Ausgabedatei ausserhalb des Repositorys:

   ```text
   ipa schedule --os windows --output C:\Users\<name>\ipa-<projekt>.xml
   ```

3. Die Vorlage lesen und bei Bedarf anpassen. Ihr Kommentarblock nennt den Import-Befehl.
4. Importieren. Das ändert die Aufgabenplanung und ist ein bewusster Schritt des Benutzers:

   ```text
   schtasks /Create /XML "C:\Users\<name>\ipa-<projekt>.xml" /TN ipa-assistant-<repositoryId>
   ```

5. Einmal von Hand auslösen, mit `schtasks /Run /TN ipa-assistant-<repositoryId>` oder in der Aufgabenplanung. Danach steht der Lauf in `runs.jsonl`, und `ipa status` zeigt ihn unter „Letzter Lauf“. Ausserhalb des Zeitfensters lautet das Ergebnis `outside_window`.
6. Entfernen mit `schtasks /Delete /TN ipa-assistant-<repositoryId> /F`.

Eigenschaften der Vorlage:

| Einstellung | Wert |
| --- | --- |
| Trigger | pro Arbeitstag ein wöchentlicher Trigger ab `windowStart`, alle `intervalMinutes` wiederholt bis `windowEnd`; pro Eintrag in `extraRunTimes` ein wöchentlicher Trigger an allen Arbeitstagen |
| Aktion | `node.exe` mit `dist/cli.js capture --scheduled --repo …`, beide mit absolutem Pfad |
| Mehrere Instanzen | `IgnoreNew`: Solange die Aufgabe läuft, startet keine zweite. Zusätzlich verhindert der Lock überschneidende Läufe (Exit-Code 3). |
| Verpasste Läufe | `StartWhenAvailable`: Ein verpasster Lauf, etwa bei ausgeschaltetem Rechner, wird nachgeholt. Die Lücke bleibt im Beobachtungszeitraum des nächsten Snapshots sichtbar. |
| Laufzeit | `ExecutionTimeLimit` = `limits.maxRunSeconds` + 10 Minuten. Ein Claude-Aufruf, der kurz vor der Laufzeitgrenze beginnt, kann bis `claude.timeoutSeconds` dauern; ist dieser Wert grösser als 10 Minuten, warnt `ipa schedule`. Bricht die Aufgabenplanung einen Lauf ab, bleibt der Snapshot offen, und der nächste Lauf holt ihn nach. |
| Akkubetrieb | Start und Weiterlaufen auch im Akkubetrieb |
| Benutzer | nur bei angemeldetem Benutzer (`InteractiveToken`), ohne höchste Rechte und ohne gespeichertes Passwort |

Hinweise:

- Die Trigger verwenden die Systemzeit des Rechners. Weicht dessen Zeitzone von `config.json` ab, starten die Läufe zu anderen Uhrzeiten; `--scheduled` beendet Läufe ausserhalb des Fensters ohne Aufnahme.
- Beim Start kann kurz ein Konsolenfenster erscheinen (O-05). Eine Ausführung unabhängig von der Anmeldung verlangt ein gespeichertes Passwort und gehört nicht zur Vorlage.
- Stand der Prüfung: Die Vorlage besteht die Prüfung der Windows-Aufgabenplanung ohne Registrierung (`TASK_VALIDATE_ONLY`, Windows 11, 30.09.2026). Import, Auslösung und Überschneidungsschutz sind noch nicht manuell geprüft, siehe [Abnahmeprotokoll](docs/abnahme/v1-abnahmeprotokoll.md) (AK-08-07). Dasselbe gilt für die Befehle der Zeitplan-Verwaltung: Sie sind mit einem Ersatz für `schtasks` automatisch getestet, an der echten Aufgabenplanung aber noch nicht geprüft (Paketcheckliste 09, AK-09-17). Offen ist auch, ob die Aufgabenplanung einen Lauf genau am Fensterende (`windowEnd`) auslöst; `--scheduled` liesse ihn zu, die Obergrenze der Claude-Aufrufe zählt ihn mit.

### cron (nicht geprüft)

`ipa schedule --os cron` gibt crontab-Zeilen mit `CRON_TZ=<zeitzone>` und absoluten Pfaden aus, eine Zeile je Minute der Startzeiten. Linux und macOS sind in V1 nicht geprüft. `CRON_TZ` kennt nicht jede cron-Variante, und cron hat einen knappen PATH, sodass Git und Claude Code dort gefunden werden müssen. Für `launchd` und `systemd` gibt es keine Vorlage. Die Verwaltung mit `ipa schedule install` und den übrigen Unterbefehlen gibt es nur für die Windows-Aufgabenplanung, und `ipa` richtet nie von selbst eine Aufgabe ein.

## Zuordnung von Änderungen

`capture` vergleicht jede Aufnahme mit dem letzten gespeicherten Snapshot, damit dieselbe Arbeit nicht doppelt erfasst wird.

**Zustandsdelta:** Für jede Datei zählt ihr *wirksamer Stand*, also der Inhalt im Working Tree, unabhängig davon, ob er gestagt oder committet ist. Hat er sich seit dem letzten Snapshot verändert, entsteht ein Beleg `state_delta` mit einem Patch vom vorigen zum aktuellen Stand (`fromBlob` → `toBlob`). Er ist der inhaltliche Hauptbeleg für die Analyse. Auch eine Rücknahme auf den committeten Stand ergibt ein Delta; eine gelöschte und identisch wieder angelegte Datei ergibt keines. Mehrere Commits zwischen zwei Aufnahmen zeigt das Delta als Nettoeffekt. Der Patch durchläuft dieselbe Secret-Prüfung wie alle Patches, einschliesslich entfernter Zeilen.

**Statusänderungen:** Wird ein bereits erfasster Stand nur gestagt oder unverändert committet, entsteht kein neues Delta. Das Manifest führt dann in `statusChanges` einen Eintrag, zum Beispiel `unstaged` → `committed`, mit Verweis auf das frühere Delta (`previousEvidence`).

**Commit-Dateien** erhalten in `attribution`:

| Wert | Bedeutung |
| --- | --- |
| `documented` | Der committete Stand wurde schon früher als Delta erfasst (`previousEvidence`). |
| `baseline` | Der committete Stand stammt aus dem Ausgangs-Snapshot. |
| `new` | Ein Delta dieses Snapshots deckt die Datei ab (`coveredBy`). |
| `unclear` | Keine der obigen Zuordnungen ist möglich, etwa bei einem Zwischenstand, der vor der nächsten Aufnahme zurückgenommen wurde. |

**Kein Snapshot ohne neue Arbeit:** Ein Arbeits-Snapshot wird nur gespeichert, wenn sich HEAD geändert hat, ein Delta entstanden ist oder ein Testbericht neu ist oder sich geändert hat. Reines Stagen genügt nicht. Die eigenen Dateien eines Arbeitsbereichs im Repository wie `.ipa/` zählen nie. `analysisRequired` im Manifest ist `true`, wenn es ein Delta, einen neuen Testbericht oder eine Commit-Datei mit `new` oder `unclear` gibt; ein Snapshot nur mit Statusänderungen braucht keine KI-Analyse und erhält einen Work-Log ohne KI.

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
| `--ref <S000000:E000>` | Verweis auf einen Beleg eines gespeicherten Snapshots, mehrfach möglich. Gibt es den Snapshot oder den Beleg nicht, endet der Befehl mit Exit-Code 2, und es wird nichts gespeichert. Die Belege eines Snapshots stehen in seinem Manifest und in der Tabelle „Belege“ seines Work-Logs. |

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

**Vertrauliche Inhalte:** Notizen werden lokal so gespeichert, wie sie eingegeben wurden. Zugangsdaten gehören nicht in eine Notiz. Findet die Secret-Prüfung in Text, Grund, Alternativen, Ursache oder Lösung ein mögliches Zugangsdatum, speichert `note` die Notiz trotzdem und warnt auf stderr mit dem Namen des Detektors, nie mit dem Wert. Solche Notizen gehen nie an Claude: Die Prüfung wiederholt sich bei jedem Eingabepaket, und `ipa status` zählt sie unter `withheld.notes` als offene Prüfung. Nach einer Korrektur der Notizdatei entfällt die Zurückhaltung.

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

Jede Einheit wird vor der Speicherung auf mögliche Zugangsdaten geprüft: Dateikopien, Diffs und Zustandsdeltas einschliesslich entfernter Zeilen und Kontextzeilen, Commit-Nachrichten und Testberichte. Vor jeder Übermittlung an Claude prüft das Tool die Belege erneut, dazu Notizen und Kontextdateien (siehe [Eingabepaket](#eingabepaket)). Bei einem Treffer wird die **ganze Einheit zurückgehalten**, geschwärzt wird nichts. Das Manifest nennt in `filterDecisions` Pfad, Detektor und Zeilennummer, nie den Wert.

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
- **Erfassungslücken:** Erfasst wird, was bei einer Aufnahme im Working Tree, im Index oder in neuen Commits steht. Zwischenstände, die zwischen zwei Aufnahmen entstehen und wieder verschwinden, fehlen. Arbeit vor `ipa init` erscheint nur als Ausgangslage, Arbeit zwischen einem Halt und `ipa baseline` nur als Lücke. Ausgeschlossene und zurückgehaltene Inhalte fehlen im KI-Paket; sie stehen ohne Werte im Manifest und als offene Prüfung in `ipa status`. Ein leerer Abschnitt in Work-Log oder Journal heisst „nicht erfasst“, nicht „gab es nicht“.
- **Zeiten:** Arbeitszeiten stammen nur aus Notizen. Beobachtungszeiträume, Commit-Zeitpunkte und geplante Läufe sind keine Arbeitszeit.
- **Secret-Erkennung:** Sie beruht auf regulären Ausdrücken und ist nie vollständig, siehe [Secret-Prüfung](#secret-prüfung).
- **Schutzwirkung:** Die Optionen des Claude-Aufrufs sind keine Sandbox und kein garantierter Schreibschutz, siehe [Claude Code](#claude-code-aufruf-schutzwirkung-und-grenzen).
- **Zeitsteuerung:** Die Windows-Vorlage ist validiert, Import und Ausführung sind noch nicht manuell geprüft, ebenso die Zeitplan-Verwaltung an der echten Aufgabenplanung. Nächster und letzter Lauf stammen aus der lokalisierten Ausgabe von `schtasks`; ein nicht erkanntes Datumsformat ergibt „unbekannt“. cron ist nicht geprüft, für `launchd` und `systemd` gibt es keine Vorlage.
- **`--json` und `config`:** `ipa config set` hat keinen Lock; es schützt vor dem Überschreiben einer Änderung, die vor der Prüfung kam, nicht vor einer, die genau zwischen dem erneuten Lesen und dem Umbenennen entsteht.
- **Plattformen:** Geprüft ist nur Windows 11 mit Node.js 24. Linux und macOS sind nicht geprüft; einzelne automatische Tests liefen während der Entwicklung auch unter Linux, das ist keine Freigabe dieser Plattform.

## Claude Code: Aufruf, Schutzwirkung und Grenzen

Claude Code analysiert neue Snapshots (siehe [Analyse und Work-Logs](#analyse-und-work-logs)) und schreibt Journal-Entwürfe (siehe [Tagesjournal](#tagesjournal)). Der Aufruf lässt sich mit `ipa doctor` prüfen. Jeder Aufruf:

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
- startet nicht, wenn ein API-Schlüssel oder ein externer Anbieter erkannt und nicht freigegeben ist, siehe [Kostenschutz](#kostenschutz).

Vor dem ersten Aufruf eines Laufs prüft `ipa`, ob `doctor.json` alle Pflichtoptionen meldet. Sonst führt es `ipa doctor` ohne `--live` einmal aus. Danach fragt es `claude auth status` frisch ab, ohne Modellaufruf. Der Lauf endet vor dem ersten Modellaufruf mit Exit-Code 6, wenn Pflichtoptionen fehlen, Claude Code nicht angemeldet ist, `claude auth status` nicht innerhalb von 20 s oder ohne auswertbares JSON antwortet (`claude_not_ready`) oder der Kostenschutz greift (`paid_usage_blocked`). Ein nicht angemeldetes Claude verbraucht so keinen Analyseversuch.

**Abgelaufene Anmeldung:** `claude auth status` kann „angemeldet“ melden, obwohl die API die Anmeldung ablehnt. Eine Analyse endet dann erst nach den Wiederholungen von Claude Code (einige Minuten) mit `error_result` und HTTP 401; der Snapshot bleibt offen. Abhilfe: `claude auth login` ausführen oder `claude` einmal interaktiv starten, danach `ipa capture` erneut ausführen.

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

### Kostenschutz

`ipa` ruft Claude standardmässig nur über das Claude-Abo auf: angemeldet mit `claude auth login` oder mit `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token`. Wege, die pro Anfrage abgerechnet werden, sind gesperrt, bis sie in `config.json` ausdrücklich freigegeben sind:

| Erkannt an | Abrechnung |
| --- | --- |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_PROFILE` oder `ANTHROPIC_FEDERATION_RULE_ID` gesetzt | Anthropic-API, Console-Profil oder Gateway, pro Anfrage |
| `CLAUDE_CODE_USE_BEDROCK`, `…_VERTEX`, `…_FOUNDRY`, `…_ANTHROPIC_AWS` oder `…_MANTLE` gesetzt | Amazon Bedrock, Google Vertex AI, Microsoft Foundry oder ein anderer Cloud-Anbieter |
| in den Claude-Einstellungen: `apiKeyHelper`, eine der Variablen oben im Block `env`, `forceLoginMethod` `console` oder `gateway`, `forceLoginGatewayUrl` | wie oben |
| `claude auth status` meldet eine andere Anmeldeart als `claude.ai` oder `oauth_token` (etwa `third_party`, `api_key`, `api_key_helper`) oder eine `apiKeySource` (etwa `/login managed key` nach einem Console-Login) | API-Schlüssel, Console-Login oder Anbieter |

Geprüfte Claude-Einstellungen (Orte wie in Claude Code 2.1.114): die Benutzereinstellungen `settings.json` und der Cache der Server-Einstellungen `remote-settings.json` in `CLAUDE_CONFIG_DIR` oder `%USERPROFILE%\.claude`, die verwalteten Einstellungen `C:\Program Files\ClaudeCode\managed-settings.json` mit `managed-settings.d\*.json` sowie unter Windows der Wert `Settings` in `HKLM\SOFTWARE\Policies\ClaudeCode` und `HKCU\SOFTWARE\Policies\ClaudeCode`. Projekteinstellungen spielen keine Rolle, weil `claude` in einem leeren Ordner läuft.

- Eine Variable gilt als gesetzt, sobald sie einen nicht leeren Wert hat, auch `0` oder `false`. Gross- und Kleinschreibung des Namens spielen keine Rolle.
- Vor jedem Modellaufruf prüft `ipa` die Umgebung, die `claude` erhalten würde, und die Claude-Einstellungen, ohne `claude` zu starten. Vor dem ersten Modellaufruf eines Laufs (Analyse, Journal) fragt es zusätzlich `claude auth status` frisch ab, ohne Modellaufruf; ein älteres Ergebnis in `doctor.json` zählt dafür nicht. `ipa doctor` prüft alles bei jedem Aufruf. Greift der Schutz, startet kein Modellaufruf, und in `ai-usage.jsonl` entsteht keine Zeile. `capture` und `journal` enden mit Exit-Code 6 und dem Fehlercode `paid_usage_blocked`; gesicherte Daten bleiben offen, `ipa journal --no-ai` bleibt möglich. `ipa doctor` meldet den Befund, überspringt `--live` und endet mit Exit-Code 7.
- Meldungen nennen nur Namen von Variablen und Einstellungen, nie ihre Werte. Werte werden weder ausgegeben noch gespeichert.
- Abhilfe: die Variable oder Einstellung entfernen (in PowerShell für die laufende Sitzung `Remove-Item Env:ANTHROPIC_API_KEY`, dauerhaft in den Umgebungsvariablen von Windows), nach einem Console-Login `claude auth logout` und `claude auth login --claudeai`, und das Abo verwenden.
- Freigabe, nur wenn die Kosten bewusst getragen werden: `allowPaidUsage` unter `claude` in `config.json` auf `true` setzen. Standard ist `false`; eine ältere `config.json` ohne das Feld gilt ebenfalls als `false`.

  ```json
  "claude": {
    "command": ["claude"],
    "model": null,
    "timeoutSeconds": 600,
    "maxTurns": 5,
    "maxAttemptsPerSnapshot": 3,
    "maxAnalysesPerRun": 5,
    "allowPaidUsage": true
  }
  ```

Grenzen des Schutzes (keine Garantie):

- **Kontoseitige Einstellungen sind lokal nicht prüfbar.** Ob im Claude- oder Anthropic-Konto zusätzliche kostenpflichtige Nutzung (etwa Usage Credits über das Abo-Kontingent hinaus) aktiviert ist, sieht `ipa` nicht. Das ist im Konto selbst zu prüfen.
- Geprüft wird, was lokal sichtbar ist. Nicht gelesen werden macOS-Profile (`com.anthropic.claudecode`), Einstellungen, die eine einbettende Anwendung übergibt, und Server-Einstellungen, die noch nicht im Cache liegen. Diese deckt nur `claude auth status` ab, und dort ist `ANTHROPIC_AUTH_TOKEN` von einem Abo-Token nicht zu unterscheiden (beides `oauth_token`).
- Ein aktives Anthropic-Profil ohne `ANTHROPIC_PROFILE` (Datei `active_config` unter `%APPDATA%\Anthropic`) liest `ipa` nicht.
- Die Werte von `authMethod` und `apiKeySource` stammen aus Claude Code 2.1.114. Eine unbekannte Anmeldeart sperrt vorsichtshalber; neue Quellen, die eine spätere Version als `claude.ai` meldet, erkennt `ipa` nicht.
- `ipa` prüft die Benutzereinstellungen auch dann, wenn `--setting-sources project,local` sie für den Aufruf ausklammert. Das kann vorsichtshalber sperren.
- Zwischen der Prüfung und dem Modellaufruf vergehen Sekunden bis Minuten; eine Änderung genau dazwischen bleibt unbemerkt.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run build` | TypeScript nach `dist/` übersetzen |
| `npm run typecheck` | Typprüfung von Quellcode, Tests und Skripten |
| `npm test` | alle automatischen Tests (Vitest) |
| `npm run app:install` | Abhängigkeiten der Desktop-App installieren (`npm ci --prefix app`, lädt Electron) |
| `npm run app:dev` | CLI bauen und die App im Entwicklungsbetrieb starten |
| `npm run app:typecheck`, `npm run app:test` | Typprüfung und Tests der App, Einzelheiten in [`app/README.md`](app/README.md) |
| `npm run app:build` | CLI und App bauen (Ausgabe in `app/out/`) |
| `npm run test:live` | Live-Tests mit dem installierten Claude Code: `ipa doctor --live` (zwei kleine Modellaufrufe), eine Analyse (ein Aufruf), ein Journal (ein Aufruf) und die Abnahme von V1 (`test/live/acceptance.live.ts`, etwa zehn Aufrufe, siehe [Abnahmeprotokoll](docs/abnahme/v1-abnahmeprotokoll.md)). Einzeln etwa mit `npm run test:live -- test/live/acceptance.live.ts`. Läuft nur mit `IPA_LIVE_CLAUDE=1` und ist nicht Teil von `npm test`. |

Zu den Tests:

- `npm test` baut zuerst `dist/`, weil Integrationstests den echten CLI-Einstieg starten.
- Jeder Test arbeitet mit temporären Git-Repositories und einer eigenen temporären Datenwurzel. Das globale Setup setzt `IPA_ASSISTANT_HOME`, `LOCALAPPDATA` und `XDG_DATA_HOME` auf ein Temp-Verzeichnis, blendet die Git-Konfiguration des Rechners aus und prüft am Ende, dass die echte Datenwurzel unverändert ist.
- Die Tests prüfen die Unversehrtheit der Test-Repositories über einen Fingerprint.
- Automatische Tests rufen Claude nie echt auf. Sie verwenden die Fake-CLI `test/helpers/fake-claude.mjs` über `claude.command`; im Modus `analysis` leitet sie eine gültige Analyse aus dem Eingabepaket ab, im Modus `journal` einen gültigen Journal-Entwurf aus der Journal-Eingabe. Das globale Setup nimmt `claude` zusätzlich aus dem PATH der Testprozesse und legt ihr Temp-Verzeichnis in den Test-Ordner. API-Schlüssel des Rechners erhält die Fake-CLI nicht, und `CLAUDE_CONFIG_DIR` zeigt auf einen leeren Test-Ordner; die Tests des Kostenschutzes setzen künstliche Werte. Verwaltete Claude-Einstellungen des Rechners (`C:\Program Files\ClaudeCode`, Registry) wirken auch in den Tests.
- Die Befehle der Zeitplan-Verwaltung sprechen `schtasks` über einen austauschbaren Runner an (`main(argv, io, deps)`). Die Tests ersetzen ihn durch eine Nachbildung der Aufgabenplanung (`test/helpers/scheduler.ts`); kein automatischer Test fasst die echte Aufgabenplanung an, auch nicht lesend. Der echte Runner wird nur mit einem Ersatzprogramm geprüft.
- Die Journal-Tests und die Tests der Zeitsteuerung setzen eine feste Uhr ein, damit Snapshots, Notizen und Läufe auf bestimmten Tagen und Uhrzeiten liegen. Die Fensterprüfung wird zusätzlich mit umgestellter Prozesszeitzone (`TZ=UTC`, `TZ=America/New_York`) geprüft.
- `test/acceptance/` führt alle Abnahmefälle aus Konzept §17 mit der Fake-CLI an einem künstlichen Repository durch; `test/live/acceptance.live.ts` führt dasselbe Szenario mit dem installierten Claude Code aus und legt Bericht und Arbeitsbereich in `IPA_ACCEPTANCE_OUT` oder im Temp-Verzeichnis ab.
- Die Live-Tests verbrauchen Claude-Kontingent und laufen nur auf ausdrücklichen Wunsch, in PowerShell mit `$env:IPA_LIVE_CLAUDE = '1'; npm run test:live`.

Aufbau:

```text
src/cli.ts          Einstieg (bin: ipa)
src/cli/            Commander-Definition, Befehle, Ausgabe, Fehlerbehandlung
src/core/           Datenwurzel, Registry, Arbeitsbereich, Konfiguration, Schemas, Schreibfunktionen, Lock, IDs, Zeit, Laufprotokoll
src/git/            Git-Aufrufe nur über die Leseliste, Parser für -z-Ausgaben, Blob-IDs ohne Schreibzugriff
src/filter/         Pfadfilter und Secret-Prüfung
src/collector/      Aufnahme, Konsistenzprüfung, Manifest, atomare Ablage, Wiederanlauf
src/notes/          Notizen: Regeln der Eingabe, Ablage und Lesen (hängt nur von src/core/ ab)
src/claude/         Claude-Aufruf ohne Werkzeuge und ohne Shell, Kostenschutz, Auswertung, ipa doctor, KI-Nutzungsprotokoll
src/analysis/       Status, Eingabepaket, Prüfung der Antwort, Work-Log, Warteschlange, Cursor, ipa skip
src/journal/        Tageseingabe, Tageszuordnung, Zeitübersicht, Prüfung der Antwort, Markdown-Entwurf, ipa journal
src/schedule/       Fensterprüfung für capture --scheduled, Läufeplan, Vorlagen für die Windows-Aufgabenplanung und cron, Zugriff auf schtasks mit austauschbarem Runner
src/config/         Befunde und Änderungen von config.json (ipa config)
app/                Desktop-App (Electron, eigenes Paket, siehe app/README.md)
prompts/            Prompts der Analyse (analyze-work.md) und des Journals (journal.md)
schemas/            JSON Schemas (draft-07)
test/               Tests und Test-Helfer, test/acceptance/ für das Abnahmeszenario, test/live/ für die Live-Tests
docs/abnahme/       Abnahmeprotokoll von V1
```
