# Checkliste Paket 05 – Claude-Anbindung

Einen Punkt erst abhaken, wenn die Arbeit umgesetzt und geprüft ist. Hinter den Punkt den Nachweis schreiben, zum Beispiel Test, Befehl oder Datum.

## Voraussetzungen

- [ ] Pakete 01 und 02 sind im Code vorhanden, und ihre Tests sind grün.
- [ ] Git-Status ist geprüft, keine fremden Änderungen wurden überschrieben.

## Implementierung

- [ ] Argumentbildung gemäss spec.md §13.1, temporäres Claude-Arbeitsverzeichnis gemäss D-22 und Start ohne Shell (AK-05-01)
- [ ] Bedingte Übergabe von `--setting-sources project,local` (AK-05-11)
- [ ] Auswertung des Umschlags und Fehlerklassen gemäss spec.md §13.3, mit Timeout (AK-05-02, AK-05-03)
- [ ] Protokoll `ai-usage.jsonl` mit Schema (AK-05-04)
- [ ] Hilfsfunktion zur Schemaprüfung (AK-05-08)
- [ ] `probeClaude`: Version, Auth-Filter, Flag-Prüfung, `doctor.json` (AK-05-05, AK-05-06)
- [ ] `--live`-Prüfung über das stream-json-Init-Ereignis (AK-05-09)
- [ ] `ensureClaudeReady` für die Pakete 06 und 07
- [ ] Schemas `ai-usage`, `doctor` und `attempt-outcome`

## Integration

- [ ] `ipa doctor [--live]` angebunden (AK-05-05, AK-05-10)
- [ ] `ipa init` führt `doctor` ohne `--live` aus, ein Fehler ergibt nur eine Warnung (AK-05-07)
- [ ] `ipa status` zeigt das Feld `claude` (AK-05-10)
- [ ] Vorabprüfungsskript aus Paket 01 entfernt, README verweist auf `ipa doctor --live` (AK-05-10)

## Tests

- [ ] `test/helpers/fake-claude.mjs` mit allen Modi
- [ ] Unit- und Integrationstests AK-05-01 bis AK-05-08, AK-05-10 und AK-05-11 sind grün
- [ ] `npm run typecheck`, `npm test` und `npm run build` sind grün
- [ ] Skript `npm run test:live` ist vorhanden und nicht Teil von `npm test`
- [ ] Manuell nach Freigabe: `ipa doctor --live` mit installierter Version (Version, Datum, Ergebnis) (AK-05-09)
- [ ] Annahmen A-01 bis A-05, A-07 und A-08 in spec.md §18 als bestätigt oder widerlegt eingetragen

## Dokumentation und Status

- [ ] README: Voraussetzungen für Claude, `doctor`, Schutzwirkung und Grenzen gemäss spec.md §13.4
- [ ] Abweichungen in spec.md §18 eingetragen oder „keine“ bestätigt
- [ ] Zentrale `docs/implementation/checklist.md` aktualisiert
