# IPA Assistant: Desktop-App

Die Desktop-App ist die grafische Oberfläche für das Kommandozeilenwerkzeug `ipa` aus dem Wurzelordner dieses Repositorys. Sie zeigt an, was `ipa` gesammelt hat, und startet `ipa` im Hintergrund. Fachlogik der Erfassung, Analyse oder Zeitplanung enthält sie nicht. Technik: Electron, TypeScript, React, nur für Windows 11.

Falls du das Projekt zum ersten Mal siehst: Lies zuerst das [README im Wurzelordner](../README.md). Es erklärt, was der IPA Assistant ist, und wie du `ipa` installierst. Diese Datei beschreibt nur die App.

**Stand: Paket 12 von 14 (App Aktionen).** Die App ist noch nicht fertig, aber du kannst mit ihr lesen, was `ipa` gesammelt hat, und die täglichen Aktionen auslösen:

- **Übersicht** eines Projekts: letzter Lauf, Analyse-Stand, offene und zurückgehaltene Inhalte, Zeitplan-Kurzstatus, die letzten Tage, ein roter Banner bei einem Halt (mit **Neuen Ausgangspunkt setzen**) und eine Warnung, wenn Claude nicht bereit ist (mit **Prüfen**).
- **Tag** mit Kalender, Zusammenfassung, Hinweisen und vier Tabs: Zeitstrahl, **Work-Logs** (mit Etiketten `KI-Entwurf`, `ohne KI`, `vom Tool`), **Notizen** und **Journal-Entwürfe**. Verweise wie `[S000002:E003]` oder Notiz-IDs sind klickbar.
- **Neue Notiz** (`Strg+N`, speichern mit `Strg+Enter`): sechs Arten, Tag, Zeit als Dauer oder Von–bis, Verzögerung, Belege. Die Bestätigung zeigt Art, Tag und Zeit, nie den Text.
- **Jetzt erfassen** (mit dem Funken-Symbol: ruft Claude auf) und **Nur aufnehmen** (ohne Claude). Die Laufanzeige am unteren Rand zeigt Laufzeit, die Live-Ausgabe aus den Dateien des Laufs und das Ergebnis in Klartext. Ein Lauf lässt sich mit Rückfrage abbrechen.
- **Journal erzeugen** und **Ohne KI erzeugen** für den angezeigten Tag, danach **Als Endfassung übernehmen** und **Löschen** (Papierkorb) für Entwürfe und Endfassungen, **Erneut versuchen** (nur bei erschöpften Analysen) und **Überspringen** mit Pflichtgrund.
- Änderungen aus dem Terminal erscheinen ohne Neustart (gemessen: gut eine Sekunde). Läuft gerade ein Lauf (auch ein geplanter oder einer aus dem Terminal), sind die Schaltflächen, die Claude aufrufen oder schreiben, gesperrt und sagen im Tooltip warum.

