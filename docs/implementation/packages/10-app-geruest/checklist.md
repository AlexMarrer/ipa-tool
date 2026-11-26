# Checkliste Paket 10 – App-Gerüst

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`. Prüfdatum, wo nicht anders genannt: 26.11.2026, Windows 11, Node.js 24.20.0, Git 2.52.

## Voraussetzungen

- [ ] Paket 09 im Code vorhanden, `npm run typecheck` und `npm test` im Wurzelordner grün. `typecheck` und `build` grün; `npm test`: 732 bestanden, 2 fehlgeschlagen, 2 übersprungen. Die zwei Fehler sind umgebungsabhängig (Systemzeitzone `Europe/Berlin` statt `Europe/Zurich`, `planSchedule` rechnet dann vorsichtig), bestanden schon vor jeder Änderung dieses Pakets und liegen im CLI, siehe `docs/app/spec.md §19`. Bewusst nicht abgehakt.
- [x] Git-Status geprüft, keine fremden Änderungen überschrieben. Vor Beginn sauberer Stand auf `main`, Arbeit auf `feature/app-paket-10-geruest`; im Wurzelordner geändert sind nur `package.json` (Skripte), `.gitignore`, `README.md` und die Dokumentation.
- [x] Versionen festgelegt und in `app/README.md` begründet: Electron 45.5.0 (exakt), TypeScript 7.0.2 (AO-04 geklärt), `electron-builder` 26.18.0 (Schlüssel gegen das Schema geprüft, AO-07 teilweise)

## Implementierung

- [x] CLI unberührt, Wurzel-Skripte `app:*`, `.gitignore`, `app/` mit eigenem Lock (AK-10-01, AK-10-02). `test/unit/build.test.ts` (inkl. `npm pack --dry-run`: keine Datei unter `app/`); `npm run typecheck` und `npm run build` im Wurzelordner grün. `npm ci` und `npm install --global .` wurden nicht ausgeführt.
- [x] Hauptfenster und Sicherheitseinstellungen, CSP, Protokoll `app://`, Fuses, eine Instanz (AK-10-03). `test/unit/security.test.ts`, `test/e2e/app.e2e.ts` (echte `getLastWebPreferences`, CSP-Kopf, Navigation, neue Fenster, zweite Instanz). Fuses: Konfiguration getestet, Anwendung erst beim Paketieren (Paket 14).
- [x] Preload und IPC mit Prüfung von Absender und Eingabe (AK-10-04). `test/unit/ipc.test.ts`, `test/unit/preload.test.ts`, Start-Test (`window.ipa`, kein `process`/`require`)
- [x] `resolveRuntime` für Entwicklung, Test und installiert (AK-10-05). `test/unit/runtime.test.ts`
- [x] CLI-Runner mit Hüllenprüfung, Fehlerklassen, Versionsabgleich (AK-10-06). `test/unit/runner.test.ts` (echtes CLI mit Leerzeichen und Umlauten im Pfad, Stand-in-CLI für Fehlerklassen), `test/unit/commands.test.ts`
- [x] Sperren pro Projekt, fremder Lauf aus `lock` (AK-10-07). `test/unit/queue.test.ts`
- [x] Abbruch des Prozessbaums, Wiederanlauf ohne Doppel (AK-10-08). `test/unit/cancel.test.ts` (echtes CLI, hängender Fake-Claude, `taskkill /T /F`, danach zweiter Lauf ohne Doppel)
- [x] Projektliste aus der Registry, Fehlerfälle (AK-10-09). `test/reader/registry.test.ts`, `test/unit/services.test.ts`, `test/components/shell.test.tsx`
- [x] Layout, Navigation, Tastenkürzel (AK-10-10). `test/components/shell.test.tsx`. `Strg+N` setzt vorerst nur einen Zähler (Paket 12 öffnet den Dialog).
- [x] Tokens Hell und Dunkel, Theme folgt Windows, Kontrastprüfung (AK-10-11). `test/unit/contrast.test.ts`, `test/components/theme.test.tsx`, Start-Test (Wechsel über `nativeTheme`). Sichtprüfung gegen die Artboards steht aus (AK-10-80, manuell).
- [x] Basiskomponenten und Zustandsgalerie (AK-10-12). `test/components/components.test.tsx`, `test/components/gallery.test.tsx`
- [x] Lade-, Leer- und Fehlerzustände (AK-10-13). `components.test.tsx` (Skelett erst nach 150 ms, Leerzustand, Fehlerrand), `shell.test.tsx`
- [x] `app-state.json` (AK-10-14). `test/unit/app-state.test.ts`, Start-Test
- [x] Nichts startet Claude von selbst, Aufrufprotokoll (AK-10-15). `queue.test.ts`, `services.test.ts`, Start-Test (Navigation durch alle Seiten, Dateiänderungen im Arbeitsbereich; `FAKE_CLAUDE_LOG` ohne Modellaufruf, Protokoll nur `status`/`auto`)

## Integration

- [x] `npm run app:dev`, `app:build`, `app:typecheck`, `app:test` laufen vom Wurzelordner aus. `app:build`, `app:typecheck` (über `npm run typecheck --prefix app`) und `app:test` gelaufen; `app:dev` startete die App (Dev-Server, Fenster, `app-state.json`) mit temporären Datenordnern.
- [x] `stage-cli` und `fetch-node` laufen und prüfen die Prüfsumme (Vorbereitung für Paket 14). `stage-cli` real ausgeführt (`app/stage/cli`, `--version` 0.1.0). `fetch-node`: Prüfsumme und Abbruch bei Abweichung getestet (`test/unit/build.test.ts`); der echte Download der `node.exe` wurde nicht ausgeführt.

## Tests

- [x] Unit- und Komponententests (AK-10-01 bis AK-10-15). `npm run app:test`: 20 Dateien, 264 Tests bestanden (zuletzt vor dieser Änderung 263, plus der Test der Galerie-Route)
- [x] Start-Test mit Playwright. `npm run test:e2e --prefix app`: 7 Tests bestanden
- [x] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert. Die ersten drei grün; Wurzel-`npm test` mit denselben zwei umgebungsbedingten Fehlschlägen wie vor Beginn (siehe oben), sonst unverändert.

## Dokumentation und Status

- [x] `app/README.md` und Hinweis im Wurzel-`README.md` (AK-10-16)
- [x] Klärungen in `docs/app/spec.md §19` eingetragen (Befund der Wurzel-Tests, AO-04, AO-07, Preload als CommonJS, tsconfig, IPC-Teilmenge, Testhaken, Fehler beim Beenden, gesperrte Aktionen, Playwright-Theme)
- [x] `docs/implementation/checklist.md`: Paketstatus aktualisiert

## Offen für den Benutzer

- Manuelle Sichtprüfung der Hell- und Dunkel-Ansicht gegen die Artboards (AK-10-80) und Tastaturbedienung per Hand.
- Entscheidung, ob die zwei umgebungsbedingten CLI-Tests (Systemzeitzone) im CLI-Paket korrigiert werden.
