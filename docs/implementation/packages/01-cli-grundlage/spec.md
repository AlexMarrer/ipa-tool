# Paket 01 – CLI-Grundlage

Verbindliche Grundlage: `docs/implementation/spec.md`. Dieses Dokument wiederholt keine gemeinsamen Verträge und verweist mit `spec.md §…` auf sie.

## 1. Ziel und konkretes Ergebnis

Nach diesem Paket existiert ein baubares und testbares TypeScript-Projekt. Es lässt sich global installieren. Mit `ipa init` lässt sich für ein beliebiges Git-Repository ein Arbeitsbereich ausserhalb des Repositorys anlegen, mit `ipa status` lässt er sich anzeigen. Die gemeinsamen Grundbausteine für alle folgenden Pakete stehen bereit und sind getestet: Kontext, Konfiguration, Schemas, atomares Schreiben, Lock, IDs, Zeit, Git-Leseaufrufe und Laufprotokoll.

## 2. Umfang und Abgrenzung

Im Umfang:

- Projektgerüst: `package.json`, `tsconfig.json`, Vitest-Konfiguration mit globalem Setup, `.gitignore`, `src/cli.ts` als Einstieg (`dist/cli.js` als `bin` `ipa`)
- `src/core/`: Datenwurzel (spec.md §5.2), Repository-Auflösung (§5.4), Registry (§9.2), Arbeitsbereichsstruktur (§8.1), Konfiguration mit Standardwerten (§7), Zustand (§9.1), Schemaregister mit Ajv (§8.4), Schreibfunktionen und Lock (§8.5), IDs (§8.2), Zeitfunktionen (§8.3), Fehlertyp `IpaError` und Exit-Codes (§6.4), Laufprotokoll `runs.jsonl` (§9.11)
- `src/git/`: `GitRunner` mit Leseliste, Umgebung und Pflichtoptionen (§14.2), ohne fachliche Parser
- Schemas: `config`, `state`, `registry`, `run-record`
- Befehle `ipa init` ohne Ausgangs-Snapshot und `ipa status` mit den Feldern von Paket 01 (§6.6)
- Test-Helfer `test/helpers/git-repo.ts`, `test/helpers/repo-fingerprint.ts` und `test/helpers/workspace.ts` für temporäre Datenwurzeln und CLI-Aufrufe
- `README.md` im Repository-Root mit Installation, Datenwurzel, `init` und `status`

Nicht im Umfang:

- Snapshots, Filter und Secret-Prüfung (Paket 02)
- Halt und `baseline` (Paket 03)
- Notizen (Paket 04)
- Claude und `doctor` (Paket 05)
- Analyse (Paket 06), Journal (Paket 07) und Zeitsteuerung (Paket 08)

Befehle späterer Pakete werden nicht als Platzhalter registriert.

## 3. Voraussetzungen und abhängige Pakete

- Keine vorausgehenden Pakete.
- Node.js ≥ 24 und Git sind installiert (spec.md §2.2).
- Alle anderen Pakete bauen auf diesem Paket auf.

## 4. Zu implementierendes Verhalten

**`ipa init [--timezone <iana>]`**

1. Datenwurzel bestimmen (spec.md §5.2) und Repository auflösen (§5.4). Liegt kein Git-Repository oder ein Bare-Repository vor, endet der Befehl mit Exit-Code 2.
2. Liegen Datenwurzel und Repository ineinander, endet der Befehl mit Exit-Code 2 (I-14).
3. Ist das Repository bereits in der Registry eingetragen und existiert der Arbeitsbereich, endet der Befehl mit Exit-Code 2 („bereits initialisiert“) und ändert keine Datei. Paket 02 verfeinert diesen Fall: Fehlt der Ausgangs-Snapshot, wird er nachgeholt (spec.md §6.3).
4. `repositoryId` erzeugen (§8.2). Arbeitsbereich, alle Unterordner aus §8.1 (ohne `lock`), `config.json` mit Standardwerten (§7.1) und `state.json` mit Anfangswerten anlegen: `nextSnapshotSeq: 1`, alle IDs `null`, `halt: null`.
5. Den Registry-Eintrag atomar ergänzen.
6. Den Lock während der Schritte 4 bis 5 halten und einen Eintrag in `runs.jsonl` schreiben.
7. Ausgabe: `repositoryId`, Arbeitsbereichspfad, Zeitzone.

