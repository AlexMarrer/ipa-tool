# Paket 01 – CLI-Grundlage

Verbindliche Grundlage ist `docs/implementation/spec.md`. Dieses Dokument wiederholt keine gemeinsamen Verträge, sondern verweist mit `spec.md §…` darauf.

## 1. Ziel und konkretes Ergebnis

Nach diesem Paket gibt es ein baubares, testbares und global installierbares TypeScript-Projekt.

- `ipa init` legt für ein beliebiges Git-Repository einen eigenen Arbeitsbereich an. Standardmässig liegt er ausserhalb des Projekts, auf Wunsch in einem ausdrücklich gewählten Ordner wie `.ipa/`.
- `ipa status` zeigt den Arbeitsbereich an.
- Die gemeinsamen Grundbausteine für alle folgenden Pakete stehen bereit und sind getestet: Kontext, Konfiguration, Schemas, atomares Schreiben, Lock, IDs, Zeit, Git-Leseaufrufe und Laufprotokoll.
- Eine praktische Claude-Vorabprüfung mit künstlichen Daten (D-24) zeigt früh, ob Anmeldung, Optionen, Werkzeugbeschränkung und strukturierte Ausgabe mit der installierten Version funktionieren.

## 2. Umfang und Abgrenzung

Im Umfang:

- Projektgerüst: `package.json`, `tsconfig.json`, Vitest-Konfiguration mit globalem Setup, `.gitignore` und `src/cli.ts` als Einstieg (`dist/cli.js` als `bin` `ipa`)
- `src/core/` mit diesen Bausteinen:
  - Datenwurzel (spec.md §5.2) und Arbeitsbereich mit Standardort und ausdrücklich gewähltem Ort (§5.3, D-21)
  - Repository-Auflösung (§5.4), Registry (§9.2), Struktur des Arbeitsbereichs (§8.1)
  - Konfiguration mit Standardwerten (§7), Zustand (§9.1), Schemaregister mit Ajv (§8.4)
  - Schreibfunktionen und Lock (§8.5), IDs (§8.2), Zeitfunktionen (§8.3)
  - Fehlertyp `IpaError` und Exit-Codes (§6.4), Laufprotokoll `runs.jsonl` (§9.11)
- `src/git/`: `GitRunner` mit Leseliste, Umgebung, Pflichtoptionen und Pathspec-Ausschluss für einen Arbeitsbereich im Repository (§14.2). Fachliche Parser gehören nicht dazu.
- Schemas `config`, `state`, `registry` und `run-record`
- Befehle:
  - `ipa init [--timezone <iana>] [--workspace <pfad>]` ohne Ausgangs-Snapshot
  - `ipa status [--json]` mit den Feldern von Paket 01 (§6.6)
- Test-Helfer:
  - `test/helpers/git-repo.ts`
  - `test/helpers/repo-fingerprint.ts`, auch mit Ausnahme für einen Arbeitsbereich im Repository
  - `test/helpers/workspace.ts` für temporäre Datenwurzeln und CLI-Aufrufe
- Claude-Vorabprüfung `scripts/claude-probe.mjs`:
  - einfaches Node-ESM-Skript, ohne Build und ohne Abhängigkeiten ausführbar
  - Skript `npm run probe:claude`
  - wird in Paket 05 durch `ipa doctor --live` ersetzt
- `README.md` im Repository-Root: Installation, Speicherort und dessen Wahl, `init`, `status`, Vorabprüfung

Nicht im Umfang:

- Snapshots, Filter und Secret-Prüfung (Paket 02)
- Halt und `baseline` (Paket 03)
- Notizen (Paket 04)
- `ClaudeRunner` und `ipa doctor` im Produktcode (Paket 05)
- Analyse (Paket 06), Journal (Paket 07) und Zeitsteuerung (Paket 08)

Befehle späterer Pakete werden nicht als Platzhalter registriert.

## 3. Voraussetzungen und abhängige Pakete

