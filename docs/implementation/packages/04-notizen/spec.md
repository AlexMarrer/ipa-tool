# Paket 04 – Notizen

Die verbindliche Grundlage ist `docs/implementation/spec.md`. Dieses Dokument verweist mit `spec.md §…` auf die gemeinsamen Verträge und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

`ipa note` erfasst in weniger als einer Minute Tätigkeiten, Probleme, Entscheidungen, Erkenntnisse und Planungen. Zeitangaben sind immer ausdrücklich als gemessen oder geschätzt gekennzeichnet. Notizen werden pro Tätigkeitstag als JSONL gespeichert und stehen über `readNotes` für Analyse und Journal bereit.

Der Befehl funktioniert bereits nach Paket 01, also ohne Snapshots und ohne Claude (D-23). Er blockiert nicht, während ein `capture` läuft.

## 2. Umfang und Abgrenzung

Im Umfang:

- `src/notes/` mit `addNote` und `readNotes` (spec.md §10), abhängig nur von `core`
- Schema `note` (§9.5)
- Befehl `ipa note` mit allen Optionen aus spec.md §6.3, direkt und interaktiv
- Syntaxprüfung von `--ref` gegen das Muster für qualifizierte Belege (§8.2)
- Feld `notesToday` in `ipa status`
- README-Abschnitt „Notizen“ mit Beispielen aus Konzept §6.3 und §6.4

Nicht im Umfang:

- Prüfung, ob der Beleg einer `--ref` existiert, und Secret-Warnung bei der Eingabe. Beides ergänzt Paket 06 (D-23).
- Secret-Prüfung vor der Übermittlung (Pakete 06 und 07, spec.md §12.2)
- Einbindung der Notizen in Analyse und Journal (Pakete 06 und 07)
- Bearbeiten oder Löschen von Notizen. In V1 geschieht das manuell in der JSONL-Datei. `readNotes` meldet dabei entstandene ungültige Zeilen.
- Eigener Befehl `ipa decision`

## 3. Voraussetzungen und abhängige Pakete

- Paket 01 ist abgeschlossen.
- Weitere Pakete sind nicht erforderlich. Paket 04 kann direkt nach Paket 01 umgesetzt werden.

## 4. Zu implementierendes Verhalten

**Direkte Eingabe**: `ipa note "<text>" [optionen]`

| Option | Regel |
| --- | --- |
| `--type` | Standard `general`. Andere Werte als die sechs Typen führen zu Exit-Code 2. |
| `--day` | Standard ist der heutige Tag in der konfigurierten Zeitzone. Ein ungültiges Format führt zu Exit-Code 2. Ein Tag in der Zukunft ist nur mit `--type plan` erlaubt. |
| `--minutes <n>` | Ganze Zahl > 0, nur zusammen mit `--measured` oder `--estimated` (D-13). Fehlt die Angabe oder stehen beide, folgt Exit-Code 2. |
| `--start <HH:MM> --end <HH:MM>` | Nur beide zusammen. Die Minuten werden berechnet. `end ≤ start` führt zu Exit-Code 2, ebenso `--minutes` zusätzlich. |
| `--delay <n>` | Ganze Zahl > 0. Nutzt dieselbe Basis `--measured` oder `--estimated`, die dann Pflicht ist. Die Verzögerung wird separat gespeichert und nie zur Zeit addiert (I-07). |
| `--reason`, `--alternative` | Nur bei `--type decision`, sonst Exit-Code 2. Ohne `--reason` wird `reason: null` gespeichert (Grund unbekannt). |
| `--cause`, `--solution` | Nur bei `--type problem`, sonst Exit-Code 2. |
| `--ref` | Syntax eines qualifizierten Belegs (§8.2), sonst Exit-Code 2. Ob der Beleg existiert, prüft ab Paket 06 `ipa note` selbst. |

**Interaktive Eingabe**: `ipa note` ohne Text

