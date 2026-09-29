# Paket 04 – Notizen

Verbindliche Grundlage ist `docs/implementation/spec.md`. Dieses Dokument verweist mit `spec.md §…` auf die gemeinsamen Verträge und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

`ipa note` erfasst in weniger als einer Minute Tätigkeiten, Probleme, Entscheidungen, Erkenntnisse und Planungen. Zeitangaben sind ausdrücklich als gemessen oder geschätzt gekennzeichnet. Notizen werden pro Tätigkeitstag als JSONL gespeichert und stehen über `readNotes` für Analyse und Journal bereit. Der Befehl funktioniert unabhängig von Snapshots und Claude und blockiert nicht, während ein `capture` läuft.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/notes/` mit `addNote` und `readNotes` (spec.md §10)
- Schema `note` (§9.5)
- Befehl `ipa note` mit allen Optionen aus spec.md §6.3, direkt und interaktiv
- Prüfung von Notizen mit dem `SecretScanner` aus Paket 02: Warnung und Kennzeichnung `secretSuspected`
- Feld `notesToday` in `ipa status`
- README-Abschnitt „Notizen“ mit Beispielen aus Konzept §6.3 und §6.4

Nicht im Umfang:

- Einbindung der Notizen in Analyse (Paket 06) und Journal (Paket 07)
- Bearbeiten oder Löschen von Notizen. In V1 geschieht das manuell in der JSONL-Datei, und `readNotes` meldet ungültige Zeilen.
- Eigener Befehl `ipa decision`

## 3. Voraussetzungen und abhängige Pakete

- Paket 01 ist abgeschlossen.
- Paket 02 ist abgeschlossen, wegen `SecretScanner` und Manifest-Lesen für `--ref`.
- Paket 03 ist nicht erforderlich.

## 4. Zu implementierendes Verhalten

**Direkte Eingabe**: `ipa note "<text>" [optionen]`

| Option | Regel |
| --- | --- |
| `--type` | Standard `general`. Andere Werte als die sechs Typen ergeben Exit-Code 2. |
| `--day` | Standard ist der heutige Tag in der konfigurierten Zeitzone. Ungültiges Format ergibt Exit-Code 2. Ein Tag in der Zukunft ist nur mit `--type plan` erlaubt. |
| `--minutes <n>` | Ganze Zahl > 0 und nur zusammen mit `--measured` oder `--estimated` (D-13). Fehlt die Angabe oder kommen beide vor, ergibt das Exit-Code 2. |
| `--start <HH:MM> --end <HH:MM>` | Nur beide zusammen. Die Minuten werden berechnet. `end ≤ start` ergibt Exit-Code 2. `--minutes` darf nicht zusätzlich angegeben werden. |
| `--delay <n>` | Ganze Zahl > 0. Verwendet dieselbe Basis `--measured` oder `--estimated`, die dann Pflicht ist. Die Verzögerung wird separat gespeichert und nie zur Zeit addiert (I-07). |
| `--reason`, `--alternative` | Nur bei `--type decision`, sonst Exit-Code 2. Ohne `--reason` wird `reason: null` gespeichert (Grund unbekannt). |
| `--cause`, `--solution` | Nur bei `--type problem`, sonst Exit-Code 2. |
| `--ref` | Qualifizierter Beleg (§8.2). Existieren Snapshot oder Beleg-ID nicht, ergibt das Exit-Code 2. |

**Interaktive Eingabe**: `ipa note` ohne Text

- Nur mit TTY auf stdin und stdout. Ohne TTY ergibt das Exit-Code 2 mit Hinweis auf die direkte Eingabe.
- Fragen in dieser Reihenfolge, Enter übernimmt jeweils den Standardwert:
  1. Typ (Standard `general`)
  2. Text (Pflicht)
  3. je nach Typ Grund und Alternativen beziehungsweise Ursache und Lösung
  4. Zeitaufwand in Minuten (leer bedeutet keine Angabe)
  5. falls eine Zeit angegeben wurde: gemessen oder geschätzt (Pflicht)
- Die Eingabeströme sind für Tests injizierbar.

**Speicherung**

- Die Notiz erhält eine `noteId`, `recordedAt` und `activityDay`.
- Sie wird mit `appendJsonl` nach `notes/<activityDay>.jsonl` geschrieben, ohne Lock (D-16).
- Die Ausgabe nennt `noteId`, Tag und Typ, aber nicht den Text.

**Secret-Verdacht**

- Der gesamte Text wird geprüft, ebenso `reason`, `alternatives`, `cause` und `solution`.
- Bei einem Treffer wird die Notiz mit `secretSuspected: true` gespeichert.
- Auf stderr erscheint eine Warnung mit dem Detektornamen, aber ohne Wert. Die Notiz wird nie an Claude übermittelt.

**Lesen**

- `readNotes` filtert nach Tag, `recordedAt`-Intervall oder `refs` auf einen Snapshot.
- Ungültige Zeilen werden gemeldet und übersprungen.
- Die Sortierung erfolgt nach `recordedAt` und dann nach `id`.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu:
  - `src/notes/`
  - `schemas/note.schema.json`
- Erweitert: `src/cli/` (`note`, `status`)
- Schnittstellen: `addNote`, `readNotes` und `NoteInput` (spec.md §10), Notizmodell (§9.5)

## 6. Fehler- und Randfälle

- Text mit Anführungszeichen, Semikolon und Umlauten, auch in einer Windows-Konsole
- Leerer Text oder nur Leerzeichen: Exit-Code 2
- Notiz um 23:59 Uhr in `Europe/Zurich` bei UTC-Systemzeit: Der Tätigkeitstag ist der lokale Tag.
- Gleichzeitig laufender `capture`, der den Lock hält: `note` gelingt trotzdem.
- Nicht initialisiertes Repository: Exit-Code 2.
- Zeile in der JSONL-Datei von Hand beschädigt: Die übrigen Notizen bleiben lesbar.
- `--ref` auf einen Snapshot, der existiert, aber eine unbekannte Beleg-ID enthält: Exit-Code 2.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-04-01 | `ipa note "Text"` speichert eine schemagültige Notiz vom Typ `general`. `activityDay` entspricht dem heutigen Tag in der Zeitzone, `recordedAt` hat einen Offset. Die Ausgabe enthält die `noteId`, aber nicht den Text. |
| AK-04-02 | `ipa note --type decision --reason "…" --alternative A --alternative B "…"` speichert Grund und beide Alternativen. Ohne `--reason` wird `reason: null` gespeichert. `--reason` bei `--type activity` ergibt Exit-Code 2. |
| AK-04-03 | `--minutes 45 --measured` speichert `time.basis = measured`. `--minutes 45` ohne Basis ergibt Exit-Code 2. `--start 09:10 --end 09:55 --estimated` ergibt 45 Minuten. `end ≤ start` und `--minutes 0` ergeben Exit-Code 2. |
| AK-04-04 | `--delay 20 --estimated` speichert `delay` getrennt von `time`. |
| AK-04-05 | `--day` mit vergangenem Datum wird gespeichert. Ein zukünftiges Datum ist nur bei `--type plan` erlaubt, sonst Exit-Code 2. |
| AK-04-06 | Die interaktive Eingabe mit injizierten Strömen erzeugt dieselbe Notiz wie die direkte Eingabe. Ohne TTY und ohne Text ergibt das Exit-Code 2. |
| AK-04-07 | `--ref S000001:E001` wird gegen das Manifest geprüft. Unbekannte Referenzen ergeben Exit-Code 2. |
| AK-04-08 | Eine Notiz mit künstlichem Secret wird mit `secretSuspected: true` gespeichert. Die Warnung nennt den Detektor, stdout und stderr enthalten den Marker nicht. |
| AK-04-09 | Hält ein anderer Prozess den Lock, gelingt `ipa note` trotzdem. |
| AK-04-10 | `readNotes` liefert nach Tag, Zeitintervall und Snapshot-Referenz die richtigen Notizen und meldet eine beschädigte Zeile, ohne die anderen zu verlieren. |
| AK-04-11 | `ipa status --json` enthält `notesToday`. `ipa --help` listet `note`. Der Repository-Fingerprint bleibt unverändert. |

## 8. Notwendige Tests und Validierung

- Unit-Tests: Optionsprüfung (alle Kombinationen aus Abschnitt 4), Zeitberechnung, Tätigkeitstag bei injizierter Uhr, Filter von `readNotes`
- Integrationstests über den CLI-Einstieg: AK-04-01 bis AK-04-11
- Manuelle Prüfung: interaktive Eingabe in der Windows-Konsole und Messung der Dauer einer typischen Notiz. Zielwert unter einer Minute, das Ergebnis wird in der Checkliste vermerkt.

## 9. Offene Annahmen

Keine.
