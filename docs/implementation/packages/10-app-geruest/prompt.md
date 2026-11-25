# Umsetzungsprompt: Paket 10 – App-Gerüst

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 10 – App-Gerüst** gemäss `docs/implementation/packages/10-app-geruest/spec.md`. Es ist das erste von fünf Paketen der Desktop-App (Pakete 10 bis 14). Die Oberflächen der übrigen Pakete gehören nicht dazu.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md` und `docs/implementation/checklist.md`
3. `docs/app/spec.md`: die verbindliche Spezifikation der App, vollständig lesen. Besonders §2 (Entscheidungen), §3 (Technik und Architektur), §4 (Vertrag mit dem CLI), §6 (Repository-Struktur und Build), §7 (Ordnerstruktur), §10 (Design-Tokens), §12 (Sicherheit und Sparsamkeit), §16 (Akzeptanzkriterien AK-10-01 bis AK-10-16) und §18 (offene Punkte)
4. `docs/app/design-brief.md` (Hintergrund) und das Design als Claude-Design-Artefakt `https://claude.ai/artifact/QvG2hZpxCHjPtFLEqevgCq`. Die Paletten, Schriften und Icons stehen in `app/spec.md §10`; lies im Artefakt nur nach, wenn dort etwas fehlt (Artefakt-Werkzeug, zuerst `list` mit `scope: "files"`, dann `read` mit `paths`).
5. `docs/implementation/packages/10-app-geruest/spec.md` und `checklist.md`
6. `docs/implementation/spec.md`: die CLI-Verträge, nicht vollständig, aber §5 (Datenwurzel, Registry), §6.3 bis §6.7 (Befehle, Exit-Codes, `--json`), §8.1 (Arbeitsbereich), §8.5 (Lock) und §9.2, §9.11
7. `docs/implementation/packages/09-app-schnittstelle/spec.md` (Hülle der Befehle, `schedule`, `config`)

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Die Verträge des CLI stehen nur in `docs/implementation/spec.md`, die der App nur in `docs/app/spec.md`. Halte dich exakt an deren Namen und Formate.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Prüfe, dass Paket 09 im Code vorhanden ist (`ipa config get`, `ipa schedule status --json`, `--json` der Aktionsbefehle) und dass `npm run typecheck` und `npm test` im Wurzelordner grün sind. Die offene manuelle Prüfung AK-09-17 (echte Aufgabenplanung) nennst du als Risiko, sie hindert Paket 10 nicht.
3. Prüfe die Werkzeuge: `node --version` (24 oder neuer), `git --version`, `npm --version`.
4. Stelle fest, welche Electron-Version gilt: Die neueste stabile Hauptversion, mindestens 44 (`app/spec.md §2`, AD-13), mit der Node-Version aus `https://releases.electronjs.org/releases.json`. Lege sie exakt fest (kein `^`).
5. Prüfe die Konfigurationsschlüssel von `electron-builder` (`extraResources`, `nsis`) gegen die Dokumentation der gewählten Version (AO-07). Die Spezifikation nennt sie nur aus Kenntnis des Werkzeugs.
6. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
7. Setze in `docs/implementation/checklist.md` den Status von Paket 10 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/10-app-geruest/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- **Repository-Struktur** nach `app/spec.md §6`: `app/` mit eigenem `package.json` und `package-lock.json`, keine Workspaces; im Wurzelordner nur die Weiterleitungs-Skripte `app:install`, `app:dev`, `app:typecheck`, `app:test`, `app:build`, `app:dist` und die Zeilen in `.gitignore`. Das CLI (`src/`, `schemas/`, `prompts/`, `test/`, die Konfigurationen) bleibt unverändert.
- **Prozessmodell und Sicherheit** nach `app/spec.md §3.2`: Hauptfenster mit `contextIsolation`, `sandbox`, ohne `nodeIntegration`, eigenes Protokoll `app://` mit Content-Security-Policy, keine Navigation, keine neuen Fenster, Berechtigungsanfragen abgelehnt, eine Instanz, Fuses.
- **Laufzeit und Runner** nach `§3.3`, `§3.4`, `§3.6`, `§3.7`: `resolveRuntime` (Entwicklung, Test, installiert), Start des CLI ohne Shell, Validierung der Hülle gegen die Schemas des CLI, Fehlerklassen, Versionsabgleich, Sperren pro Projekt, Abbruch des Prozessbaums. Der Beobachter und die Erzeugung der Live-Zeilen (`§3.5`) entstehen als Main-Prozess-Baustein mit Tests, die Oberfläche folgt in Paket 12.
- **IPC** nach `§3.9`: schmale Preload-Schnittstelle, Prüfung von Absender und Eingabe.
- **Projektliste und Statuspunkt** nach `§5.1`: Registry lesen, `status --json` je Projekt, Fehlerfälle.
- **Oberfläche:** Layout, Seitenleiste, Kopfzeile, Navigation, Tastenkürzel nach `§8.1`; Tokens Hell und Dunkel nach `§10`; Basiskomponenten und Zustandsgalerie (`§2`, AD-15). Die Inhalte der Bereiche (Übersicht, Tag, Zeitplan, Konfiguration, System, Projekt hinzufügen) kommen in den Paketen 11 bis 14. In diesem Paket sind sie leere Rahmen mit dem Leerzustand der Basiskomponenten; zeige keine erfundenen Daten.
- **Bau:** `stage-cli.mjs` und `fetch-node.mjs` (mit Prüfsumme aus `app/node-runtime.json`) laufen und sind getestet; der Installer selbst folgt in Paket 14.

