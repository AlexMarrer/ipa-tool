# Checkliste Paket 12 – App Aktionen

Einen Punkt erst abhaken, wenn er umgesetzt und geprüft ist. Den Nachweis (Test, Befehl oder Datum) hinter den Punkt schreiben. Die Kriterien stehen in `docs/app/spec.md §16`.

## Voraussetzungen

- [ ] Paket 11 im Code vorhanden, seine Tests grün
- [ ] Git-Status geprüft, keine fremden Änderungen überschrieben

## Implementierung

- [ ] Laufanzeige in allen Zuständen (AK-10-36)
- [ ] Live-Ausgabe aus Dateiereignissen (AK-10-37)
- [ ] Jetzt erfassen, Nur aufnehmen, Exit-Codes in Klartext (AK-10-38)
- [ ] Sperren in der Oberfläche, fremde Läufe (AK-10-39)
- [ ] Journal erzeugen, Journal-Fehler (AK-10-40)
- [ ] Dialog Erneut versuchen (AK-10-41)
- [ ] Dialog Überspringen (AK-10-42)
- [ ] Dialog Ausgangspunkt (AK-10-43)
- [ ] Grund-Prüfung ohne Preisgabe von Werten (AK-10-44)
- [ ] Notiz-Dialog Standard und Typen (AK-10-45)
- [ ] Notiz-Dialog Zusatzfelder und Zeit (AK-10-46)
- [ ] Belege-Auswahl (AK-10-47)
- [ ] Notiz speichern mit Bestätigung und Secret-Hinweis (AK-10-48)
- [ ] Prüfen in Übersicht und Kopf (AK-10-49)
- [ ] KI-Markierung an genau den richtigen Buttons (AK-10-50)
- [ ] Abbrechen-Fluss (AK-10-51)

## Integration

- [ ] Aktionen sind an Work-Logs, Journal, Halt-Banner, Kopfzeile und `Strg+N` angeschlossen
- [ ] Nichts startet Claude von selbst, Aufrufprotokoll (AK-10-15)

## Tests

- [ ] Runner-, Sperren-, Abbruch- und Komponententests (AK-10-36 bis AK-10-51)
- [ ] Zustandsgalerie: alle Zustände der Gruppen `Lauf`, `Dialoge`, `Notiz-Dialog`, `Journal-Fehler` in Hell und Dunkel
- [ ] Notiztext-Grenze unter Windows geprüft, Wert in `app/spec.md §8.8` und `§18` nachgeführt (AO-10)
- [ ] `npm run app:typecheck`, `npm run app:test`, `npm run app:build` grün; Wurzel-`npm test` unverändert grün
- [ ] **Manuell, vom Benutzer:** ein echter Lauf mit Claude aus der App (Jetzt erfassen und Journal erzeugen) mit Stichprobe der Anzeige; verbraucht Kontingent, Freigabe liegt beim Benutzer

## Dokumentation und Status

- [ ] `app/README.md` ergänzt
- [ ] Klärungen in `docs/app/spec.md §19` eingetragen
- [ ] `docs/implementation/checklist.md`: Paketstatus aktualisiert
