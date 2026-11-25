# IPA Assistant

Lokales Kommandozeilenwerkzeug `ipa` (Node 24, TypeScript, ESM) für die IPA: sichert den Arbeitsstand eines Git-Repositorys in Snapshots, lässt Claude Code daraus belegte Work-Logs und Journal-Entwürfe erstellen und nimmt Notizen auf. Dazu entsteht eine Windows-Desktop-App (Electron) im Ordner `app/`, die das CLI im Hintergrund startet.

## Wo was steht

- `README.md`: Befehle, Datenablage, Kostenschutz
- `docs/implementation/README.md` und `checklist.md`: Pakete und Stand. Jedes Paket hat `spec.md`, `checklist.md` und `prompt.md` unter `docs/implementation/packages/`.
- `docs/implementation/spec.md`: Verträge des CLI (nur dort ändern)
- `docs/app/spec.md`: Spezifikation der App (nur dort ändern), `docs/app/design-brief.md`: Hintergrund zum Design
- `schemas/`: JSON-Schemas der Dateien und der `--json`-Ausgabe

## Arbeitsweise

- Ein neuer Auftrag beginnt mit dem `prompt.md` des Pakets. Lies zuerst, was dort steht, und halte den Fortschritt in der `checklist.md` fest.
- Sprache: Dokumente und Meldungen des CLI auf Deutsch in Schweizer Rechtschreibung (`ss`, kein `ß`). Code-Kommentare auf Englisch und nur, wo nötig.
- `npm run typecheck`, `npm run build` und `npm test` im Wurzelordner müssen grün sein. Die vollständige Testsuite dauert lange, laufe vorher die betroffenen Testdateien einzeln.
- Tests mit echtem Claude (`npm run test:live`) verbrauchen Kontingent: vorbereiten, aber nur der Benutzer führt sie aus.
- Nichts committen, pushen oder als Pull Request öffnen, ausser der Benutzer bittet darum.
- Das untersuchte Repository und der Arbeitsbereich von Benutzern werden nie verändert. Keine Zugangsdaten in Dateien, Ausgaben oder Tests.
