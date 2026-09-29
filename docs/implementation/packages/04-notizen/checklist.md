# Checkliste Paket 04 – Notizen

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [ ] Paket 01 ist im Code vorhanden, und seine Tests sind grün.
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben.

## Implementierung

- [ ] Schema `note` gemäss spec.md §9.5
- [ ] `addNote` mit Optionsprüfung, Zeitmodell und Verzögerung (AK-04-01 bis AK-04-05)
- [ ] Interaktive Eingabe mit injizierbaren Strömen und TTY-Prüfung (AK-04-06)
- [ ] Syntaxprüfung von `--ref` (AK-04-07)
- [ ] `readNotes` mit Filtern und Meldung ungültiger Zeilen (AK-04-10)
- [ ] `src/notes/` hängt nur von `core` ab (AK-04-08)

## Integration

- [ ] `ipa note` angebunden, ohne Lock (AK-04-09)
- [ ] `ipa status` zeigt `notesToday` (AK-04-11)

## Tests

- [ ] Unit-Tests für die Optionskombinationen und die Tagesbestimmung mit injizierter Uhr
- [ ] Integrationstests AK-04-01 bis AK-04-11 grün, einschliesslich eines Arbeitsbereichs ohne Snapshots
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Manuell: interaktive Notiz in der Windows-Konsole, Dauer gemessen (Ziel unter einer Minute)

## Dokumentation und Status

- [ ] README: Abschnitt „Notizen“ mit Beispielen
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
