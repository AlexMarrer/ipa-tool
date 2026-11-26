# Checkliste Paket 14 – App Projekte, System und Installer

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [x] Paket 13 im Code vorhanden, seine Tests grün — Paket 13 committet, seine Tests grün (26.11.2026)
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben — Git-Status vor Beginn sauber

## Implementierung

- [x] Assistent Schritt 1 mit Prüfliste und Fehlerzuständen (AK-10-69) — `wizard-system.test.ts` (echtes CLI: Git, Unterordner, schon eingerichtet auch bei anderer Schreibweise, Probedatei, nur lesendes Git), `wizard-system.test.tsx`, e2e
- [x] Assistent Schritt 2 (AK-10-70) — `wizard-system.test.tsx` (Suche, nur echte Namen, `.gitignore`-Hinweis mit Kopieren), `wizard-system.test.ts` (Eingabeprüfung der Zeitzone)
- [x] Assistent Schritt 3 und 4, `init`, Angebot Zeitplan (AK-10-71) — `wizard-system.test.ts` (Repository unverändert, Registry, `.ipa`, teilweise eingerichtetes Projekt), `wizard-system.test.tsx`, e2e; ein Fehler gefunden und behoben (Assistent sprang nach dem ersten Projekt auf Schritt 1)
- [x] System: Claude, Prüfen, Live-Test (AK-10-72) — `wizard-system.test.tsx` (zweistufig, „zwei kurze Testaufrufe“, gesperrt ohne bereites Claude und ohne Projekt), e2e
- [x] System: Git, Kostenschutz, Daten, Version (AK-10-73) — `wizard-system.test.tsx`, `wizard-system.test.ts` (Datenwurzel öffnen und kopieren ohne Pfad im Renderer)
- [x] System: Verbrauch (AK-10-74) — `wizard-system.test.ts` (alle Projekte, Zeiträume, `null`, kein Prompt), `wizard-system.test.tsx`
- [x] Installer mit CLI und `node.exe` (AK-10-75) — `staged-runtime.test.ts` (gestagtes CLI wie `npm pack`, `resources/` im entpackten Installer), `npm run app:dist` am 26.11.2026 (PowerShell), 140,3 MB
- [x] Zeitplan mit mitgelieferter Laufzeit (AK-10-77) — `staged-runtime.test.ts` (Pfade in der Aufgabe, `stale` mit `node_path` und `cli_path`, Ersatzprogramm für `schtasks`)
- [x] Versionsabgleich (AK-10-78) — `runner.test.ts`, `services.test.ts`, System › Version

## Integration

- [x] „Zeitplan einrichten“ aus dem Assistenten führt zur Seite Zeitplan und richtet nichts selbst ein — `wizard-system.test.tsx` (kein `run.start`)
- [x] „System öffnen“ und „Kostenschutz in der Konfiguration öffnen“ führen an die richtigen Stellen — `wizard-system.test.tsx`

## Tests

- [x] Komponenten- und Assistententests (AK-10-69 bis AK-10-74), Zustandsgalerie der Gruppen `Hinzufuegen` und `System` in Hell und Dunkel — `wizard-system.test.tsx` (29 Tests), `gallery.test.tsx` (Komponente `WizardStates`)
- [x] `npm test` des CLI mit der mitgelieferten `node.exe` grün (AK-10-76) — 732 bestanden, 2 umgebungsbedingte Fehlschläge wie mit der Node-Version des Entwicklungsrechners (`spec` §19)
- [x] Ende-zu-Ende mit Playwright (AK-10-79) — `full-flow.e2e.ts` (6 Tests: Assistent, System, Notiz, Erfassen mit Analyse, Journal mit und ohne KI, Lesen, Zeitplan-Vorschau, Konfiguration, Abbruch, Repository unverändert); App aus `out/` mit gestagtem CLI und `node.exe` (die gepackte App lässt sich wegen der Fuses nicht verbinden)
- [x] `npm run app:typecheck`, `npm run app:test`, `npm run app:dist` grün; Wurzel-`npm test` unverändert grün — alle drei grün am 26.11.2026 (`app:test` 37 Dateien, 608 Tests; 31 Playwright-Tests); Wurzel unverändert, Wurzel-`npm test` mit den zwei bekannten Fehlschlägen
- [x] Grösse des Installers gemessen und eingetragen (AO-02) — 140,3 MB (147 121 891 Bytes), eingetragen in `app/README.md`, Abnahmeprotokoll und `spec` §18
- [ ] **Manuell, vom Benutzer:** AK-10-80 (a) Zeitplan an der echten Aufgabenplanung (AK-09-17, AK-08-07), (b) Sichtprüfung aller 72 Artboards in Hell und Dunkel, (c) Bedienung per Tastatur, (d) Installer auf sauberem Windows 11 ohne Node; Ergebnis im Abnahmeprotokoll `docs/abnahme/app-abnahmeprotokoll.md` (Schritte vorbereitet, Ergebnisse offen)
- [ ] **Manuell, vom Benutzer:** Live-Test in System (zwei Claude-Aufrufe), Stichprobe

## Dokumentation und Status

- [x] `app/README.md` und Wurzel-`README.md` vollständig, ohne ungeprüfte Zusagen (AK-10-81) — Installation, Bau, Laufzeit, Grenzen, Kostenschutz, Zusammenhang Aufgabe und App; offene Prüfungen ausdrücklich genannt
- [x] Offene Punkte aus `app/spec.md §18` aktualisiert (AO-01, AO-03, AO-06, AO-07, AO-09) — AO-01, AO-03, AO-06, AO-08 mit Stand ergänzt; AO-07 und AO-09 unverändert (siehe §19)
- [x] Klärungen in `docs/app/spec.md §19` eingetragen — acht Einträge zu Paket 14
- [x] `docs/implementation/checklist.md`: Paketstatus aktualisiert — Paket 14 technisch abgeschlossen