- Keine vorausgehenden Pakete.
- Node.js ≥ 24 und Git sind installiert (spec.md §2.2).
- Für den Live-Teil der Vorabprüfung braucht es eine installierte, angemeldete Claude-Code-CLI und die ausdrückliche Freigabe des Benutzers.
- Alle anderen Pakete bauen auf diesem Paket auf.

## 4. Zu implementierendes Verhalten

**`ipa init [--timezone <iana>] [--workspace <pfad>]`**

1. Repository auflösen (spec.md §5.4). Kein Git-Repository oder ein Bare-Repository: Exit-Code 2.
2. Datenwurzel bestimmen (§5.2).
   - Liegen Datenwurzel und Repository ineinander: Exit-Code 2.
   - Die Datenwurzel lässt sich nicht anlegen oder beschreiben: Exit-Code 2. Die Meldung nennt den geprüften Pfad sowie die Auswege `--data-dir`, `IPA_ASSISTANT_HOME` und `--workspace`. Die Registry liegt immer in der Datenwurzel, daher braucht auch `--workspace` eine beschreibbare Datenwurzel.
   - Es gibt keinen stillen Wechsel des Speicherorts.
3. Ist das Repository bereits in der Registry eingetragen und existiert sein Arbeitsbereich: Exit-Code 2 („bereits initialisiert“), keine Datei wird geändert. Paket 02 verfeinert diesen Fall: Fehlt der Ausgangs-Snapshot, wird er nachgeholt.
4. Arbeitsbereich bestimmen (§5.3).
   - Ohne `--workspace`: Standardort.
   - Mit `--workspace`: Pfad auflösen, relative Pfade relativ zur Repository-Wurzel, und die Regeln aus §5.3 prüfen.
   - Liegt der Ordner im Repository und ist er laut `git check-ignore -q` nicht ignoriert, erscheint der Hinweis auf `.gitignore` oder `.git/info/exclude`. Das Tool ändert diese Dateien nicht.
   - Ist der Ordner nicht beschreibbar: Exit-Code 2 mit Pfad und Hinweis.
5. `repositoryId` erzeugen (§8.2) und den Arbeitsbereich anlegen:
   - alle Unterordner aus §8.1 ohne `lock`
   - `config.json` mit Standardwerten (§7.1)
   - `state.json` mit Anfangswerten: `nextSnapshotSeq: 1`, alle IDs `null`, `halt: null`
6. Den Registry-Eintrag atomar ergänzen, mit `workspacePath` und `workspaceMode`.
7. Den Lock während der Schritte 5 und 6 halten und einen Eintrag in `runs.jsonl` schreiben.
8. Ausgabe: `repositoryId`, Arbeitsbereichspfad, Speichermodus und Zeitzone.

**`ipa status [--json]`**

- Nur lesend, ohne Lock und ohne Laufprotokoll.
- Liefert die Felder von Paket 01 aus §6.6, mit `--json` als JSON-Objekt, sonst als lesbare Liste.
- Nicht initialisiert: Exit-Code 2.

**CLI-Rahmen**

- Globale Optionen `--repo` und `--data-dir` (§6.1). `--version` liest die Version aus `package.json`.
- Zentrale Fehlerbehandlung:
  - `IpaError` → zugehöriger Exit-Code
  - alle anderen Fehler → Exit-Code 1 mit kurzer Meldung auf stderr, ohne Stacktrace
  - `IPA_DEBUG=1` → Stacktrace wird ausgegeben
- Ungültige Argumente: Exit-Code 2.

**Grundbausteine**

- Alle Funktionen aus spec.md §10 im Abschnitt „core“ sowie `createGitRunner` mit den dort genannten Signaturen.
- `resolveContext` liest den Arbeitsbereichspfad aus der Registry, lädt und validiert `config.json` und prüft die Zeitzone.
- `Clock` ist injizierbar. Das CLI verwendet die Systemuhr.

**Claude-Vorabprüfung** `scripts/claude-probe.mjs`

