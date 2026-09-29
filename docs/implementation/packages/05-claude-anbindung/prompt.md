# Umsetzungsprompt: Paket 05 – Claude-Anbindung

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 05 – Claude-Anbindung** gemäss `docs/implementation/packages/05-claude-anbindung/spec.md`.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md`
3. `docs/implementation/spec.md`: verbindliche gemeinsame Spezifikation, vollständig lesen
4. `docs/implementation/checklist.md`
5. `docs/implementation/packages/05-claude-anbindung/spec.md`
6. `docs/implementation/packages/05-claude-anbindung/checklist.md`
7. Spezifikationen der vorausgesetzten Pakete. Lies dort die Abschnitte 4, 5 und 7:
   - `docs/implementation/packages/01-cli-grundlage/spec.md`
   - `docs/implementation/packages/02-snapshot-erfassung/spec.md`

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Bei Abweichungen gilt `docs/implementation/spec.md`. Verändere das Konzept nicht.

Die gemeinsamen Verträge (Datenmodelle, Befehle, Exit-Codes, Schnittstellen, Invarianten I-01 bis I-15, Regeln R-01 bis R-07) stehen nur in `docs/implementation/spec.md`. Halte dich exakt an diese Namen und Formate.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Vorausgesetzte Pakete: Paket 01 – CLI-Grundlage, Paket 02 – Snapshot-Erfassung. Prüfe in `docs/implementation/packages/01-cli-grundlage/checklist.md`, `docs/implementation/packages/02-snapshot-erfassung/checklist.md` und in `docs/implementation/checklist.md`, ob sie als `abgeschlossen` oder `technisch abgeschlossen` markiert sind. `technisch abgeschlossen` bedeutet: Nur manuelle Prüfungen oder Live-Prüfungen sind offen. Das genügt als Voraussetzung. Offene Live-Prüfungen nennst du aber als Risiko.
3. Prüfe den tatsächlichen Codezustand. Eine abgehakte Checkliste allein genügt nicht:
   - `ipa init` nimmt einen Ausgangs-Snapshot auf (Paket 02).
   - `npm run typecheck` und `npm test` sind vor deinen Änderungen grün.
   - Prüfe die installierte Claude-Code-Version mit `claude --version`. Vergleiche sie mit spec.md §2.2 und §13.2, und trage Abweichungen in spec.md §18 ein.
4. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
5. Setze in `docs/implementation/checklist.md` den Status von Paket 05 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/05-claude-anbindung/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- `ClaudeRunner` gemäss spec.md §13.1 und §13.3 mit Timeout und `ai-usage.jsonl` (§9.12)
- `probeClaude`, `ensureClaudeReady` und `doctor.json` (§9.13), Befehl `ipa doctor [--live]`, Aufruf aus `ipa init`
- Hilfsfunktion für Ausgabeschemas (§8.4)
- Fake-CLI `test/helpers/fake-claude.mjs` und Skript `npm run test:live`, `status`-Feld `claude`

Dazu gehören:

- **Integration:** Jede neue Komponente ist an das CLI oder an einen bestehenden Ablauf angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe alle in Abschnitt 8 der Paketspezifikation genannten Tests. Jedes Akzeptanzkriterium `AK-05-xx` braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Halte die Testregeln aus spec.md §16.2 ein: temporäre Repositories und Datenwurzeln, Prüfung des Repository-Fingerprints, keine echten Secrets.
- **Dokumentation:** Aktualisiere das `README.md` im Repository-Root für neue oder geänderte Befehle.

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: Analyse-Eingabepakete, Analyse- und Journal-Prompts, fachliche Validierung und Wiederholungen pro Snapshot (Pakete 06 und 07).
- Setze nichts um, was spec.md §1.3 ausschliesst.
- Schütze vorhandene Änderungen:
  - Verwende kein `git reset`, `git checkout -- …`, `git restore`, `git stash`, `git clean` und keine Force-Operationen.
  - Überschreibe oder lösche keine Dateien, die du nicht selbst in dieser Sitzung angelegt hast, ausser die Paketspezifikation verlangt es ausdrücklich.
  - Erstelle keinen Commit, ausser der Benutzer verlangt es.
- Füge keine Abhängigkeiten ausser den in spec.md §4.1 genannten hinzu. Ist eine weitere Abhängigkeit unvermeidbar, gilt Abschnitt 5.
- Tests dürfen nie in die echte Datenwurzel schreiben und das untersuchte Repository nie verändern.
- Echte Claude-Aufrufe (`ipa doctor --live`, `npm run test:live`, manuelle Live-Prüfungen) führst du nur aus, wenn der Benutzer sie in dieser Sitzung ausdrücklich freigegeben hat. Frage vorher einmal nach und nenne dabei Zweck und ungefähre Anzahl der Aufrufe. Ohne Freigabe bleiben die betroffenen Checklistenpunkte offen. Nenne sie in der Zusammenfassung.

## 5. Widersprüche und Unklarheiten

- Widersprechen sich Spezifikation, Paketspezifikation, vorhandener Code oder andere Pakete bei einer Schnittstelle, weiche nicht stillschweigend ab.
- Dokumentiere jede Klärung in spec.md §18 mit Datum, Paket 05, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in spec.md an, statt eine abweichende Kopie in der Paketspezifikation anzulegen.
- Trage paketbezogene Folgen in Abschnitt 9 („Offene Annahmen“) von `docs/implementation/packages/05-claude-anbindung/spec.md` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern, halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/05-claude-anbindung/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter, also Testname, Befehl oder Datum und Ergebnis. Planung allein ist kein Nachweis.
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

Beginne danach **nicht** mit dem nächsten Paket (Paket 06), auch wenn Zeit bleibt. Die nächste Sitzung startet mit dem Prompt des nächsten Pakets.
