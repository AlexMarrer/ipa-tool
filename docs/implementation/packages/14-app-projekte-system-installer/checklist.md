# Checkliste Paket 14 – App Projekte, System und Installer

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [ ] Paket 13 im Code vorhanden, seine Tests grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Assistent Schritt 1 mit Prüfliste und Fehlerzuständen (AK-10-69)
- [ ] Assistent Schritt 2 (AK-10-70)
- [ ] Assistent Schritt 3 und 4, `init`, Angebot Zeitplan (AK-10-71)
- [ ] System: Claude, Prüfen, Live-Test (AK-10-72)
- [ ] System: Git, Kostenschutz, Daten, Version (AK-10-73)
- [ ] System: Verbrauch (AK-10-74)
- [ ] Installer mit CLI und `node.exe` (AK-10-75)
- [ ] Zeitplan mit mitgelieferter Laufzeit (AK-10-77)
- [ ] Versionsabgleich (AK-10-78)

## Integration

- [ ] „Zeitplan einrichten“ aus dem Assistenten führt zur Seite Zeitplan und richtet nichts selbst ein
- [ ] „System öffnen“ und „Kostenschutz in der Konfiguration öffnen“ führen an die richtigen Stellen

## Tests

- [ ] Komponenten- und Assistententests (AK-10-69 bis AK-10-74), Zustandsgalerie der Gruppen `Hinzufuegen` und `System` in Hell und Dunkel
- [ ] `npm test` des CLI mit der mitgelieferten `node.exe` grün (AK-10-76)
- [ ] Ende-zu-Ende mit Playwright (AK-10-79)
- [ ] `npm run app:typecheck`, `npm run app:test`, `npm run app:dist` grün; Wurzel-`npm test` unverändert grün
- [ ] Grösse des Installers gemessen und eingetragen (AO-02)
- [ ] **Manuell, vom Benutzer:** AK-10-80 (a) Zeitplan an der echten Aufgabenplanung (AK-09-17, AK-08-07), (b) Sichtprüfung aller 72 Artboards in Hell und Dunkel, (c) Bedienung per Tastatur, (d) Installer auf sauberem Windows 11 ohne Node; Ergebnis im Abnahmeprotokoll `docs/abnahme/app-abnahmeprotokoll.md`
- [ ] **Manuell, vom Benutzer:** Live-Test in System (zwei Claude-Aufrufe), Stichprobe

## Dokumentation und Status

- [ ] `app/README.md` und Wurzel-`README.md` vollständig, ohne ungeprüfte Zusagen (AK-10-81)
- [ ] Offene Punkte aus `app/spec.md §18` aktualisiert (AO-01, AO-03, AO-06, AO-07, AO-09)
- [ ] Klärungen in `docs/app/spec.md §19` eingetragen
- [ ] `docs/implementation/checklist.md`: Paketstatus aktualisiert
