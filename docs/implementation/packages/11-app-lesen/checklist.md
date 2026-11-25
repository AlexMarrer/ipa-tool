# Checkliste Paket 11 – App Lesen

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [ ] Paket 10 im Code vorhanden, seine Tests grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben
- [ ] Fixtures aus dem echten CLI mit Fake-CLI für alle Status, Halt, Lücken, Tageszuordnung, zurückgehaltene Notizen, Journale

## Implementierung

- [ ] Reader mit Schemaprüfung und tolerantem JSONL, Beobachtung (AK-10-17, AK-10-34)
- [ ] Ableitung Analyse-Status gleich `status --json` (AK-10-18)
- [ ] Tage, Zeitzone, Tageszuordnung, Sortierung (AK-10-19)
- [ ] Tageskopf und Kalender (AK-10-20)
- [ ] Tageszusammenfassung ohne Gesamtsumme (AK-10-21)
- [ ] Zeitstrahl (AK-10-22)
- [ ] Hinweise und Lücken (AK-10-23)
- [ ] Tabs, Zähler, Tageszustände (AK-10-24)
- [ ] Work-Logs (AK-10-25)
- [ ] Notizenliste (AK-10-26)
- [ ] Journal lesen (AK-10-27)
- [ ] Markdown sicher (AK-10-28)
- [ ] Markdown-Darstellung (AK-10-29)
- [ ] Referenz-Chips und KI-Etiketten (AK-10-30)
- [ ] Projektübersicht (AK-10-31)
- [ ] Halt-Banner (AK-10-32)
- [ ] Statuspunkt und Kurzhinweis (AK-10-33)

## Integration

- [ ] Alle Ansichten sind über Navigation, Seitenleiste und Referenz-Chips erreichbar
- [ ] Lesen verändert nichts, Fingerprints unverändert (AK-10-35)

## Tests

- [ ] Reader-, Komponenten- und Markdown-Tests (AK-10-17 bis AK-10-35)
- [ ] Zustandsgalerie: alle Zustände aus Anhang A (Gruppen Tag, Work-Log, Notizen, Journal, Übersicht, Halt) in Hell und Dunkel
- [ ] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün
- [ ] Messung der Dateibeobachtung unter Windows, Ergebnis in `app/spec.md §18` (AO-12)

## Dokumentation und Status

- [ ] `app/README.md` ergänzt
- [ ] Klärungen in `docs/app/spec.md §19` eingetragen
- [ ] `docs/implementation/checklist.md`: Paketstatus aktualisiert