Das Skript arbeitet nur mit künstlichen Daten. Es liest und schreibt nichts im Repository und nichts im Arbeitsbereich. Es nutzt `node:child_process` ohne Shell und gibt am Ende eine JSON-Zusammenfassung auf stdout aus. Diese Zusammenfassung enthält keine E-Mail, keine Organisation und kein Token.

Ohne `--live` findet kein Modellaufruf statt:

- `claude --version`
- `claude auth status`, davon nur `loggedIn` und `authMethod`
- Flag-Prüfung aller Optionen aus spec.md §13.1 sowie `--safe-mode` und `--setting-sources` über den Unknown-Option-Pfad (§13.2)

Mit `--live` folgen höchstens drei kleine Modellaufrufe. Vorher erscheint ein Hinweis auf den Kontingentverbrauch. Jeder Aufruf läuft in einem neuen leeren Ordner unter `os.tmpdir()`, erhält die Pflichtoptionen aus §13.1 und bekommt eine künstliche Eingabe über stdin. Die Eingabe enthält eine eingebettete Aufforderung, Dateien zu löschen und Befehle auszuführen.

1. `--output-format stream-json --verbose` mit einem trivialen Schema. Ausgewertet werden `tools` und `mcp_servers` im Ereignis `system/init` (A-01, A-04, A-05) sowie `permission_denials` im Ergebnis.
2. `--output-format json` mit demselben Schema. Geprüft werden: genau ein JSON-Objekt auf stdout (A-03), `subtype`, `is_error` und `structured_output` gegen das Schema (A-02).
3. Wie Aufruf 2, zusätzlich mit `--setting-sources project,local`. Geprüft wird, ob die Anmeldung und `structured_output` funktionieren (A-08).

Das Ergebnis lautet pro Annahme `bestätigt`, `widerlegt` oder `unklar`. Die temporären Ordner werden danach gelöscht.

**Dokumentation des Ergebnisses**