**`ipa status [--json]`**

- Nur lesend, ohne Lock und ohne Laufprotokoll.
- Gibt die Felder von Paket 01 aus §6.6 aus, mit `--json` als JSON-Objekt, sonst als lesbare Liste.
- Nicht initialisiert: Exit-Code 2.

**CLI-Rahmen**

- Globale Optionen `--repo` und `--data-dir` (§6.1). `--version` liest die Version aus `package.json`.
- Zentrale Fehlerbehandlung: `IpaError` wird auf den zugehörigen Exit-Code abgebildet, andere Fehler auf Exit-Code 1 mit kurzer Meldung auf stderr ohne Stacktrace. Mit `IPA_DEBUG=1` wird der Stacktrace ausgegeben.
- Ungültige Argumente führen zu Exit-Code 2.

**Grundbausteine**

- Alle Funktionen aus spec.md §10, Abschnitt „core“, und `createGitRunner` sind mit den dort genannten Signaturen umgesetzt.
- `resolveContext` lädt und validiert `config.json` und prüft die Zeitzone.
- `Clock` ist injizierbar. Das CLI verwendet die Systemuhr.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu: `src/cli/`, `src/core/`, `src/git/runner.ts`, `schemas/config.schema.json`, `schemas/state.schema.json`, `schemas/registry.schema.json`, `schemas/run-record.schema.json`
- Schnittstellen: spec.md §10 (core, git), §6.4, §6.6, §7, §8, §9.1, §9.2, §9.11, §14.2
- Test-Helfer gemäss spec.md §16.2

## 6. Fehler- und Randfälle