- Nur mit TTY auf stdin und stdout. Ohne TTY folgt Exit-Code 2 mit Hinweis auf die direkte Eingabe.
- Die Fragen kommen in dieser Reihenfolge, jeweils mit Standardwert per Enter:
  1. Typ (Standard `general`)
  2. Text (Pflicht)
  3. je nach Typ: Grund und Alternativen, oder Ursache und Lösung
  4. Zeitaufwand in Minuten (leer bedeutet keine Angabe)
  5. falls Zeit angegeben: gemessen oder geschätzt (Pflicht)
- Die Eingabeströme sind für Tests injizierbar.

**Speicherung**

- Die Notiz erhält `noteId`, `recordedAt` und `activityDay`.
- Sie wird mit `appendJsonl` nach `notes/<activityDay>.jsonl` geschrieben, ohne Lock (D-16).
- Die Ausgabe nennt `noteId`, Tag und Typ, aber nicht den Text.

**Lesen**

- `readNotes` filtert nach Tag, `recordedAt`-Intervall oder `refs` auf einen Snapshot.
- Ungültige Zeilen werden gemeldet und übersprungen.
- Die Sortierung erfolgt nach `recordedAt`, dann nach `id`.

## 5. Betroffene Komponenten und gemeinsame Schnittstellen

- Neu: `src/notes/`, `schemas/note.schema.json`
- Erweitert: `src/cli/` (`note`, `status`)
- Schnittstellen: `addNote`, `readNotes` und `NoteInput` (spec.md §10), Notizmodell (§9.5)

## 6. Fehler- und Randfälle

- Text mit Anführungszeichen, Semikolon und Umlauten, auch in einer Windows-Konsole
- Leerer Text oder Text nur aus Leerzeichen: Exit-Code 2.
- Notiz um 23:59 Uhr in `Europe/Zurich` bei UTC-Systemzeit: Der Tätigkeitstag ist der lokale Tag.
- Ein gleichzeitig laufender `capture` hält den Lock: `note` gelingt trotzdem.
- Nicht initialisiertes Repository: Exit-Code 2.
- Arbeitsbereich im Repository (`.ipa/`): Notizen landen dort. Das Repository bleibt ausserhalb von `.ipa/` unverändert.
- Eine Zeile der JSONL-Datei wurde von Hand beschädigt: Die übrigen Notizen bleiben lesbar.
- Ein Arbeitsbereich ohne Snapshot, also nur Paket 01 umgesetzt, und `--ref S000001:E001` mit korrekter Syntax: Die Notiz wird gespeichert. Die Existenzprüfung folgt mit Paket 06.

## 7. Akzeptanzkriterien

| ID | Kriterium |
| --- | --- |
| AK-04-01 | `ipa note "Text"` speichert eine schemagültige Notiz vom Typ `general`. `activityDay` entspricht dem heutigen Tag in der Zeitzone, `recordedAt` hat einen Offset. Die Ausgabe enthält die `noteId`, aber nicht den Text. |
| AK-04-02 | `ipa note --type decision --reason "…" --alternative A --alternative B "…"` speichert Grund und beide Alternativen. Ohne `--reason` wird `reason: null` gespeichert. `--reason` bei `--type activity` führt zu Exit-Code 2. |
| AK-04-03 | `--minutes 45 --measured` speichert `time.basis = measured`. `--minutes 45` ohne Basis führt zu Exit-Code 2. `--start 09:10 --end 09:55 --estimated` ergibt 45 Minuten. `end ≤ start` und `--minutes 0` führen zu Exit-Code 2. |
| AK-04-04 | `--delay 20 --estimated` speichert `delay` getrennt von `time`. |
| AK-04-05 | `--day` mit vergangenem Datum wird gespeichert. Ein zukünftiges Datum ist nur bei `--type plan` erlaubt, sonst Exit-Code 2. |
| AK-04-06 | Die interaktive Eingabe mit injizierten Strömen erzeugt dieselbe Notiz wie die direkte Eingabe. Ohne TTY und ohne Text folgt Exit-Code 2. |
| AK-04-07 | `--ref S000001:E001` wird syntaktisch geprüft und gespeichert. `--ref S1:E1` führt zu Exit-Code 2. |
| AK-04-08 | In einem Arbeitsbereich, der nur mit Paket 01 angelegt wurde und keine Snapshots hat, funktionieren alle Notizbefehle. Der Code von `src/notes/` importiert nur `core`, geprüft per Test oder Import-Analyse. |
| AK-04-09 | Hält ein anderer Prozess den Lock, gelingt `ipa note` trotzdem. |
| AK-04-10 | `readNotes` liefert nach Tag, Zeitintervall und Snapshot-Referenz die richtigen Notizen und meldet eine beschädigte Zeile, ohne die anderen zu verlieren. |
| AK-04-11 | `ipa status --json` enthält `notesToday`. `ipa --help` listet `note`. Der Repository-Fingerprint bleibt unverändert, bei Arbeitsbereich im Repository ausserhalb davon. |

