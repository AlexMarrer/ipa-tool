# Umsetzungsprompt: Paket 01 – CLI-Grundlage

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 01 – CLI-Grundlage** gemäss `docs/implementation/packages/01-cli-grundlage/spec.md`.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md`
3. `docs/implementation/spec.md`: verbindliche gemeinsame Spezifikation, vollständig lesen
4. `docs/implementation/checklist.md`
5. `docs/implementation/packages/01-cli-grundlage/spec.md`
6. `docs/implementation/packages/01-cli-grundlage/checklist.md`

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Bei Abweichungen gilt `docs/implementation/spec.md`. Verändere das Konzept nicht.

Die gemeinsamen Verträge (Datenmodelle, Befehle, Exit-Codes, Schnittstellen, Invarianten I-01 bis I-15, Regeln R-01 bis R-07) stehen nur in `docs/implementation/spec.md`. Halte dich exakt an diese Namen und Formate.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Vorausgesetzte Pakete: keine.
3. Prüfe den tatsächlichen Codezustand. Eine abgehakte Checkliste allein genügt nicht:
   - Das Repository enthält noch keinen Anwendungscode. Falls doch `package.json`, `tsconfig.json` oder `src/` existieren, vergleichst du den Stand mit `docs/implementation/spec.md` §4.1 und dokumentierst Abweichungen, bevor du etwas änderst.
   - `node --version` meldet mindestens Version 24, `git --version` ist verfügbar.
4. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
5. Setze in `docs/implementation/checklist.md` den Status von Paket 01 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/01-cli-grundlage/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- Projektgerüst mit TypeScript strikt, ESM, Commander, Ajv und Vitest gemäss spec.md §4.1
- Core-Bausteine aus spec.md §10, Abschnitt „core“, sowie `createGitRunner` mit Leseliste (§14.2)
- Befehle `ipa init` (ohne Snapshot) und `ipa status [--json]`
- Test-Helfer `test/helpers/git-repo.ts`, `repo-fingerprint.ts` und `workspace.ts` sowie ein globales Vitest-Setup
- `README.md` im Repository-Root mit Installation, Datenwurzel, `init` und `status`

Dazu gehören:

- **Integration:** Jede neue Komponente ist an das CLI oder an einen bestehenden Ablauf angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe alle in Abschnitt 8 der Paketspezifikation genannten Tests. Jedes Akzeptanzkriterium `AK-01-xx` braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Halte die Testregeln aus spec.md §16.2 ein: temporäre Repositories und Datenwurzeln, Prüfung des Repository-Fingerprints, keine echten Secrets.
- **Dokumentation:** Aktualisiere das `README.md` im Repository-Root für neue oder geänderte Befehle.

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: Snapshots, Filter, Notizen, Claude-Aufrufe, Analyse, Journal und Zeitsteuerung. Registriere keine Befehle späterer Pakete, auch nicht als Platzhalter.
- Setze nichts um, was spec.md §1.3 ausschliesst.
- Schütze vorhandene Änderungen:
  - Verwende kein `git reset`, `git checkout -- …`, `git restore`, `git stash`, `git clean` und keine Force-Operationen.
  - Überschreibe oder lösche keine Dateien, die du nicht selbst in dieser Sitzung angelegt hast, ausser die Paketspezifikation verlangt es ausdrücklich.
  - Erstelle keinen Commit, ausser der Benutzer verlangt es.
- Füge keine Abhängigkeiten ausser den in spec.md §4.1 genannten hinzu. Ist eine weitere Abhängigkeit unvermeidbar, gilt Abschnitt 5.
- Tests dürfen nie in die echte Datenwurzel schreiben und das untersuchte Repository nie verändern.
- Dieses Paket ruft Claude nie echt auf.

## 5. Widersprüche und Unklarheiten

- Widersprechen sich Spezifikation, Paketspezifikation, vorhandener Code oder andere Pakete bei einer Schnittstelle, weiche nicht stillschweigend ab.
- Dokumentiere jede Klärung in spec.md §18 mit Datum, Paket 01, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in spec.md an, statt eine abweichende Kopie in der Paketspezifikation anzulegen.
- Trage paketbezogene Folgen in Abschnitt 9 („Offene Annahmen“) von `docs/implementation/packages/01-cli-grundlage/spec.md` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern, halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/01-cli-grundlage/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter, also Testname, Befehl oder Datum und Ergebnis. Planung allein ist kein Nachweis.
- Aktualisiere in `docs/implementation/checklist.md` den Paketstatus:
  - `abgeschlossen` nur, wenn alle Punkte der Paketcheckliste erledigt sind
  - `technisch abgeschlossen`, wenn nur manuelle Prüfungen oder Live-Prüfungen offen sind. Nenne diese Punkte.
  - sonst `in Arbeit` mit kurzem Hinweis auf die offenen Punkte
- Hake Zeilen der Abnahmematrix nur ab, wenn alle dort genannten Nachweise vorliegen.

## 7. Abschluss

1. Führe `npm run typecheck`, `npm test` und `npm run build` aus.
2. Gib eine kurze Zusammenfassung:
   - geänderte und neue Dateien
   - ausgeführte Prüfungen mit Ergebnis
   - erfüllte und offene Akzeptanzkriterien
   - Einträge in spec.md §18
   - verbleibende Risiken oder offene Punkte

Beginne danach **nicht** mit dem nächsten Paket (Paket 02), auch wenn Zeit bleibt. Die nächste Sitzung startet mit dem Prompt des nächsten Pakets.
