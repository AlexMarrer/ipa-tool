# Umsetzungsprompt: Paket 09 – App-Schnittstelle

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 09 – App-Schnittstelle** gemäss `docs/implementation/packages/09-app-schnittstelle/spec.md`. Das Paket bereitet eine Desktop-App vor, die App selbst gehört nicht dazu.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md`
3. `docs/implementation/spec.md`: verbindliche gemeinsame Spezifikation, vollständig lesen. Besonders §6.3 (Befehlsdetails), §6.7 (Ausgabe mit `--json`, Befehle der App-Schnittstelle), §7 (Konfiguration), §9.11 (`runs.jsonl`), §10 (Schnittstellen) und §16.2 (Testregeln)
4. `docs/implementation/checklist.md`
5. `docs/implementation/packages/09-app-schnittstelle/spec.md`
6. `docs/implementation/packages/09-app-schnittstelle/checklist.md`
7. Spezifikation des vorausgesetzten Pakets 08, dort die Abschnitte 4, 5 und 7: `docs/implementation/packages/08-zeitsteuerung-und-abnahme/spec.md`

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Bei Abweichungen gilt `docs/implementation/spec.md`. Verändere das Konzept nicht.

Die gemeinsamen Verträge (Datenmodelle, Befehle, Exit-Codes, Schnittstellen, Invarianten I-01 bis I-15, Regeln R-01 bis R-07) stehen nur in `docs/implementation/spec.md`. Halte dich exakt an diese Namen und Formate. Die Felder der JSON-Ausgabe stehen nur in §6.7.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Vorausgesetzte Pakete: 01 bis 08. Prüfe in `docs/implementation/checklist.md`, ob Paket 08 als `abgeschlossen` oder `technisch abgeschlossen` markiert ist. Offene manuelle Prüfungen früherer Pakete (insbesondere AK-08-07, die Prüfung der echten Aufgabenplanung) und Live-Prüfungen nennst du als Risiko.
3. Prüfe den tatsächlichen Codezustand: `ipa status --json`, `ipa schedule --os windows|cron`, `renderWindowsTask` in `src/schedule/templates.ts` und `loadConfig`/`writeConfig` in `src/core/config.ts` sind vorhanden. `npm run typecheck` und `npm test` sind vor deinen Änderungen grün.
4. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
5. Setze in `docs/implementation/checklist.md` den Status von Paket 09 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/09-app-schnittstelle/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- `--json` für `init`, `capture`, `journal`, `note`, `skip`, `baseline` und `doctor` mit gemeinsamer Hülle und je einem Schema unter `schemas/`. stderr, Exit-Codes und die Textausgabe ohne `--json` bleiben unverändert, ebenso `ipa status --json`.
- Befehl `ipa config get|check|set` mit Prüfung gegen `schemas/config.schema.json` und die Zeitplanregeln von `ipa schedule`, atomarem Schreiben, Schutz von `repositoryId`, `repository.path` und Zeitzone und dem ausdrücklichen Flag `--confirm-paid-usage` für `claude.allowPaidUsage`.
- Zeitplan-Verwaltung `ipa schedule install|status|pause|resume|remove|run` über `schtasks` mit austauschbarem Runner, der gemeinsamen Funktion für Läufe und Obergrenze der Claude-Aufrufe, und den Zuständen nicht eingerichtet, aktiv, pausiert, veraltet und Fehler.
- `ipa schedule --os windows|cron [--output]` bleibt unverändert.

Dazu gehören:

- **Integration:** Jede neue Komponente ist an das CLI oder an einen bestehenden Ablauf angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe alle in Abschnitt 8 der Paketspezifikation genannten Tests. Jedes Akzeptanzkriterium `AK-09-xx` braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Halte die Testregeln aus spec.md §16.2 ein: temporäre Repositories und Datenwurzeln, Prüfung des Repository-Fingerprints, keine echten Secrets. **Kein automatischer Test fasst die echte Windows-Aufgabenplanung an, auch nicht lesend.** `schtasks` läuft über den austauschbaren Runner; Tests rufen `main(argv, io, deps)` im selben Prozess mit der Nachbildung `test/helpers/scheduler.ts` auf.
- **Dokumentation:** Aktualisiere das `README.md` im Repository-Root für neue oder geänderte Befehle, und arbeite die Verträge in `docs/implementation/spec.md` ein.
- **Code-Kommentare:** Schreibe Kommentare im Code immer auf Englisch, auch JSDoc, in Tests und in Skripten. Setze sie nur dort, wo sie nötig sind, zum Beispiel für einen nicht offensichtlichen Grund, eine Vorgabe aus der Spezifikation oder einen Workaround. Meldungen an den Benutzer bleiben deutsch mit Schweizer Rechtschreibung (`ss`, kein `ß`, spec.md §6.5).

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: die Desktop-App selbst, ein Befehl zum Testen von Pfaden gegen den Dateifilter, ein Befehl zum Lesen von Work-Logs, Notizen oder Journalen, eine Verwaltung für cron, Linux oder macOS, globale Standardwerte, eine automatische Einrichtung des Zeitplans.
- Setze nichts um, was spec.md §1.3 ausschliesst.
- Schütze vorhandene Änderungen:
  - Verwende kein `git reset`, `git checkout -- …`, `git restore`, `git stash`, `git clean` und keine Force-Operationen.
  - Überschreibe oder lösche keine Dateien, die du nicht selbst in dieser Sitzung angelegt hast, ausser die Paketspezifikation verlangt es ausdrücklich.
  - Erstelle keinen Commit, ausser der Benutzer verlangt es.
- Füge keine Abhängigkeiten ausser den in spec.md §4.1 genannten hinzu. Ist eine weitere Abhängigkeit unvermeidbar, gilt Abschnitt 5.
- Tests dürfen nie in die echte Datenwurzel schreiben und das untersuchte Repository nie verändern.
- Rufe die echte Aufgabenplanung (`schtasks`) nie auf, auch nicht lesend, ausser der Benutzer hat es in dieser Sitzung ausdrücklich verlangt. Die manuelle Prüfung gemäss AK-09-17 gehört dem Benutzer; trage sie als offenen Punkt in die Checkliste ein.
- Echte Claude-Aufrufe (`ipa doctor --live`, `npm run test:live`, manuelle Live-Prüfungen) bereitest du nur vor, der Benutzer führt sie selbst aus. Dieses Paket braucht keine.

## 5. Widersprüche und Unklarheiten

- Widersprechen sich Spezifikation, Paketspezifikation, vorhandener Code oder andere Pakete bei einer Schnittstelle, weiche nicht stillschweigend ab.
- Dokumentiere jede Klärung in spec.md §18 mit Datum, Paket 09, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in spec.md an, statt eine abweichende Kopie in der Paketspezifikation anzulegen.
- Trage paketbezogene Folgen in Abschnitt 9 („Offene Annahmen“) von `docs/implementation/packages/09-app-schnittstelle/spec.md` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern, halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/09-app-schnittstelle/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter, also Testname, Befehl oder Datum und Ergebnis. Planung allein ist kein Nachweis.
- Aktualisiere in `docs/implementation/checklist.md` den Paketstatus:
  - `abgeschlossen` nur, wenn alle Punkte der Paketcheckliste erledigt sind
  - `technisch abgeschlossen`, wenn nur manuelle Prüfungen oder Live-Prüfungen offen sind. Nenne diese Punkte.
  - sonst `in Arbeit` mit kurzem Hinweis auf die offenen Punkte
- Die Abnahmematrix zu Konzept §17 bleibt von diesem Paket unberührt.

## 7. Abschluss

1. Führe `npm run typecheck`, `npm test` und `npm run build` aus. `npm test` dauert auf einem langsamen Rechner viele Minuten; starte es im Hintergrund.
2. Gib eine kurze Zusammenfassung:
   - geänderte und neue Dateien
   - ausgeführte Prüfungen mit Ergebnis
   - erfüllte und offene Akzeptanzkriterien
   - Einträge in spec.md §18
   - verbleibende Risiken oder offene Punkte, insbesondere die manuelle Prüfung der echten Aufgabenplanung

Beginne danach **nicht** mit dem nächsten Paket, auch wenn Zeit bleibt.