## 8. Notwendige Tests und Validierung

- Unit-Tests: Optionsprüfung mit allen Kombinationen aus Abschnitt 4, Zeitberechnung, Tätigkeitstag bei injizierter Uhr, Filter von `readNotes`
- Integrationstests über den CLI-Einstieg: AK-04-01 bis AK-04-11
- Manuelle Prüfung: interaktive Eingabe in der Windows-Konsole und Dauer einer typischen Notiz. Ziel ist unter einer Minute. Das Ergebnis wird in der Checkliste vermerkt.

## 9. Offene Annahmen

- Eine Notiz mit Secret-Inhalt wird lokal gespeichert, wie vom Benutzer eingegeben. Sie wird nie übermittelt, weil die Prüfung beim Paketbau anschlägt (spec.md §12.2). Die Warnung bei der Eingabe folgt erst mit Paket 06.

Folgen aus der Umsetzung (29.09.2026, Einzelheiten in spec.md §18):

- `ipa note` schreibt keinen Eintrag in `runs.jsonl` (spec.md §9.11). Die Notiz selbst ist der Nachweis.
- Interaktive Eingabe: Optionen der Befehlszeile gelten als beantwortete Fragen, zum Beispiel `--day` für einen früheren Tag. Der Typ lässt sich auch als Nummer 1 bis 6 angeben. Ungültige Antworten werden erneut erfragt, auch ein Typ, der nicht zu den Optionen passt. Die Frage nach der Basis erscheint auch für eine `--delay` der Befehlszeile. Strg+C oder Strg+D bricht mit Exit-Code 2 ohne Notiz ab. Die Fragen erscheinen auf stdout, weil die interaktive Eingabe ein Terminal für Ein- und Ausgabe voraussetzt.
- `--measured` oder `--estimated` ohne Zeitangabe und leere Werte von Textoptionen ergeben Exit-Code 2. Texte werden ohne Leerzeichen am Rand gespeichert, eine doppelte `--ref` einmal.
- Die Minuten aus `--start` und `--end` sind die Differenz der Uhrzeiten am selben Tag. Eine Sommerzeitumstellung dazwischen zählt nicht. Eine Tätigkeit über Mitternacht wird als zwei Notizen erfasst.
- `readNotes` verknüpft die Kriterien mit „und“; das Intervall ist `(recordedFrom, recordedTo]` wie `observedPeriod`. Für das „oder“ aus spec.md §12.2 fragt Paket 06 Zeitraum und Referenzen getrennt ab. Ungültig sind auch Zeilen in der falschen Tagesdatei, mit ungültigem `recordedAt` oder mit doppelter `id`.
- `notesToday` zählt die gültigen Notizen, deren `activityDay` heute ist.
- Zwei Notizen derselben Sekunde erhalten mit einer Wahrscheinlichkeit von 1 zu 65 536 dieselbe `id`, wie Lauf-IDs (spec.md §8.2). `readNotes` meldet die zweite dann als doppelt; sie bleibt in der Datei erhalten und lässt sich von Hand korrigieren.
- Die interaktive Eingabe wurde am 29.09.2026 unter Linux in einem echten Pseudo-Terminal geprüft (Python-Modul `pty`). Die manuelle Prüfung in der Windows-Konsole mit Zeitmessung steht aus.
