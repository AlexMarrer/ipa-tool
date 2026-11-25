# Checkliste Paket 13 – App Zeitplan und Konfiguration

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [ ] Paket 12 im Code vorhanden, seine Tests grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Zeitplan-Karte mit fünf Zuständen (AK-10-52)
- [ ] Zeitplan-Formular mit Validierung (AK-10-53)
- [ ] Vorschau aus `config set --dry-run` (AK-10-54)
- [ ] Zeitplan-Aktionen und Lösch-Dialog (AK-10-55)
- [ ] Zusammenspiel Konfiguration und Zeitplan, `stale` (AK-10-56)
- [ ] Lauf-Verlauf (AK-10-57)
- [ ] Konfiguration: Navigation, Speichern-Leiste, Prüfung (AK-10-58)
- [ ] Gruppe Claude (AK-10-59)
- [ ] Gruppe Kostenschutz mit zweistufiger Bestätigung (AK-10-60)
- [ ] Gruppe Dateifilter und Pfad testen (AK-10-61)
- [ ] Gruppe Secrets (AK-10-62)
- [ ] Gruppe Kontext (AK-10-63)
- [ ] Gruppe Limits (AK-10-64)
- [ ] Gruppe Info (AK-10-65)
- [ ] Gruppe Zeitplan als Verweis (AK-10-66)
- [ ] Konkurrierende Änderungen (AK-10-67)
- [ ] `config.json` nur über `config set` geschrieben, übrige Felder byte-genau erhalten (AK-10-68)

## Integration

- [ ] Sprung „Zur Konfiguration“ aus dem Work-Log bei `blocked` führt zu Gruppe Limits (AK-10-25)
- [ ] Zeitplan-Kurzstatus in der Übersicht liest dieselbe Quelle (AK-10-31)
- [ ] Aufruf und Sperren nutzen Laufanzeige und Bestätigungsdialoge aus Paket 12

## Tests

- [ ] Befehls-, Komponenten- und Vergleichstests (AK-10-52 bis AK-10-68), alle `schtasks`-Aufrufe über Ersatz-Runner
- [ ] Zustandsgalerie: alle Zustände der Gruppen `Zeitplan` und `Konfiguration` in Hell und Dunkel
- [ ] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün
- [ ] **Manuell, vom Benutzer:** Zeitplan-Seite an der echten Windows-Aufgabenplanung (einrichten, pausieren, fortsetzen, auslösen, aktualisieren, löschen), zusammen mit AK-09-17 und AK-08-07; Ergebnis hier und im Abnahmeprotokoll

## Dokumentation und Status

- [ ] `app/README.md` ergänzt
- [ ] Klärungen in `docs/app/spec.md §19` eingetragen
- [ ] `docs/implementation/checklist.md`: Paketstatus aktualisiert