- Pfade mit Leerzeichen und Umlauten, sowohl für das Repository als auch für die Datenwurzel
- Unter Windows `--repo` mit anderer Gross- und Kleinschreibung oder mit `\`: wird auf denselben Registry-Eintrag abgebildet
- `--repo` zeigt auf ein Unterverzeichnis des Repositorys: Die Wurzel wird verwendet.
- Die Datenwurzel existiert noch nicht: Sie wird angelegt. Ist sie nicht beschreibbar: Exit-Code 2.
- `registry.json` ist beschädigt oder hat eine höhere `schemaVersion`: Exit-Code 2, keine Änderung (D-18).
- `config.json` wurde von Hand ungültig gemacht: Exit-Code 2 mit JSON-Pfad des Fehlers.
- Ungültige Zeitzone: Exit-Code 2.
- Der Lock ist von einem noch laufenden Prozess belegt: Exit-Code 3.
- Der Lock stammt von einem beendeten Prozess auf demselben Rechner: Er wird entfernt, und `lockBroken: true` wird protokolliert.
- Das Umbenennen beim atomaren Schreiben scheitert vorübergehend mit `EPERM` oder `EBUSY`: bis zu 5 Wiederholungen.
- Repository ohne Commits (unborn HEAD): `init` funktioniert.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-01-01 | `npm ci`, `npm run build` und `npm run typecheck` laufen fehlerfrei. `dist/cli.js` existiert. Die tsconfig enthält die Optionen aus spec.md §4.1. |
| AK-01-02 | `ipa --help` listet nur `init` und `status`. `ipa --version` gibt die Paketversion aus. Ein unbekannter Befehl endet mit Exit-Code 2. |
| AK-01-03 | `ipa init` in einem Test-Repository legt den Arbeitsbereich gemäss spec.md §8.1 an. `config.json`, `state.json`, `registry.json` und die Zeile in `runs.jsonl` sind schemagültig. Der Fingerprint des Repositorys ist vorher und nachher gleich (I-01). |
| AK-01-04 | `ipa init` ausserhalb eines Git-Repositorys endet mit Exit-Code 2 und legt keinen Arbeitsbereich an. |
| AK-01-05 | Ein zweites `ipa init` endet mit Exit-Code 2. `config.json`, `state.json` und `registry.json` bleiben byte-gleich. |
| AK-01-06 | Liegt die Datenwurzel im Repository oder das Repository in der Datenwurzel, endet `init` mit Exit-Code 2. |
| AK-01-07 | Zwei Repositories erhalten getrennte Arbeitsbereiche. `ipa --repo <a> status` und `ipa --repo <b> status` zeigen jeweils den richtigen, auch bei abweichender Schreibweise des Pfads unter Windows. |
| AK-01-08 | Ein zweiter gleichzeitiger `withLock`-Aufruf löst `LockHeldError` beziehungsweise Exit-Code 3 aus. Ein veralteter Lock eines beendeten Prozesses wird entfernt und protokolliert. |
| AK-01-09 | Schlägt das Schreiben vor dem Umbenennen fehl, bleibt der alte Dateiinhalt unverändert. `createFileExclusive` scheitert bei vorhandener Datei. `readJsonl` meldet ungültige und unvollständige Zeilen, ohne die gültigen zu verlieren. |
| AK-01-10 | `GitRunner` lehnt nicht gelistete Befehle ab, ebenso `hash-object -w` und `config` ohne `--get`, und zwar ohne einen Prozess zu starten. Er setzt `GIT_OPTIONAL_LOCKS=0` und entfernt `GIT_DIR` und `GIT_INDEX_FILE` aus der Umgebung. |
| AK-01-11 | `formatZoned` und `dayOf` liefern für `Europe/Zurich` korrekte Offsets im Sommer (+02:00) und Winter (+01:00) sowie an beiden Umstellungstagen 2026. Das Tageswechsel-Verhalten um Mitternacht ist korrekt. |
| AK-01-12 | Eine ungültige `config.json` führt bei `status` zu Exit-Code 2 mit Angabe des Feldes. Eine Datei mit `schemaVersion: 2` führt zu Exit-Code 2. |
| AK-01-13 | `ipa status --json` liefert genau die Felder von Paket 01 aus spec.md §6.6. `status` schreibt keine Datei. |
| AK-01-14 | Das globale Vitest-Setup verhindert Schreibzugriffe auf die echte Datenwurzel. Ein Test weist nach, dass `IPA_ASSISTANT_HOME` auf ein Temp-Verzeichnis zeigt. |

## 8. Notwendige Tests und Validierung

- Unit-Tests:
  - IDs mit Mustern aus §8.2
  - Zeitfunktionen
  - Schemaregister mit gültigen und ungültigen Beispielen je Schema
  - Pfadnormalisierung
  - Datenwurzel-Reihenfolge
  - Exit-Code-Abbildung
- Integrationstests mit `test/helpers/git-repo.ts`:
  - `init` und `status` über den echten CLI-Einstieg (`node dist/cli.js` oder direkter Aufruf der CLI-Funktion mit injizierten Argumenten)
  - mehrere Repositories
  - Datenwurzel innerhalb des Repositorys
  - Repository ohne Commits
- Lock-Tests mit echtem zweiten Prozess und mit simuliertem veraltetem Lock
- Manuelle Prüfung: `npm install --global .` und anschliessend `ipa --repo <testrepo> init` in einer Windows-Konsole. Das Ergebnis wird in der Checkliste vermerkt.

## 9. Offene Annahmen

- Der Befehlsname `ipa` kann auf einem Rechner mit einem anderen Programm kollidieren. Falls das auftritt, wird der Konflikt in spec.md §18 dokumentiert. Eine Umbenennung ist dann eine Benutzerentscheidung.
