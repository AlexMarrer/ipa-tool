# Paket 12 – App Aktionen

Die Spezifikation der App steht in `docs/app/spec.md` (hier `app/spec.md §…`). Die Verträge des CLI stehen in `docs/implementation/spec.md` (`spec.md §…`). Dieses Dokument verweist nur darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Die App löst die Aktionen des CLI aus: Jetzt erfassen, Nur aufnehmen, Journal erzeugen, Erneut versuchen, Überspringen, Neuen Ausgangspunkt setzen, Prüfen und Notiz erfassen. Dazu gehören die Laufanzeige mit Live-Ausgabe und Abbruch, die Sperren, die Exit-Codes in Klartext und die KI-Markierung. Nichts startet Claude von selbst.

## 2. Umfang

| Thema | Abschnitt |
| --- | --- |
| Fortschritt aus Dateiereignissen (Oberfläche), Abbruch, Sperren | `app/spec.md §3.5`, `§3.6`, `§3.7` |
| Aktion → Befehl, Ergebnisfelder, behandelte Exit-Codes | `app/spec.md §4.1` |
| Läufe starten, Laufanzeige | `app/spec.md §8.7` |
| Notiz-Dialog (alle Varianten) | `app/spec.md §8.8` |
| Dialoge Ausgangspunkt, Überspringen, Erneut versuchen | `app/spec.md §8.9` |
| Aktionen in den Lesenansichten: Erneut versuchen, Überspringen, Journal erzeugen, Journal-Fehler, Halt-Aktion, Prüfen | `app/spec.md §8.2`, `§8.4`, `§8.5` |
| Exit-Codes, Fehlerklassen, Lauf-Ergebnis | `app/spec.md §9.1`, `§9.3`, `§9.4` |
| Nichts startet Claude von selbst, KI-Markierung, Kostenschutz bei Läufen, Übermittlung an Claude, Vertraulichkeit | `app/spec.md §12.1`, `§12.2`, `§12.3`, `§12.6`, `§12.7` |

Nicht im Umfang: Zeitplan-Aktionen und Konfiguration (Paket 13), Live-Test und Prüfen in der Seite System (Paket 14; `Prüfen` in Übersicht und Kopf gehört zu diesem Paket), Projekt hinzufügen (Paket 14).

## 3. Voraussetzungen

- Paket 11 ist im Code vorhanden, seine Tests sind grün.
- Die Fake-CLI (`test/helpers/fake-claude.mjs`) deckt Erfolg, ungültige Antwort, Timeout, hängende Prozesse und Fehler ab. Claude wird nicht echt aufgerufen. Eine Live-Prüfung (ein echter Lauf mit Claude aus der App) bereitet das Paket vor; der Benutzer führt sie selbst aus.

## 4. Akzeptanzkriterien

AK-10-36 bis AK-10-51 (`app/spec.md §16`, Abschnitt „Paket 12“). Die Artboards der Gruppen `Lauf-*`, `Dialoge*`, `Notiz-Dialog*`, `Journal-Fehler` sowie die Aktionen in `WorkLog-Exhausted`, `WorkLog-Blocked` und `Halt-*` sind abgedeckt (`app/spec.md` Anhang A).

## 5. Tests und Validierung

Nach `app/spec.md §17`: Tests des Runners und der Sperren mit echtem CLI und Fake-CLI (auch ein Lauf mit gehaltenem Lock durch einen zweiten Prozess); Abbruchtest mit hängendem Fake-Claude und anschliessendem Fortsetzen; Test der Live-Zeilen mit langsamer Fake-CLI; Komponententests aller Dialoge in beiden Themes; Aufrufprotokoll gegen automatische Starts (AK-10-15, AK-10-50); Suche nach einem künstlichen Secret in Protokoll, Zustand und Anzeige (AK-10-44); Notiztexte mit Umlauten, Anführungszeichen, führendem `-` und Zeilenumbrüchen (AK-10-48); Repository-Fingerprint nach jedem Lauf.

## 6. Offene Punkte

AO-10 (Länge des Notiztexts als Befehlszeilenargument, Test hier); W-01 und W-06 (`app/spec.md §4.4`). Klärungen gehören in `app/spec.md §19`.
