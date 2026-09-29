# Umsetzungsprompt: Paket 02 – Snapshot-Erfassung

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 02 – Snapshot-Erfassung** gemäss `docs/implementation/packages/02-snapshot-erfassung/spec.md`.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md`
3. `docs/implementation/spec.md`: verbindliche gemeinsame Spezifikation, vollständig lesen
4. `docs/implementation/checklist.md`
5. `docs/implementation/packages/02-snapshot-erfassung/spec.md`
6. `docs/implementation/packages/02-snapshot-erfassung/checklist.md`
7. Spezifikationen der vorausgesetzten Pakete. Lies dort die Abschnitte 4, 5 und 7:
   - `docs/implementation/packages/01-cli-grundlage/spec.md`

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Bei Abweichungen gilt `docs/implementation/spec.md`. Verändere das Konzept nicht.

Die gemeinsamen Verträge (Datenmodelle, Befehle, Exit-Codes, Schnittstellen, Invarianten I-01 bis I-15, Regeln R-01 bis R-07) stehen nur in `docs/implementation/spec.md`. Halte dich exakt an diese Namen und Formate.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Vorausgesetzte Pakete: Paket 01 – CLI-Grundlage. Prüfe in `docs/implementation/packages/01-cli-grundlage/checklist.md` und in `docs/implementation/checklist.md`, ob sie als `abgeschlossen` oder `technisch abgeschlossen` markiert sind. `technisch abgeschlossen` bedeutet: Nur manuelle Prüfungen oder Live-Prüfungen sind offen. Das genügt als Voraussetzung. Offene Live-Prüfungen nennst du aber als Risiko.
3. Prüfe den tatsächlichen Codezustand. Eine abgehakte Checkliste allein genügt nicht:
   - `ipa init` und `ipa status` funktionieren. Core-Bausteine, `GitRunner` und Test-Helfer aus Paket 01 sind vorhanden.
   - `npm run typecheck` und `npm test` sind vor deinen Änderungen grün.
4. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
5. Setze in `docs/implementation/checklist.md` den Status von Paket 02 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/02-snapshot-erfassung/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- `PathFilter` und `SecretScanner` (spec.md §14.3, §14.4)
- Git-Parser und Blob-IDs ohne Schreibzugriff (D-05)
- Aufnahme, Konsistenzprüfung, atomare Ablage und Wiederanlauf (spec.md §11.1, §11.2, §11.6) mit Manifest-Schema (§9.3, §9.4)
- `ipa init` mit Ausgangs-Snapshot, `ipa capture [--no-analysis]` ohne KI, `status`-Feld `snapshots`
- Ausschluss eines Arbeitsbereichs im Repository über Pfadfilter und Pathspec (spec.md §5.3, §14.2, §14.3)

Dazu gehören:

- **Integration:** Jede neue Komponente ist an das CLI oder an einen bestehenden Ablauf angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe alle in Abschnitt 8 der Paketspezifikation genannten Tests. Jedes Akzeptanzkriterium `AK-02-xx` braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Halte die Testregeln aus spec.md §16.2 ein: temporäre Repositories und Datenwurzeln, Prüfung des Repository-Fingerprints, keine echten Secrets.
- **Dokumentation:** Aktualisiere das `README.md` im Repository-Root für neue oder geänderte Befehle.
- **Code-Kommentare:** Schreibe Kommentare im Code immer auf Englisch, auch JSDoc, in Tests und in Skripten. Setze sie nur dort, wo sie nötig sind, zum Beispiel für einen nicht offensichtlichen Grund, eine Vorgabe aus der Spezifikation oder einen Workaround. Kommentare, die nur den Code wiederholen, entfallen. Meldungen an den Benutzer bleiben deutsch (spec.md §6.5).

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: Zustandsdelta, Relevanz, Zuordnung, Halt, `baseline` und Testberichte (Paket 03). Dazu Analyse (Paket 06).
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
- Dokumentiere jede Klärung in spec.md §18 mit Datum, Paket 02, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in spec.md an, statt eine abweichende Kopie in der Paketspezifikation anzulegen.
- Trage paketbezogene Folgen in Abschnitt 9 („Offene Annahmen“) von `docs/implementation/packages/02-snapshot-erfassung/spec.md` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern, halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/02-snapshot-erfassung/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter, also Testname, Befehl oder Datum und Ergebnis. Planung allein ist kein Nachweis.
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

Beginne danach **nicht** mit dem nächsten Paket (Paket 03), auch wenn Zeit bleibt. Die nächste Sitzung startet mit dem Prompt des nächsten Pakets.
