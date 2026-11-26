# Checkliste Paket 12 – App Aktionen

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [x] Paket 11 im Code vorhanden, seine Tests grün — Paket 11 committet (62f8920), seine Tests grün (26.11.2026)
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben — Git-Status vor Beginn geprüft, nur eigene Änderungen

## Implementierung

- [x] Laufanzeige in allen Zuständen (AK-10-36) — `test/components/shell.test.tsx`, `actions.test.tsx` (Läuft, Live-Ausgabe, Erfolg, Exit 6, Exit 3, abgebrochen, fremder Lauf), Galerie `Laufanzeige: läuft/Ergebnis` in Hell und Dunkel, e2e `actions.e2e.ts`
- [x] Live-Ausgabe aus Dateiereignissen (AK-10-37) — `test/unit/actions.test.ts` (langsames Fake-Claude: Reihenfolge, Uhrzeit, keine Inhalte), `progress.test.ts`, e2e Live-Ausgabe
- [x] Jetzt erfassen, Nur aufnehmen, Exit-Codes in Klartext (AK-10-38) — `run-texts.test.ts` (Exit 0 bis 7, unbekannt, Fehler, abgebrochen), `actions.test.ts` (echtes CLI), e2e Nur aufnehmen und Jetzt erfassen
- [x] Sperren in der Oberfläche, fremde Läufe (AK-10-39) — `actions.test.tsx` (fremder Lauf, Claude nicht bereit, Journal-Lauf), `actions.test.ts` (Fremd-Lock über `lock-holder.mjs`), e2e Sperre während des Laufs
- [x] Journal erzeugen, Journal-Fehler (AK-10-40) — `actions.test.tsx` (KI, ohne KI, Exit 6 mit früherem Entwurf, gesperrt), `actions.test.ts`
- [x] Dialog Erneut versuchen (AK-10-41) — `actions.test.tsx` (Versuche, Fehlerklasse, korrigierter Hinweis, `capture --retry`)
- [x] Dialog Überspringen (AK-10-42) — `actions.test.tsx` (Pflichtgrund, Vorschau, nur bei offenen Status)
- [x] Dialog Ausgangspunkt (AK-10-43) — `actions.test.tsx` (Halt, Trotzdem setzen mit `--force`), e2e Halt aufheben
- [x] Grund-Prüfung ohne Preisgabe von Werten (AK-10-44) — `actions.test.tsx` (Detektor, Absenden gesperrt, Wert nirgends), `actions.test.ts` (Grund mit Secret: nicht in Zusammenfassung, Ereignissen, Protokollen)
- [x] Notiz-Dialog Standard und Typen (AK-10-45) — `actions.test.tsx`, e2e Strg+N, Strg+Enter, Esc
- [x] Notiz-Dialog Zusatzfelder und Zeit (AK-10-46) — `actions.test.tsx`, `noteForm.test.ts`
- [x] Belege-Auswahl (AK-10-47) — `actions.test.tsx` (Suche, Gruppen, keine Treffer, `refs`), `actions.test.ts` (Beleg-Liste aus den Manifesten)
- [x] Notiz speichern mit Bestätigung und Secret-Hinweis (AK-10-48) — `actions.test.ts` (Umlaute, führender Strich, Zeilenumbrüche, Sonderzeichen, 8 000 Zeichen, Secret nur mit Detektor), e2e
- [x] Prüfen in Übersicht und Kopf (AK-10-49) — `actions.test.tsx` (Version, Anmeldeart, Exit 7 mit Liste); kein Modellaufruf (`actions.test.ts`)
- [x] KI-Markierung an genau den richtigen Buttons (AK-10-50) — `actions.test.tsx`, `gallery.test.tsx` (nur die Aktionen aus §12.2)
- [x] Abbrechen-Fluss (AK-10-51) — `cancel.test.ts`, `actions.test.ts` (Abbrechen und Fortsetzen), e2e (Rückfrage, Weiterlaufen lassen, Abbrechen); Rückfrage beim Beenden aus Paket 10

- [x] Nachtrag: Endfassung übernehmen und Journal-Dateien in den Papierkorb löschen (AD-17, AK-10-52) — `journal-files.test.ts`, `actions.test.tsx`, `ipc.test.ts`, e2e mit echtem Papierkorb

## Integration

- [x] Aktionen sind an Work-Logs, Journal, Halt-Banner, Kopfzeile und `Strg+N` angeschlossen — Komponenten- und e2e-Tests
- [x] Nichts startet Claude von selbst, Aufrufprotokoll (AK-10-15) — `actions.test.ts` (keine automatischen KI-Starts), e2e (kein Modellaufruf beim Wechseln der Seiten)

## Tests

- [x] Runner-, Sperren-, Abbruch- und Komponententests (AK-10-36 bis AK-10-51) — `app:test`: 30 Dateien, alle bestanden; e2e 18 bestanden
- [x] Zustandsgalerie: alle Zustände der Gruppen `Lauf`, `Dialoge`, `Notiz-Dialog`, `Journal-Fehler` in Hell und Dunkel — `gallery.test.tsx`, Komponente `ActionStates`
- [x] Notiztext-Grenze unter Windows geprüft, Wert in `app/spec.md §8.8` und `§18` nachgeführt (AO-10) — gemessen 26.11.2026: ein Argument bis 32 000 Zeichen startet, ab rund 32 700 `ENAMETOOLONG`; Grenze 8 000 bleibt, `spec.md` §8.8, §18 und §19 nachgeführt
- [x] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün — alle drei grün am 26.11.2026; die Wurzel ist unverändert, Wurzel-`npm test` mit den zwei bekannten umgebungsbedingten Fehlschlägen (spec §19)
- [ ] **Manuell, vom Benutzer:** ein echter Lauf mit Claude aus der App (Jetzt erfassen und Journal erzeugen) mit Stichprobe der Anzeige; verbraucht Kontingent, Freigabe liegt beim Benutzer

## Dokumentation und Status

- [x] `app/README.md` ergänzt — Stand, Tests und Grenzen
- [x] Klärungen in `docs/app/spec.md §19` eingetragen — neun Einträge zu Paket 12
- [x] `docs/implementation/checklist.md`: Paketstatus aktualisiert — Paket 12 technisch abgeschlossen