Dazu gehören:

- **Integration:** Jede neue Komponente ist angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe die in `app/spec.md §17` genannten Tests. Jedes Akzeptanzkriterium AK-10-01 bis AK-10-16 braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Testarbeitsbereiche erzeugst du mit dem echten CLI und der Fake-CLI (`test/helpers/fake-claude.mjs`) in temporären Datenwurzeln. Das untersuchte Repository darf nie verändert werden (Fingerprint prüfen).
- **Dokumentation:** `app/README.md` (Aufbau, Befehle, Versionen mit Begründung, Laufzeit des CLI, Sicherheit) und ein kurzer Abschnitt im Wurzel-`README.md`, der auf die App verweist, ohne ungeprüfte Zusagen.
- **Code-Kommentare:** Schreibe Kommentare im Code immer auf Englisch, auch JSDoc, in Tests und in Skripten. Setze sie nur dort, wo sie nötig sind, zum Beispiel für einen nicht offensichtlichen Grund oder eine Vorgabe aus der Spezifikation. Meldungen an den Benutzer bleiben deutsch mit Schweizer Rechtschreibung (`ss`, kein `ß`).

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: Tagesansicht, Work-Logs, Notizen, Journal, Übersicht (Paket 11), Aktionen und Dialoge (Paket 12), Zeitplan und Konfiguration (Paket 13), Assistent, System, Installer (Paket 14).
- Ändere das CLI nicht (`src/`, `schemas/`, `prompts/`, `test/`, `tsconfig*.json`, `vitest*.ts`). Brauchst du eine Änderung, dokumentiere sie in `app/spec.md §19` und halte an (Abschnitt 5).
- Schütze vorhandene Änderungen:
  - Verwende kein `git reset`, `git checkout -- …`, `git restore`, `git stash`, `git clean` und keine Force-Operationen.
  - Überschreibe oder lösche keine Dateien, die du nicht selbst in dieser Sitzung angelegt hast.
  - Erstelle keinen Commit, ausser der Benutzer verlangt es.
- Füge keine Abhängigkeiten ausser den in `app/spec.md §3.1` genannten hinzu; jede weitere braucht eine Begründung in `app/README.md`.
- Tests schreiben nie in die echte Datenwurzel oder nach `%APPDATA%` und verändern das untersuchte Repository nie.
- Rufe die echte Aufgabenplanung (`schtasks`) nie auf, auch nicht lesend.
- Echte Claude-Aufrufe (`ipa doctor --live`, `npm run test:live`) gibt es in diesem Paket nicht. Bereite höchstens Live-Prüfungen vor; der Benutzer führt sie selbst aus.
- Die App startet nichts, was Claude aufruft, ohne ausdrückliche Handlung des Benutzers (`app/spec.md §12.1`). Das gilt schon für das Gerüst.

## 5. Widersprüche und Unklarheiten

- Widersprechen sich die App-Spezifikation, der Code des CLI, das Design oder die Dokumentation von Electron, weiche nicht stillschweigend ab.
- Dokumentiere jede Klärung in `docs/app/spec.md §19` mit Datum, Paket 10, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in der Spezifikation an, statt eine abweichende Kopie anzulegen. Trage Folgen in `§18` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern (zum Beispiel ein nötiger Eingriff ins CLI, `app/spec.md §4.4`), halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/10-app-geruest/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter (Testname, Befehl oder Datum und Ergebnis). Planung allein ist kein Nachweis.
- Aktualisiere in `docs/implementation/checklist.md` den Paketstatus: `abgeschlossen` nur bei allen erledigten Punkten, `technisch abgeschlossen`, wenn nur manuelle Prüfungen offen sind (nenne sie), sonst `in Arbeit` mit Hinweis.

## 7. Abschluss

1. Führe `npm run app:typecheck`, `npm run app:test` und `npm run app:build` aus, dazu im Wurzelordner `npm run typecheck`, `npm test` und `npm run build` (unverändert grün). `npm test` dauert auf einem langsamen Rechner viele Minuten; starte es im Hintergrund.
2. Gib eine kurze Zusammenfassung:
   - geänderte und neue Dateien
   - ausgeführte Prüfungen mit Ergebnis
   - erfüllte und offene Akzeptanzkriterien
   - Einträge in `app/spec.md §19`
   - verbleibende Risiken, insbesondere die gewählten Versionen und die Prüfung von `electron-builder` (AO-07)

Beginne danach **nicht** mit Paket 11, auch wenn Zeit bleibt.
