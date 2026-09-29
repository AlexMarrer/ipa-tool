# Checkliste Paket 08 – Zeitsteuerung und Abnahme

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben.

## Voraussetzungen

- [ ] Die Pakete 06 und 07 sind im Code vorhanden, und ihre Tests laufen grün.
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben.

## Implementierung

- [ ] Fensterprüfung für `capture --scheduled` in der konfigurierten Zeitzone (AK-08-01, AK-08-02, AK-08-03)
- [ ] `deadline` aus `limits.maxRunSeconds` an `processQueue` übergeben (AK-08-06)
- [ ] Generator für die Windows-Aufgabenplanung (XML) (AK-08-04)
- [ ] cron-Generator, als ungeprüft gekennzeichnet (AK-08-05)

## Integration

- [ ] `ipa capture --scheduled` angebunden (AK-08-01, AK-08-02)
- [ ] `ipa schedule --os <windows|cron> [--output]` angebunden (AK-08-04, AK-08-10)

## Tests

- [ ] Unit-Tests: Fenster mit `TZ`-Variation, XML-Struktur und Escaping, cron-Zeile
- [ ] Integrationstests AK-08-01 bis AK-08-06 und AK-08-10 grün
- [ ] `npm run typecheck`, `npm test` und `npm run build` grün
- [ ] Manuell: Aufgabe unter Windows 11 importiert, ausgelöst und auf Überschneidung geprüft (AK-08-07)
- [ ] Manuell nach Freigabe: alle Abnahmefälle live durchgeführt (AK-08-08)

## Dokumentation und Status

- [ ] `docs/abnahme/v1-abnahmeprotokoll.md` vollständig ausgefüllt (AK-08-07, AK-08-08)
- [ ] README vollständig und ohne überhöhte Zusagen (AK-08-09)
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert, Abnahmematrix abgehakt, soweit nachgewiesen
