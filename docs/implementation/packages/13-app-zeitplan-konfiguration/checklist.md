# Checkliste Paket 13 – App Zeitplan und Konfiguration

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [x] Paket 12 im Code vorhanden, seine Tests grün — Paket 12 committet, seine Tests grün (26.11.2026)
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben — Git-Status vor Beginn sauber

## Implementierung

- [x] Zeitplan-Karte mit fünf Zuständen (AK-10-52) — `schedule.test.tsx` (fünf Zustände, Abweichungen, `unbekannt`, Aufgaben-ID, Hauptaktion), Galerie `Zeitplan: Zustände`
- [x] Zeitplan-Formular mit Validierung (AK-10-53) — `schedule.test.tsx`, `config-draft.test.ts` (alle Fehlertexte des Designs)
- [x] Vorschau aus `config set --dry-run` (AK-10-54) — `schedule.test.tsx` (entprellt, 7 Läufe und 35 Aufrufe, Lauf auf `windowEnd`, Warnungen, „Keine Startzeiten“), `schedule-config.test.ts` (Datei unverändert, echtes CLI)
- [x] Zeitplan-Aktionen und Lösch-Dialog (AK-10-55) — `schedule.test.tsx`, `schedule-config.test.ts` und e2e `schedule-config.e2e.ts` mit Ersatzprogramm für `schtasks` (Aufrufprotokoll geprüft)
- [x] Zusammenspiel Konfiguration und Zeitplan, `stale` (AK-10-56) — `schedule-config.test.ts` (veraltet nach `schedule` und `limits.maxRunSeconds`, pausiert bleibt pausiert), e2e
- [x] Lauf-Verlauf (AK-10-57) — `schedule.test.tsx`, `schedule-config.test.ts`
- [x] Konfiguration: Navigation, Speichern-Leiste, Prüfung (AK-10-58) — `config.test.tsx`, `schedule-config.test.ts`
- [x] Gruppe Claude (AK-10-59) — `config.test.tsx`
- [x] Gruppe Kostenschutz mit zweistufiger Bestätigung (AK-10-60) — `config.test.tsx`, `schedule-config.test.ts` (ohne Flag Exit-Code 2, Datei unverändert), e2e
- [x] Gruppe Dateifilter und Pfad testen (AK-10-61) — `config.test.tsx`, `schedule-config.test.ts` (Vergleich mit den `filterDecisions` einer echten Erfassung), e2e
- [x] Gruppe Secrets (AK-10-62) — `config.test.tsx`
- [x] Gruppe Kontext (AK-10-63) — `config.test.tsx`
- [x] Gruppe Limits (AK-10-64) — `config.test.tsx`, `config-draft.test.ts` (Umrechnung ohne Rundungsfehler)
- [x] Gruppe Info (AK-10-65) — `config.test.tsx`, `ipc.test.ts` (Felder nach `init` gar nicht erst zugelassen)
- [x] Gruppe Zeitplan als Verweis (AK-10-66) — `config.test.tsx`
- [x] Konkurrierende Änderungen (AK-10-67) — `config.test.tsx`, e2e (Änderung von Hand bei offenen Änderungen)
- [x] `config.json` nur über `config set` geschrieben, übrige Felder byte-genau erhalten (AK-10-68) — `schedule-config.test.ts` (Dateivergleich), e2e; kein Schreibzugriff der App auf `config.json` im Code

## Integration

- [x] Sprung „Zur Konfiguration“ aus dem Work-Log bei `blocked` führt zu Gruppe Limits (AK-10-25) — `config.test.tsx` (`openConfig('limits')`), `WorkLogsTab`
- [x] Zeitplan-Kurzstatus in der Übersicht liest dieselbe Quelle (AK-10-31) — Übersicht und Seite nutzen beide `schedule status --json`
- [x] Aufruf und Sperren nutzen Laufanzeige und Bestätigungsdialoge aus Paket 12 — Jetzt auslösen nutzt `actionReason`, `startRun` und `ConfirmDialog`

## Tests

- [x] Befehls-, Komponenten- und Vergleichstests (AK-10-52 bis AK-10-68), alle `schtasks`-Aufrufe über Ersatz-Runner — `app:test`: 34 Dateien, 556 Tests bestanden; e2e mit Ersatzprogramm bestanden
- [x] Zustandsgalerie: alle Zustände der Gruppen `Zeitplan` und `Konfiguration` in Hell und Dunkel — `gallery.test.tsx`, Komponente `ConfigStates`
- [x] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün — alle drei grün am 26.11.2026; die Wurzel ist unverändert (Typprüfung und Build grün), Wurzel-`npm test` mit den zwei bekannten umgebungsbedingten Fehlschlägen
- [ ] **Manuell, vom Benutzer:** Zeitplan-Seite an der echten Windows-Aufgabenplanung (einrichten, pausieren, fortsetzen, auslösen, aktualisieren, löschen), zusammen mit AK-09-17 und AK-08-07; Ergebnis hier und im Abnahmeprotokoll

## Dokumentation und Status

- [x] `app/README.md` ergänzt — Stand, Tests, Testhaken
- [x] Klärungen in `docs/app/spec.md §19` eingetragen — sieben Einträge zu Paket 13
- [x] `docs/implementation/checklist.md`: Paketstatus aktualisiert — Paket 13 technisch abgeschlossen