- Die Umsetzungssitzung trägt die Ergebnisse in spec.md §18 ein, mit Datum, Claude-Version und Status von A-01 bis A-05 und A-08.
- Ist A-01 oder A-02 widerlegt, wird der Benutzer informiert. O-02 (Claude-Update) ist dann vor Paket 05 zu entscheiden.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/cli/`, `src/core/`, `src/git/runner.ts`, `scripts/claude-probe.mjs`
  - `schemas/config.schema.json`, `state.schema.json`, `registry.schema.json`, `run-record.schema.json`
- Schnittstellen:
  - spec.md §10 (core, git)
  - §5.2 bis §5.4, §6.4, §6.6, §7, §8, §9.1, §9.2, §9.11, §13.1, §13.2, §14.2
- Test-Helfer gemäss spec.md §16.2

## 6. Fehler- und Randfälle

**Pfade**

- Pfade mit Leerzeichen und Umlauten für Repository, Datenwurzel und Arbeitsbereich
- Unter Windows wird `--repo` mit anderer Gross- und Kleinschreibung oder mit `\` auf denselben Registry-Eintrag abgebildet.
- `--repo` zeigt auf ein Unterverzeichnis: Die Repository-Wurzel wird verwendet.

**Datenwurzel und Arbeitsbereich**

- Die Datenwurzel existiert noch nicht: Sie wird angelegt.
- Die Datenwurzel ist nicht beschreibbar, zum Beispiel weil der Pfad auf eine vorhandene Datei zeigt: Exit-Code 2 mit Auswegen. Es wird nichts an einem anderen Ort angelegt.
- `--workspace .ipa` im Repository: Wird angelegt. Ist der Ordner nicht ignoriert, erscheint ein Hinweis.
- `--workspace` zeigt auf `.git/`, auf die Repository-Wurzel oder auf einen nicht leeren Ordner: Exit-Code 2.
- `registry.json` ist beschädigt oder hat eine höhere `schemaVersion`: Exit-Code 2, keine Änderung (D-18).
- Der Registry-Eintrag verweist auf einen gelöschten Arbeitsbereich: Exit-Code 2 mit Hinweis. Eine automatische Neuanlage an anderem Ort findet nicht statt.
- `config.json` wurde von Hand ungültig gemacht: Exit-Code 2 mit JSON-Pfad des Fehlers.
- Ungültige Zeitzone: Exit-Code 2.

**Lock**

- Ein laufender Prozess hält den Lock: Exit-Code 3.
- Der Lock stammt von einem beendeten Prozess auf demselben Rechner: Er wird entfernt, und `lockBroken: true` wird protokolliert.
- Das Umbenennen beim atomaren Schreiben scheitert vorübergehend mit `EPERM` oder `EBUSY`: bis zu 5 Wiederholungen.

**Repository**

- Repository ohne Commits (unborn HEAD): `init` funktioniert.

**Vorabprüfung**

- `claude` wird nicht gefunden: Die Zusammenfassung meldet das, Exit-Code ≠ 0.
- Nicht angemeldet: Die Live-Aufrufe werden übersprungen, die betroffenen Annahmen sind `unklar`.
- Zusätzlicher Text vor dem JSON auf stdout: A-03 gilt als `widerlegt`, die Rohausgabe erscheint gekürzt ohne Inhalte der Eingabe.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-01-01 | `npm ci`, `npm run build` und `npm run typecheck` laufen fehlerfrei. `dist/cli.js` existiert. Die tsconfig enthält die Optionen aus spec.md §4.1. |
| AK-01-02 | `ipa --help` listet nur `init` und `status`. `ipa --version` gibt die Paketversion aus. Ein unbekannter Befehl endet mit Exit-Code 2. |
| AK-01-03 | `ipa init` im Standardmodus legt in einem Test-Repository den Arbeitsbereich gemäss spec.md §8.1 in der Datenwurzel an. `config.json`, `state.json`, `registry.json` und die Zeile in `runs.jsonl` sind schemagültig. Der Repository-Fingerprint ist vorher und nachher gleich (I-01). |
| AK-01-04 | `ipa init` ausserhalb eines Git-Repositorys endet mit Exit-Code 2 und legt keinen Arbeitsbereich an. |
| AK-01-05 | Ein zweites `ipa init` endet mit Exit-Code 2. `config.json`, `state.json` und `registry.json` bleiben byte-gleich. |
| AK-01-06 | Liegen Datenwurzel und Repository ineinander, endet `init` mit Exit-Code 2. |
| AK-01-07 | Zwei Repositories erhalten getrennte Arbeitsbereiche. `ipa --repo <a> status` und `ipa --repo <b> status` zeigen jeweils den richtigen, auch bei abweichender Schreibweise des Pfads unter Windows. |
| AK-01-08 | Ein zweiter gleichzeitiger `withLock`-Aufruf löst `LockHeldError` bzw. Exit-Code 3 aus. Ein veralteter Lock eines beendeten Prozesses wird entfernt und protokolliert. |
| AK-01-09 | Schlägt das Schreiben vor dem Umbenennen fehl, bleibt der alte Dateiinhalt unverändert. `createFileExclusive` scheitert bei einer vorhandenen Datei. `readJsonl` meldet ungültige und unvollständige Zeilen, ohne die gültigen zu verlieren. |
| AK-01-10 | `GitRunner` lehnt nicht gelistete Befehle, `hash-object -w` und `config` ohne `--get` ab, ohne einen Prozess zu starten. Er setzt `GIT_OPTIONAL_LOCKS=0`, entfernt `GIT_DIR` und `GIT_INDEX_FILE` aus der Umgebung und hängt bei einem Arbeitsbereich im Repository die Ausschluss-Pathspec an (§14.2). |
| AK-01-11 | `formatZoned` und `dayOf` liefern für `Europe/Zurich` korrekte Offsets im Sommer (+02:00) und im Winter (+01:00), an beiden Umstellungstagen 2026 und beim Tageswechsel um Mitternacht. |
| AK-01-12 | Eine ungültige `config.json` führt bei `status` zu Exit-Code 2 mit Angabe des Feldes. Eine Datei mit `schemaVersion: 2` führt zu Exit-Code 2. |
| AK-01-13 | `ipa status --json` liefert genau die Felder von Paket 01 aus spec.md §6.6. `status` schreibt keine Datei. |
| AK-01-14 | Das globale Vitest-Setup verhindert Schreibzugriffe auf die echte Datenwurzel. Ein Test weist nach, dass `IPA_ASSISTANT_HOME` auf ein Temp-Verzeichnis zeigt. |
| AK-01-15 | `ipa init --workspace .ipa` legt den Arbeitsbereich in `<repo>/.ipa/` an. Die Registry enthält `workspaceMode: explicit`, und `status` zeigt den Pfad. Ohne Eintrag in `.gitignore` erscheint ein Hinweis. Ausserhalb von `.ipa/` bleibt der Repository-Fingerprint unverändert, und `.gitignore` wird nicht verändert. `--workspace` auf `.git/`, auf die Repository-Wurzel oder auf einen nicht leeren Ordner ergibt Exit-Code 2. |
| AK-01-16 | Eine nicht beschreibbare Datenwurzel, simuliert durch einen Pfad, der auf eine vorhandene Datei zeigt, ergibt Exit-Code 2. Die Meldung nennt den Pfad, `--data-dir`, `IPA_ASSISTANT_HOME` und `--workspace`. An keinem anderen Ort wird etwas angelegt. |
| AK-01-17 | `node scripts/claude-probe.mjs` ohne `--live` meldet Version, Anmeldestatus und Optionsunterstützung als JSON, ohne Modellaufruf. Die Ausgabe enthält keine E-Mail, keine Organisation und kein Token. Im Repository entstehen keine Dateien. Ein automatischer Test prüft die Argumentbildung und die Auswertung mit einer Fake-Ausgabe, ohne echten Claude-Aufruf. |
| AK-01-18 | **Manuell, live, nach Freigabe:** `node scripts/claude-probe.mjs --live` wurde mit der installierten Claude-Version ausgeführt. Das Ergebnis für A-01 bis A-05 und A-08 steht mit Datum und Version in spec.md §18. Bei widerlegtem A-01 oder A-02 ist der Benutzer informiert. |

## 8. Notwendige Tests und Validierung

- Unit-Tests: IDs nach den Mustern aus §8.2, Zeitfunktionen, Schemaregister mit gültigen und ungültigen Beispielen je Schema, Pfadnormalisierung, Reihenfolge der Datenwurzel-Bestimmung, Arbeitsbereichsregeln, Abbildung auf Exit-Codes, Auswertung der Vorabprüfung mit festen Beispielausgaben
- Integrationstests mit `test/helpers/git-repo.ts`:
  - `init` und `status` über den echten CLI-Einstieg
  - mehrere Repositories
  - `--workspace .ipa`
  - nicht beschreibbare Datenwurzel
  - Datenwurzel innerhalb des Repositorys
  - Repository ohne Commits
- Lock-Tests mit echtem zweitem Prozess und mit simuliertem veraltetem Lock
- Manuelle Prüfungen:
  - `npm install --global .` und anschliessend `ipa --repo <testrepo> init` in einer Windows-Konsole
  - Live-Vorabprüfung (AK-01-18)
  - Die Ergebnisse werden in der Checkliste vermerkt.

## 9. Offene Annahmen

- Der Befehlsname `ipa` kann auf einem Rechner mit einem anderen Programm kollidieren. Tritt das auf, wird der Konflikt in spec.md §18 dokumentiert. Eine Umbenennung entscheidet der Benutzer.
- Die Vorabprüfung prüft A-08 nur auf Anmeldung und Funktion. Ob Benutzer-Hooks tatsächlich ausgeklammert sind, lässt sich ohne Änderung der Benutzereinstellungen nicht nachweisen (spec.md §13.4).
