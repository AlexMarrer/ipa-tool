# Umsetzungsprompt: Paket 03 – Änderungszuordnung

Du arbeitest im Repository des **IPA Assistant**. Dein Arbeitsverzeichnis ist der Repository-Root. Dein Auftrag ist ausschliesslich die Umsetzung von **Paket 03 – Änderungszuordnung** gemäss `docs/implementation/packages/03-aenderungszuordnung/spec.md`.

## 1. Zuerst lesen

Lies diese Dateien vollständig, bevor du etwas änderst:

1. `CLAUDE.md` und `AGENTS.md` im Repository-Root, falls vorhanden. Befolge deren Anweisungen.
2. `docs/implementation/README.md`
3. `docs/implementation/spec.md`: verbindliche gemeinsame Spezifikation, vollständig lesen
4. `docs/implementation/checklist.md`
5. `docs/implementation/packages/03-aenderungszuordnung/spec.md`
6. `docs/implementation/packages/03-aenderungszuordnung/checklist.md`
7. Spezifikationen der vorausgesetzten Pakete. Lies dort die Abschnitte 4, 5 und 7:
   - `docs/implementation/packages/01-cli-grundlage/spec.md`
   - `docs/implementation/packages/02-snapshot-erfassung/spec.md`

`IPA_ASSISTANT_KONZEPT.md` dient nur als Hintergrund. Bei Abweichungen gilt `docs/implementation/spec.md`. Verändere das Konzept nicht.

Die gemeinsamen Verträge (Datenmodelle, Befehle, Exit-Codes, Schnittstellen, Invarianten I-01 bis I-15, Regeln R-01 bis R-07) stehen nur in `docs/implementation/spec.md`. Halte dich exakt an diese Namen und Formate.


## Zusatzkontext aus Paket 02

Paket 02 ist abgeschlossen. `npm run typecheck`, `npm run build` und `npm test` waren zuletzt grün. Stand: 241 Tests bestanden, 1 Test übersprungen. Paket 03 wurde noch nicht begonnen.

Wichtige technische Erkenntnisse aus Paket 02:

- Der `GitRunner` setzt `-c diff.autoRefreshIndex=false`, weil `git diff` unter Git for Windows sonst trotz `GIT_OPTIONAL_LOCKS=0` die `.git/index` verändern kann. Diese Schutzmassnahme gehört zu I-01 und darf nicht entfernt werden.
- Git for Windows kann Dateien über Directory Junctions ausserhalb des Repositorys sichtbar machen. Vor jedem tatsächlichen Dateizugriff wird deshalb der aufgelöste reale Pfad geprüft. Externe Ziele dürfen nicht gelesen werden.
- Die Secret-Erkennung ist bewusst heuristisch. Pfadfilter allein reichen nicht. Auffällige Inhalte in normalen Quelldateien oder Diffs werden zurückgehalten. False Positives und False Negatives sind möglich und dokumentiert.
- Muster ohne `/` werden bei Pfadfiltern gegen den Dateinamen geprüft. Dies wurde selbst implementiert, weil Picomatchs globale `basename`-Option nicht exakt dem gewünschten Verhalten entspricht.
- `filterDecisions` enthält zusätzlich `line`, `evidence` und ein nullbares `path`.
- `runs.jsonl` unterstützt das optionale Feld `recovered`.
- Die Dateiliste eines Commits wird über `git show --raw` ermittelt. Dafür wird Git 2.31 oder neuer vorausgesetzt.
- `ipa capture` erzeugt aktuell bei jedem Aufruf einen Snapshot. Die eigentliche Relevanzprüfung und `analysisRequired` werden erst in Paket 03 umgesetzt.
- `ipa init` erzeugt den Ausgangs-Snapshot `S000001` und kann einen fehlenden Ausgangs-Snapshot bei erneutem Aufruf nachholen.
- Integrationstests verwenden echte temporäre Git-Repositories und prüfen den Repository-Fingerprint vor und nach dem Lauf, einschliesslich `.git/index`.
- Unter Windows kann der echte Symlink-Test ohne Entwicklermodus mit `EPERM` übersprungen werden. Das Verhalten gegen externe Pfade wurde zusätzlich über Junctions geprüft.
- Die parallele Git-Verarbeitung wurde auf höchstens 4 Prozesse begrenzt. Das Test-Timeout liegt wegen langsamer Windows-Git-Integrationstests bei 120 Sekunden.
- Aus Paket 01 sind A-02, A-03 und A-08 weiterhin offen. Die Live-Claude-Prüfung soll vor Paket 05 in einem normalen Terminal wiederholt werden.