Noch leere Rahmen sind Zeitplan, Konfiguration, System und Projekt hinzufügen; sie kommen mit den Paketen 13 und 14. Die App ruft Claude **nur auf, wenn du eine Schaltfläche mit dem Funken-Symbol drückst**, und ändert das Repository nie. Einen Installer kannst du bauen (unsigniert, siehe [Als Programm installieren](#als-programm-installieren-mit-desktop-link)); er ist noch nicht auf einem sauberen Windows abgenommen.

## Inhalt

- [Einrichten und starten](#einrichten-und-starten)
- [Als Programm installieren (mit Desktop-Link)](#als-programm-installieren-mit-desktop-link)
- [Tests ausführen](#tests-ausführen)
- [Fehlerbehebung](#fehlerbehebung)
- [Alle Befehle](#alle-befehle)
- [Aufbau des Codes](#aufbau-des-codes)
- [Technische Hintergründe](#technische-hintergründe): Grundsätze, [Laufzeit des CLI](#laufzeit-des-cli), [Sicherheit](#sicherheit), [Versionen](#versionen-und-begründung), [Grenzen](#grenzen-dieses-stands)

## Einrichten und starten

**Voraussetzungen:** Windows 11, Node.js 24 oder neuer (`node --version`), Git, Internet beim ersten Start. Das `ipa`-Werkzeug musst du für die App nicht global installieren, die App baut und nutzt das CLI aus diesem Ordner selbst.

Alle Befehle gibst du im **Wurzelordner** des Repositorys ein (dort, wo `README.md` und `package.json` des Werkzeugs liegen), nicht in `app/`:

```powershell
npm ci                 # einmalig: Abhängigkeiten des Werkzeugs
npm run app:install    # einmalig: Abhängigkeiten der App
npm run app:dev        # baut das CLI und startet die App
```

Beim allerersten Start lädt Electron einmalig seine Programmdatei herunter (Meldung „Downloading Electron binary…“, rund 100 MB). Das dauert einen Moment. Danach öffnet sich das Fenster.

**Achtung, Namensfalle:** `npm run app:install` installiert nur die Abhängigkeiten, die zum Entwickeln nötig sind. Es erzeugt **keine** `.exe` und keinen Desktop-Link. Wer die App wie ein normales Programm benutzen will, baut den Installer, siehe [Als Programm installieren](#als-programm-installieren-mit-desktop-link).

**Was du siehst:** Links die Liste deiner Projekte. Sie stammt aus der Projektliste, die `ipa init` führt, ist also leer, bis du mindestens ein Repository eingerichtet hast. Ein Projekt legst du vorerst im Terminal an:

```powershell
cd C:\GIT\mein-projekt
node C:\GIT\ipa-tool\dist\cli.js init     # oder einfach: ipa init, wenn ipa global installiert ist
```

Danach erscheint es in der App (die Liste aktualisiert sich selbst, sonst starte die App neu). Ein Punkt neben dem Namen zeigt den Zustand: grau in Ordnung, gelb Warnung (zum Beispiel offene Analysen), rot Halt oder Fehler; zusätzlich steht der Zustand immer als Text dabei.

Die App und das Terminal benutzen dieselben Daten. Du kannst also im Terminal mit `ipa capture --no-analysis` oder `ipa note` arbeiten, und die App folgt. Sie ändert nie selbst etwas an einem Repository oder Arbeitsbereich und ruft Claude nie von selbst auf.

## Als Programm installieren (mit Desktop-Link)

Damit du die App ohne Terminal öffnen kannst, baust du einen Windows-Installer. Im Wurzelordner:

```powershell
npm run app:dist
```

Das baut CLI und App, lädt beim ersten Mal die passende `node.exe` und die Installer-Werkzeuge herunter und erzeugt:

```text
app\release\IPA Assistant Setup 0.1.0.exe     (rund 140 MB)
```

Das dauert beim ersten Mal einige Minuten. Daneben liegt unter `app\release\win-unpacked\IPA Assistant.exe` das Programm ohne Installation: Es startet per Doppelklick, braucht aber den ganzen Ordner `win-unpacked` und einen Neubau ersetzt ihn. Den Desktop-Link legt nur der Installer an. Der Installer geht so:

1. Doppelklick auf `IPA Assistant Setup 0.1.0.exe`. Die Installation läuft **ohne Administratorrechte** und ohne Rückfragen.
2. Der Installer legt die App nach `%LOCALAPPDATA%\Programs\IPA Assistant` und erstellt eine **Verknüpfung auf dem Desktop** und einen Eintrag im **Startmenü** („IPA Assistant“).
3. Starte die App über den Desktop-Link. Eine installierte App bringt ihr eigenes Node und das CLI mit, du brauchst dafür weder `npm` noch ein Terminal.

Gut zu wissen:

- **Windows warnt eventuell (SmartScreen: „Der Computer wurde durch Windows geschützt“).** Der Installer ist nicht digital signiert. Klicke auf „Weitere Informationen“, dann „Trotzdem ausführen“. Das ist bei einem selbst gebauten, unsignierten Programm normal.
- **Es gibt kein automatisches Update.** Für eine neue Version baust du den Installer neu und führst ihn aus; er ersetzt die alte Version am selben Ort.
- **Deine Daten bleiben beim Deinstallieren erhalten.** Der Uninstaller entfernt nur die Programmdateien (Windows-Einstellungen › Apps). Arbeitsbereiche und Journale unter `%LOCALAPPDATA%\ipa-assistant` bleiben.
- **Das Icon ist noch das Standard-Icon von Electron.** Name und Icon sind noch nicht entschieden.
- **Windows-Aufgaben:** Richtest du aus der installierten App eine Aufgabe ein, zeigt sie auf die installierte Programmversion. Wird die App deinstalliert, läuft die Aufgabe ins Leere.
- **Stand:** Der Installer ist gebaut und die gepackte App startet mit der mitgelieferten Laufzeit (geprüft). Die Installation per Doppelklick und die Deinstallation sind noch nicht auf einem sauberen Windows getestet.

## Tests ausführen

Im Wurzelordner:

```powershell
npm run app:typecheck   # Typprüfung
npm run app:test        # Unit- und Komponententests (dauert etwa eine Minute; die Aktionstests starten das echte CLI)
npm run app:build       # baut CLI und App nach app/out/
```

Für die Tests der echten App (öffnen kurz Fenster; sie bedienen Notiz-Dialog, Erfassen, Abbrechen und Halt gegen das echte CLI), nach `app:build`:

```powershell
npm run test:e2e --prefix app
```

Die Tests brauchen kein Claude und fassen weder deine echten Daten noch die Windows-Aufgabenplanung an: Sie arbeiten in temporären Ordnern mit einem gespielten Claude (`test/helpers/fake-claude.mjs`).

## Fehlerbehebung

| Problem | Lösung |
| --- | --- |
| `npm run app:dev` meldet, `app/node_modules` fehle, oder Module wie `electron-vite` fehlen | `npm run app:install` ausführen (einmalig, im Wurzelordner). |
| Meldung „Die mitgelieferte CLI-Laufzeit fehlt oder ist beschädigt“ in der App | `node --version` prüfen (24 oder neuer, im PATH) und die App mit `npm run app:dev` starten, das baut das CLI zuerst. |
| Meldung zur CLI-Version („Die Version des CLI passt nicht zur App“) | Das gebaute CLI ist veraltet: `npm run build` im Wurzelordner, dann die App neu starten. |
| „Downloading Electron binary…“ bricht ab oder hängt | Internetverbindung prüfen (Firmennetz, Proxy) und `npm run app:dev` erneut starten. |
| Die Projektliste ist leer („Noch kein Projekt“) | Es gibt noch kein eingerichtetes Projekt, oder `IPA_ASSISTANT_HOME` zeigt auf eine andere Datenwurzel als im Terminal. Mit `ipa init` einrichten. |
| Ein Projekt hat einen roten Punkt und „nicht lesbar“ | Das Repository oder sein Arbeitsbereich liegt nicht mehr am registrierten Ort (verschoben oder gelöscht). |
| Die App startet ein zweites Mal nicht | Es darf nur eine Instanz laufen; das vorhandene Fenster kommt nach vorn. |
| Ein Test des Start-Tests hängt | Prüfe, dass keine alte App-Instanz läuft (Task-Manager, `electron.exe`), und führe vorher `npm run app:build` aus. |

## Alle Befehle

Im Wurzelordner des Repositorys (leitet nur an `app/` weiter):

| Befehl | Wirkung |
| --- | --- |
| `npm run app:install` | `npm ci --prefix app`: installiert die App samt Electron (rund 100 MB) |
| `npm run app:dev` | baut das CLI und startet die App im Entwicklungsbetrieb |
| `npm run app:typecheck` | Typprüfung aller vier Ziele (Main/Preload, Renderer, Renderer-Tests, Start-Tests) |
| `npm run app:test` | Vitest: Main-Prozess, Reader und Komponenten |
| `npm run app:build` | baut das CLI und danach den Code der App nach `app/out/`. **Erzeugt keine `.exe`**: Die entsteht erst mit `app:dist`. |
| `npm run app:dist` | wie `app:build`, dann `stage-cli`, `fetch-node` und `electron-builder`: erzeugt den Installer `app\release\IPA Assistant Setup 0.1.0.exe`, siehe [Als Programm installieren](#als-programm-installieren-mit-desktop-link) |

Im Ordner `app/`:

| Befehl | Wirkung |
| --- | --- |
| `npm run test:e2e` | Playwright startet die gebaute App (zuerst `npm run build`) |
| `npm run stage-cli` | stellt das CLI wie bei `npm install --global .` bereit (`app/stage/cli/`) |
| `npm run fetch-node` | lädt die gepinnte `node.exe`, prüft die SHA-256-Prüfsumme und legt sie nach `app/stage/node/` |

Die Tests starten das echte CLI aus dem Wurzel-`dist/`. Fehlt es, baut das globale Setup es. Ein Test ruft Claude nie echt auf: Sie verwenden die Fake-CLI `test/helpers/fake-claude.mjs` des Wurzelordners, in temporären Datenwurzeln (`IPA_ASSISTANT_HOME`) und mit temporärem Ordner für den Anzeigezustand. Die echte Aufgabenplanung (`schtasks`) fasst kein Test an.

## Aufbau des Codes

```text
src/shared/     Typen der IPC-Schnittstelle, Meldungstexte, Tagesrechnung (kein Node, kein DOM)
src/main/       Main-Prozess: Fenster und Sicherheit, Protokoll app://, IPC, Dienste
  cli/          Laufzeit (resolveRuntime), Befehle, Runner, Hüllenprüfung gegen die Schemas des CLI
  run/          Sperren pro Projekt, zentrale Warteschlange, Abbruch des Prozessbaums, Live-Zeilen, Zusammenfassung eines Laufs
  reader/       Registry, Projektstatus und der Reader der Arbeitsbereiche (Tag, Snapshots, Notizen, Journale)
  watch/        Dateibeobachtung (fs.watch mit Entprellung und Abfrage alle 10 s)
src/preload/    window.ipa: die einzige Schnittstelle des Renderers
src/renderer/   React: Tokens (Hell/Dunkel), Basiskomponenten, Layout, Store, Zustandsgalerie
  markdown/     Darstellung von Work-Logs und Journalen: sicher, mit Etiketten und Referenz-Chips
  pages/        Übersicht und Tag (Zeitstrahl, Work-Logs, Notizen, Journal)
  dialogs/      Notiz-Dialog (Formularlogik in noteForm.ts), Ausgangspunkt, Überspringen, Erneut versuchen, Prüfen
test/           unit, reader, components (jsdom), e2e (Playwright), helpers
scripts/        write-cli-version, stage-cli, fetch-node, after-pack (Fuses)
```

Der Renderer importiert nichts aus `src/main/`, der Main-Prozess nichts aus dem Renderer. Eine Komponente liest keine Dateien und startet keine Befehle, sie ruft `window.ipa` auf.

Wer mehr wissen will: Die verbindliche Spezifikation ist [`docs/app/spec.md`](../docs/app/spec.md), die Aufgabenpakete stehen unter [`docs/implementation/packages/`](../docs/implementation/packages/).

## Technische Hintergründe

Dieser Teil ist für alle gedacht, die an der App weiterarbeiten oder wissen wollen, warum sie so gebaut ist.

### Grundsätze

- **Das CLI bleibt der Motor.** Jede Aktion der App ruft genau einen Befehl von `ipa` mit `--json` auf. Die App schreibt nie selbst in einen Arbeitsbereich oder ein Repository. Sie schreibt nur `app-state.json` (Fenster und letzte Auswahl) und ihr Protokoll in `%APPDATA%\IPA Assistant`.
- **Nichts startet Claude von selbst.** Automatisch läuft nur, was kein Modell aufruft: `status`, `schedule status`, `config check` und `config set --dry-run`. Alle Aufrufe gehen durch eine Stelle ([`src/main/run/queue.ts`](src/main/run/queue.ts)), die einen automatischen Aufruf ausserhalb dieser Liste ablehnt und jeden Aufruf protokolliert.
- **Das CLI bleibt ohne die App baubar.** `app/` hat ein eigenes `package.json` und `package-lock.json`, keine Workspaces. `npm ci` und `npm install --global .` im Wurzelordner laden weder Electron noch Abhängigkeiten der App, und `app/` gehört nicht zum Paket des CLI.

### Laufzeit des CLI

Die App startet das CLI immer mit einer eigenen Node-Laufzeit, nie mit Electron als Node (`ELECTRON_RUN_AS_NODE`). Der Grund: `ipa schedule install` trägt `process.execPath` des laufenden CLI in die Windows-Aufgabe ein. Wäre das die App-Exe, würde die Aufgabe ohne die Variable die Oberfläche statt `capture --scheduled` starten (Spezifikation §3.3).

| Betrieb | Node | CLI |
| --- | --- | --- |
| Entwicklung (`app:dev`) | `node` aus dem PATH (Version 24 oder neuer geprüft) | `dist/` des Wurzelordners |
| Test | `process.execPath` des Tests | `dist/` des Wurzelordners |
| Installiert (Paket 14) | `resources/node/node.exe` | `resources/cli/` |

Fehlt etwas oder ist Node älter als 24, meldet die App `runtime_missing` mit klarer Meldung und bleibt bedienbar. Beim Start gleicht sie `ipa --version` mit der erwarteten Version ab (`out/cli-version.json`, im Entwicklungsbetrieb die Version aus dem Wurzel-`package.json`); eine Abweichung ergibt `cli_version_mismatch`. **Im Entwicklungsbetrieb zeigt eine mit `ipa schedule install` eingerichtete Aufgabe auf den Entwicklungsordner und auf `node` aus dem PATH.**

Der CLI-Aufruf läuft immer ohne Shell mit Argument-Array, `--repo` stets gesetzt, `--json` bei Aktionsbefehlen und einem Arbeitsverzeichnis ausserhalb jedes Repositorys. Die Hülle der Antwort wird gegen `schemas/cli-<befehl>.schema.json` geprüft; Fehler der App um das CLI (`cli_output_invalid`, `commander_error`, `spawn_failed`, ...) sind getrennt von den Exit-Codes des CLI.

Läufe: Pro Projekt läuft höchstens ein Schreib-Lauf und ein Journal-Lauf; `note` und `config` bleiben parallel möglich, verschiedene Projekte laufen parallel. Einen fremden Lauf (geplante Aufgabe, Konsole) erkennt die App an der Datei `lock`, sofern der Prozess auf diesem Rechner lebt. Ein Abbruch beendet den ganzen Prozessbaum (`taskkill /T /F`), weil das CLI keine Signale behandelt und Claude als Kindprozess läuft; der nächste Lauf übernimmt Unfertiges.

### Sicherheit

- Das Hauptfenster hat `contextIsolation`, `sandbox` und `webSecurity`, kein `nodeIntegration`. Der Renderer läuft ohne Node und kennt nur `window.ipa`.
- Der Renderer kommt aus dem eigenen Protokoll `app://` mit Content-Security-Policy (`default-src 'none'`, `connect-src 'none'`, keine Inline-Skripte). Navigation und neue Fenster werden verweigert, Berechtigungsanfragen abgelehnt, es gibt nur eine Instanz.
- Der Main-Prozess prüft bei jeder IPC-Nachricht Absender (nur Hauptframe des Hauptfensters) und Eingabe. Kein Kanal liefert Pfade zum Öffnen, Umgebungsvariablen oder rohe Befehle.
- Fuses (`RunAsNode`, `EnableNodeCliInspectArguments`, `EnableNodeOptionsEnvironmentVariable` aus, `OnlyLoadAppFromAsar` ein) setzt der Build-Schritt `after-pack`. In einem Entwicklungsstart (`electron .`) gelten sie nicht.
- Die Testhaken `IPA_APP_USER_DATA`, `IPA_APP_NODE` und `IPA_APP_CLI_ROOT` wirken nur im nicht installierten Betrieb (`app.isPackaged` ist falsch).
- Das Protokoll der App (`%APPDATA%\IPA Assistant\logs\app.log`, höchstens 1 MiB, einmal rotiert) enthält Zeitpunkt, Ereignisart, Befehlsname, Auslöser, Lauf-ID, Exit-Code und Fehlercode, nie Argumentwerte, Ausgaben oder Dateiinhalte.
- Die Live-Zeilen eines Laufs entstehen aus Dateinamen und Zählern, nie aus Dateiinhalten, Notizen oder Gründen.

### Versionen und Begründung

Stand 26.11.2026, geprüft mit `npm view` und einem vollständigen Lauf der Tests.

| Bestandteil | Version | Begründung |
| --- | --- | --- |
| Electron | **45.5.0** (exakt, kein `^`) | Neueste stabile Hauptversion zum Start von Paket 10 (Spezifikation AD-13, mindestens 44); bringt Node 24.22.3 und Chromium 156 mit. Wartung: neueste drei Hauptversionen werden unterstützt, ein Wechsel ist bewusst und braucht einen Lauf der Tests und des Start-Tests. |
| TypeScript | 7.0.2 | Wie das CLI. Geprüft (AO-04): `electron-vite`, `vitest`, `@vitejs/plugin-react` und Playwright laufen damit, `tsc -p` prüft alle vier Ziele ohne Fehler. Keine eigene ältere Version nötig. |
| electron-vite / Vite | 6.0.0 / 8.3.8 | Eine Konfiguration für Main, Preload und Renderer. Der Preload wird als CommonJS (`index.cjs`) gebaut, weil ein Preload in der Sandbox kein ES-Modul sein kann. |
| React / React DOM | 19.3.1 | Zustandsreiche Komponenten (Dialoge, Tabs, Formulare); keine UI-Bibliothek, kein Router, kein Zustands-Framework (eigener kleiner Store mit `useSyncExternalStore`). |
| ajv | ^8.20.0 | Prüft Dateien und Hüllen gegen die Schemas des CLI mit denselben Optionen wie das CLI. Einzige Laufzeitabhängigkeit im Main-Prozess. |
| Vitest, jsdom, Testing Library | 5.1.2, 31.0.1, 16.3.3 | Tests von Main-Prozess, Reader und Komponenten; Vitest wie im CLI. |
| Playwright (`_electron`) | 1.65.1 | Start-Test der gebauten App. Braucht keine Browser-Downloads. |
| @electron/fuses | 2.1.3 | Setzt die Fuses beim Paketieren. |
| react-markdown / remark-gfm | 10.1.0 / 4.0.1 | Stellt Work-Logs und Journale dar (Spezifikation AD-10). Rendert in React-Elemente, nie in HTML; Roh-HTML wird übersprungen (`skipHtml`), `rehype-raw` ist nicht eingebaut. `remark-gfm` für Tabellen. |
| electron-builder | 26.18.0 | NSIS-Installer (Paket 14). Die Schlüssel in `electron-builder.yml` sind gegen `node_modules/app-builder-lib/scheme.json` dieser Version geprüft (AO-07); ein Lauf von `app:dist` steht noch aus. |
| Node-Laufzeit des Installers | 24.22.3 | In `node-runtime.json` mit SHA-256 festgelegt (AO-03: einziger Ort zur Pflege). `fetch-node` bricht bei Abweichung der Prüfsumme ab. |

Neue Abhängigkeiten ausser den hier genannten brauchen eine Begründung in dieser Datei.

### Grenzen dieses Stands

- Windows 11 ist die einzige vorgesehene Plattform; Windows 10 ist nicht geprüft.
- Die Sichtprüfung gegen die Artboards des Designs (Hell und Dunkel) und die Bedienung mit Screenreader sind manuell und noch nicht erfolgt (AK-10-80).
- Ein echter Lauf mit Claude aus der App (Jetzt erfassen, Journal erzeugen) ist noch nicht von Hand geprüft, weil er Kontingent verbraucht. Die automatischen Tests nutzen ein gespieltes Claude. Probiere es einmal mit einem kleinen Projekt aus.
- Notiztexte sind auf 8 000 Zeichen begrenzt (Windows verträgt als Befehlszeilenargument rund 32 000).
- Die Lauf-ID eines laufenden Befehls erscheint erst nach dem Ende.
- Die App zeigt keine Diffs und bearbeitet keine Texte: Journal-Entwürfe lassen sich öffnen und kopieren. **Als Endfassung übernehmen** kopiert einen Entwurf auf Klick nach `journal/final/<Tag>.md` (ersetzt nie eine Datei), die Überarbeitung machst du in deinem Editor. **Löschen** (Entwurf oder Endfassung) verschiebt nach Rückfrage in den Windows-Papierkorb; endgültig löscht die App nie. Das ist die einzige Stelle, an der die App selbst Dateien im Arbeitsbereich anlegt; das CLI schreibt nie nach `journal/final/`.
- Zurückgehaltene Notizen (möglicher Zugangswert) erscheinen mit Detektor, aber ohne den betroffenen Text.
- Der Installer ist unsigniert (Windows-SmartScreen-Warnung), hat das Standard-Icon von Electron und wurde noch nicht auf einem sauberen Windows installiert. Die Abnahme (AK-10-80) und der Test der CLI-Testsuite mit der mitgelieferten `node.exe` (AK-10-76) gehören zu Paket 14.
- Ein Playwright-Test gegen die gepackte App ist nicht möglich: Die Fuses schalten das Debugging ab, das Playwright zum Verbinden braucht. Geprüft wird die gepackte App deshalb von Hand.
- Die Zustandsgalerie ist nur in Entwicklung und Tests erreichbar (`#/gallery`), nicht im gebauten Paket.