Diese Punkte sind bestehende Designentscheidungen beziehungsweise bekannte Randbedingungen. Ändere sie in Paket 03 nur, wenn die Spezifikation dies zwingend erfordert oder ein reproduzierbarer Fehler vorliegt.

## 2. Ausgangslage prüfen, bevor du implementierst

1. Führe `git status` und `git log --oneline -10` aus. Notiere vorhandene uncommittete Änderungen. Sie gehören nicht dir und bleiben erhalten.
2. Vorausgesetzte Pakete: Paket 01 – CLI-Grundlage, Paket 02 – Snapshot-Erfassung. Prüfe in `docs/implementation/packages/01-cli-grundlage/checklist.md`, `docs/implementation/packages/02-snapshot-erfassung/checklist.md` und in `docs/implementation/checklist.md`, ob sie als `abgeschlossen` oder `technisch abgeschlossen` markiert sind. `technisch abgeschlossen` bedeutet: Nur manuelle Prüfungen oder Live-Prüfungen sind offen. Das genügt als Voraussetzung. Offene Live-Prüfungen nennst du aber als Risiko.
3. Prüfe den tatsächlichen Codezustand. Eine abgehakte Checkliste allein genügt nicht:
   - `ipa capture` erzeugt Snapshots mit `fileStates` und Kopien gemäss Paket 02. Manifeste sind schemagültig.
   - `npm run typecheck` und `npm test` sind vor deinen Änderungen grün.
4. Fehlen Voraussetzungen oder schlagen bestehende Tests fehl, beginne nicht mit der Umsetzung. Berichte den Befund mit Befehlsausgabe und beende die Sitzung.
5. Setze in `docs/implementation/checklist.md` den Status von Paket 03 auf `in Arbeit`.

## 3. Auftrag

Setze das in `docs/implementation/packages/03-aenderungszuordnung/spec.md` beschriebene Verhalten vollständig um. Schwerpunkte:

- `state_delta`, dokumentierte Blobs, Statusänderungen und Zuordnung der Commit-Dateien (spec.md §11.4)
- Relevanz und `analysisRequired` (§11.3)
- Halt-Erkennung (§11.5) und Befehl `ipa baseline --reason [--force]`
- Testberichte mit `fresh` (D-17), `status`-Feld `halt`

Dazu gehören:

- **Integration:** Jede neue Komponente ist an das CLI oder an einen bestehenden Ablauf angeschlossen. Ungenutzter Code gilt nicht als erledigt.
- **Tests:** Schreibe alle in Abschnitt 8 der Paketspezifikation genannten Tests. Jedes Akzeptanzkriterium `AK-03-xx` braucht mindestens einen benannten Test oder eine dokumentierte manuelle Prüfung. Halte die Testregeln aus spec.md §16.2 ein: temporäre Repositories und Datenwurzeln, Prüfung des Repository-Fingerprints, keine echten Secrets.
- **Dokumentation:** Aktualisiere das `README.md` im Repository-Root für neue oder geänderte Befehle.
- **Code-Kommentare:** Schreibe Kommentare im Code immer auf Englisch, auch JSDoc, in Tests und in Skripten. Setze sie nur dort, wo sie nötig sind, zum Beispiel für einen nicht offensichtlichen Grund, eine Vorgabe aus der Spezifikation oder einen Workaround. Kommentare, die nur den Code wiederholen, entfallen. Meldungen an den Benutzer bleiben deutsch (spec.md §6.5).

## 4. Grenzen

- Bearbeite nur dieses Paket. Nicht jetzt umsetzen: Analyse, Work-Logs und Journal. Tests werden nicht ausgeführt.
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
- Dokumentiere jede Klärung in spec.md §18 mit Datum, Paket 03, Befund, Entscheidung und betroffenen Abschnitten. Passe die betroffene Definition in spec.md an, statt eine abweichende Kopie in der Paketspezifikation anzulegen.
- Trage paketbezogene Folgen in Abschnitt 9 („Offene Annahmen“) von `docs/implementation/packages/03-aenderungszuordnung/spec.md` ein.
- Würde eine Klärung Architektur oder Funktionsumfang wesentlich verändern, halte an und frage den Benutzer.

## 6. Checklisten aktualisieren

- Hake in `docs/implementation/packages/03-aenderungszuordnung/checklist.md` nur Punkte ab, die umgesetzt und geprüft sind. Schreibe den Nachweis dahinter, also Testname, Befehl oder Datum und Ergebnis. Planung allein ist kein Nachweis.
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

Beginne danach **nicht** mit dem nächsten Paket (Paket 04), auch wenn Zeit bleibt. Die nächste Sitzung startet mit dem Prompt des nächsten Pakets.
