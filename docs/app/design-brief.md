# IPA Assistant Desktop-App – Design-Brief

Stand: 25.11.2026 · Entwurf aus dem Planungsgespräch · Grundlage für Claude Design und die spätere Umsetzung

## 0. Auftrag an Claude Design

Entwirf die Oberfläche einer Windows-Desktop-App für ein bestehendes Kommandozeilenwerkzeug (`ipa`). Die App ersetzt die Konsole: Alles, was das CLI kann, soll per Oberfläche möglich sein, und die App bietet zusätzlich Einsicht in das, was gesammelt wurde.

Geliefert werden soll:

1. alle Screens aus Abschnitt 6, in **Hell und Dunkel**
2. die Zustände aus Abschnitt 7 (leer, läuft, Fehler, Halt) für die Kern-Screens
3. eine kleine Komponentenbibliothek (Abschnitt 8)
4. ein klickbarer Prototyp für vier Abläufe: **Tag ansehen und wechseln**, **Notiz erfassen**, **Journal erzeugen und lesen**, **Zeitplan einrichten**

Priorität: Tagesansicht (6.1), Notiz-Dialog (6.2), Journal (6.3), Zeitplan (6.9). Der Rest folgt demselben Stil.

## 1. Worum es geht

Der **IPA Assistant** ist ein lokales Werkzeug für die IPA (Individuelle praktische Arbeit). Es sichert den Arbeitsstand eines Git-Repositorys regelmässig in **Snapshots**, lässt Claude Code daraus **belegte Work-Logs** und **Tagesjournal-Entwürfe** schreiben, nimmt **Notizen** auf (Tätigkeiten, Probleme, Entscheidungen, Zeitaufwand) und kann per Windows-Aufgabenplanung automatisch laufen. Das untersuchte Repository wird nie verändert.

Bisher lief alles in der Konsole. Die App ist ein Interface darüber:

- **Das CLI bleibt der Motor.** Die App startet dessen Befehle im Hintergrund und liest die Dateien, die es schreibt.
- **Lesen steht im Vordergrund.** Man will schnell sehen, was an einem Tag passiert ist.
- **Geändert werden nur Notizen**, und die nur neu anlegen. Work-Logs und Analysen sind Belege und bleiben unveränderlich. Journal-Entwürfe werden nur angezeigt und als Datei geöffnet.

Nutzer sind der Autor und wenige Kollegen. Jede Person hat eigene lokale Daten. Es gibt kein Konto, keinen Server und keine Zusammenarbeit zwischen Personen.

## 2. Leitprinzipien

1. **Lesen vor Schreiben.** Die Tagesansicht ist der Kern, Aktionen sind Beiwerk.
2. **Fakten und KI trennen.** Alles, was Claude formuliert hat, trägt ein sichtbares Etikett (`KI-Entwurf`). Dasselbe gilt für Inhalte ohne KI (`ohne KI`), für vom Tool berechnete Werte (`vom Tool`) und für eigene Notizen. Ein leerer Abschnitt heisst **"nicht erfasst"** und nie "nichts passiert". Dieser Unterschied muss in der Darstellung erkennbar sein.
3. **Sicher und sparsam als Standard.** Nichts startet von selbst. Jeder Button, der Claude aufruft, ist markiert. Die Variante ohne KI steht gleichwertig daneben. Es gibt keine globalen Standardwerte für neue Projekte, und teure Schalter liegen in einem bestätigten Gefahrenbereich.
4. **Keine Gesamtsumme der Arbeitszeit.** Das Tool weist gemessene und geschätzte Zeit getrennt aus und summiert sie nie. Verzögerungen stehen separat. Das Design darf das nicht "hübsch" zu einer Zahl zusammenfassen.
5. **Fehler erklären, nicht anzeigen.** Jeder Exit-Code und jeder Status wird in Klartext mit dem nächsten Schritt übersetzt (Abschnitt 7).
6. **Nüchtern und ruhig.** Ein Arbeitswerkzeug mit hoher Informationsdichte, kein Dashboard-Spektakel.

## 3. Rahmen und Look

- **Plattform:** Windows 11, Desktop-App (Electron). Mindestgrösse etwa 1100 × 700, frei skalierbar. Keine Mobile-Ansicht.
- **Sprache:** Deutsch, sachlich, **Schweizer Rechtschreibung** (`ss` statt `ß`, wie im ganzen Tool). Alle Texte im Design sind Deutsch.
- **Hell und Dunkel:** Beide Varianten sind gleichwertig auszuarbeiten. Die App folgt der Windows-Einstellung. Ist keine gesetzt, gilt **Hell**.
- **Stil:** Modernes, ruhiges Werkzeug, Orientierung an Linear und Notion (als Haltung, nicht zum Kopieren). Eine Akzentfarbe, Bedeutungsfarben nur dort, wo etwas Aufmerksamkeit braucht (siehe "Dichte und Stil" unten).
- **Typografie:** Systemschrift für Oberfläche und Fliesstext, Monospace für IDs (`S000002`, `N20261014T081500Z-0c1d`), Pfade und Befehle.
- **Barrierefreiheit:** Kontrast mindestens WCAG AA in beiden Themes, vollständig per Tastatur bedienbar, sichtbarer Fokus, Status nie nur über Farbe (immer auch Icon oder Text).
- **Tastaturkürzel:** `Strg+N` neue Notiz, `←` und `→` Vortag und Folgetag, `Strg+Enter` im Notiz-Dialog speichern.

### Dichte und Stil (Stand nach der ersten Designrunde)

Die erste Fassung der Tagesansicht war zu dicht und zu eckig. Für **alle** Screens gilt:

- **Wenig auf einmal.** Pro Screen eine Hauptsache. Zusammenfassungen sind eine ruhige Zeile, keine Karten. Was selten gebraucht wird, steht in Tooltips, aufklappbaren Bereichen oder auf einer Folgeebene.
- **Nichts doppelt.** Jede Information hat genau einen Ort. Zähler und Aufschlüsselungen stehen an den Tabs, nicht zusätzlich in Karten oder Chips.
- **Wenige Rahmen.** Flächen und Weissraum statt Linien in Kästen in Kästen. Grosse Rundungen (etwa 10 bis 12 px), weiche Schatten nur bei Dialogen und Popovern.
- **Farbe heisst Aufmerksamkeit.** Chips sind neutral grau. Farbig sind nur `pending`, `failed`, `blocked`, `exhausted`, Fehler, Halt und der Akzent der Hauptaktion.
- **Icons statt Text-Chips**, wo die Bedeutung klar ist (Notiztyp, Eintragsart), immer mit Tooltip.
- **Eine Sans-Schrift.** Monospace nur für IDs, Pfade und Befehle, nie für Projektnamen.
- **Hauptaktion ist Neue Notiz**, weil sie täglich gebraucht wird. **Jetzt erfassen** ist eine Nebenaktion, denn die Erfassung läuft ohnehin über den Zeitplan. Die KI-Markierung ist ein kleines Symbol mit Tooltip ("ruft Claude auf").
- **Ausnahme Halt.** Der Halt ist der auffälligste Zustand und braucht einen roten Banner im Projekt. Ein Punkt in der Seitenleiste allein genügt nicht, sonst bleibt die Erfassung unbemerkt stehen.
- **Claude-Status nur bei Problemen.** Ist Claude nicht bereit, erscheint eine Warnung im Projektkopf. Ist es bereit, steht dort nichts.

## 4. UI-Wortschatz

Die Begriffe stimmen mit CLI und Dokumentation überein, damit nichts doppelt benannt wird.

| Begriff | Bedeutung |
| --- | --- |
| **Projekt** | ein Git-Repository, das mit `init` eingerichtet wurde |
| **Snapshot** | gesicherter Arbeitsstand zu einem Zeitpunkt, `S000002`. Ein **Ausgangs-Snapshot** (Baseline) gilt nie als geleistete Arbeit. |
| **Beleg** | eine gespeicherte Quelle eines Snapshots, `S000002:E003` (Datei-Zustand, Commit-Nachricht, Testbericht) |
| **Work-Log** | Markdown-Protokoll eines Snapshots mit Belegen |
| **Analyse** | der Schritt, in dem Claude aus einem Snapshot ein Work-Log erstellt |
| **Notiz** | eigener Eintrag: Allgemein, Tätigkeit, Problem, Entscheidung, Erkenntnis, Planung |
| **Journal-Entwurf** | Markdown-Zusammenfassung eines Tages. Die **Endfassung** schreibt der Mensch von Hand nach `journal/final/`. |
| **Halt** | Die Erfassung ist angehalten (Branchwechsel oder umgeschriebene Historie), bis ein neuer **Ausgangspunkt** gesetzt wird. |
| **Zeitplan** | die Windows-Aufgabe, die `capture` regelmässig startet |
| **Lauf** | ein einzelner Start von capture, init, baseline oder skip, protokolliert in `runs.jsonl` |

## 5. Navigation

```text
┌────────────────┬──────────────────────────────────────────────────────┐
│ PROJEKTE       │  Projektname  ·  Statuszeile        [Jetzt erfassen ▾]│
│ ● mein-proj    │  Übersicht · Tag · Zeitplan · Konfiguration           │
│ ▲ projekt-b    ├──────────────────────────────────────────────────────┤
│ + Hinzufügen   │                                                      │
│                │                 Inhalt                               │
│ ──────────     │                                                      │
│ System         ├──────────────────────────────────────────────────────┤
│                │  Laufanzeige / Statuszeile                [＋ Notiz] │
└────────────────┴──────────────────────────────────────────────────────┘
```

- **Linke Seitenleiste:** Projektliste mit Statuspunkt je Projekt (in Ordnung, Warnung, Fehler, Halt) und Kurzhinweis wie "2 offene Analysen". Darunter "Projekt hinzufügen" und ganz unten **System** (projektübergreifend).
- **Pro Projekt vier Bereiche:** Übersicht, Tag, Zeitplan, Konfiguration. Die Projektwahl bleibt beim Wechsel des Bereichs erhalten, und der gewählte Tag bleibt beim Wechsel des Projekts so weit wie möglich erhalten.
- **Kopfzeile des Projekts:** Name mit Statuspunkt, die Hauptaktion **Neue Notiz** und daneben die Nebenaktion **Jetzt erfassen** (Split-Button mit KI-Symbol). Ein Halt zeigt zusätzlich einen roten Banner.
- **Immer erreichbar:** **Neue Notiz** (Button unten rechts und `Strg+N`) und die **Laufanzeige** (Abschnitt 6.6).

## 6. Screens

### 6.1 Tagesansicht (Kern)

**Zweck:** Auf einen Blick sehen, was an einem Tag passiert ist, und zwischen Tagen wechseln.

**Kopf**

- Tageswechsel: `‹` Vortag, Datum mit Wochentag (zum Beispiel "Mittwoch, 14. Oktober 2026"), `›` Folgetag, Button **Heute**, Kalender-Popover. Im Kalender sind Tage mit Daten markiert, Tage mit Warnungen (offene Analysen, Läufe mit Fehler) zusätzlich.
- Zeitzone des Projekts steht dezent daneben, Tagesgrenzen gelten in dieser Zeitzone.

**Tageszusammenfassung** (eine ruhige Zeile, keine Karten)

- Snapshots und Notizen als Anzahl, dazu **Zeit gemessen** und **Zeit geschätzt** als zwei getrennte Werte, **nie summiert**.
- Ein Info-Symbol öffnet einen Tooltip mit dem Rest: **Verzögerung** (getrennt, nie zur Zeit addiert), "Geplant" (Planungsnotizen zählen nicht in die Zeit) und "n Notizen ohne Zeitangabe".
- Aufschlüsselungen (Analyse-Status, Notiztypen, Anzahl der Entwürfe) stehen nicht hier, sondern als Zähler an den Tabs.

**Tabs:** Zeitstrahl · Work-Logs · Notizen · Journal

- **Zeitstrahl:** chronologische Liste des Tages auf voller Breite, eine Zeile pro Eintrag: Uhrzeit links, Typ-Icon, Titel, rechts eine kurze Kennzahl (zum Beispiel "60 min geplant" oder "Commits 2 · Belege 12"). Details erscheinen beim Aufklappen. **Alle** Snapshots des Tages stehen im Zeitstrahl, auch `pending` und `exhausted`. Ein Snapshot, dessen Analyse nicht `complete` ist, trägt ein dezentes Zeichen. Läufe ohne Auffälligkeit (`ok`, `unchanged`, `outside_window`) sind ausgeblendet, ein Link "3 unauffällige Läufe einblenden" zeigt sie. Läufe mit Fehler erscheinen immer.
- **Zähler an den Tabs:** zum Beispiel Work-Logs 5, Notizen 6, Journal 2.
- **Work-Logs** und **Journal:** siehe 6.3 und 6.4.
- **Notizen:** Liste der Notizen des Tages, filterbar nach Typ, mit allen Feldern (Zeit, Basis, Verzögerung, Grund, Alternativen, Ursache, Lösung, Verweise). **Neue Notiz** öffnet 6.2. Notizen sind in V1 nicht änderbar.

**Hinweise und Lücken** (schmale, aufklappbare Meldung über dem Zeitstrahl, zum Beispiel "2 Dinge brauchen Aufmerksamkeit", keine eigene Spalte, nur sichtbar wenn etwas vorliegt)

- offene Analysen (`pending`, `failed`, `blocked`, `exhausted`). Die Aktionen **Überspringen** und **Erneut versuchen** stehen im Tab Work-Logs, die Meldung verlinkt dorthin.
- **Unklare Tageszuordnung:** Snapshots, deren Beobachtungszeitraum mehrere Tage überspannt (zum Beispiel 16:00 bis 09:00 am Folgetag). Sie erscheinen an jedem berührten Tag nur hier und nie als ausgeführte Arbeit.
- zurückgehaltene Inhalte (Secret-Verdacht, nur Anzahl und Detektor, nie der Wert)
- Läufe mit Fehler, aktiver Halt, beschädigte Notizzeilen, Erfassungslücken (neuer Ausgangspunkt, fehlender Vorgängerstand)

**Zustände:** Tag ohne Aufnahme ("Keine Aufnahme an diesem Tag"), Tag in der Zukunft (nur Planungsnotizen möglich), Laden, Projekt mit Halt.

### 6.2 Notiz-Dialog

**Zweck:** Eine Notiz in unter einer Minute erfassen, ohne Konsole. Öffnet als Dialog über allem, per `Strg+N` oder Button.

**Aufbau (Standardansicht, bewusst klein):**

1. **Typ** als sechs Auswahlkacheln mit Icon: Allgemein (Standard), Tätigkeit, Problem, Entscheidung, Erkenntnis, Planung
2. **Text** (mehrzeilig, Pflicht, Fokus beim Öffnen)
3. **Tag** (Standard heute, Datumswahl). Vergangene Tage sind erlaubt, ein Zukunftstag nur bei **Planung**.
4. Button **Mehr Felder** klappt den Rest auf (siehe unten). Darunter **Speichern** (`Strg+Enter`) und Abbrechen.

**Mehr Felder, je nach Typ:**

| Typ | Zusatzfelder |
| --- | --- |
| Entscheidung | **Grund** und **Geprüfte Alternativen** (Liste, beliebig viele hinzufügbar) |
| Problem | **Ursache** und **Lösung** |
| alle | **Zeit** (siehe unten), **Verzögerung**, **Belege** |

**Zeit und Verzögerung (einklappbar):**

- Umschalter **Dauer** (Minuten, ganze Zahl über 0) oder **Von–bis** (zwei Uhrzeiten am selben Tag, Ende nach Beginn; Minuten werden berechnet und angezeigt). Eine Tätigkeit über Mitternacht erfasst man als zwei Notizen, ein Hinweis erklärt das.
- **Gemessen / Geschätzt:** Pflichtauswahl, sobald Zeit oder Verzögerung angegeben ist. Sie gilt für beide. Ohne Zeitangabe ist sie nicht sichtbar.
- **Verzögerung** in Minuten, getrennt von der Zeit. Hinweis: wird nie zur Zeit addiert.

**Belege:** Auswahl aus den Belegen der gespeicherten Snapshots (durchsuchbar, nach Snapshot gruppiert, mit Art und Pfad), statt `S000002:E001` zu tippen. Mehrfachauswahl.

**Formularlogik:** Ungültige Kombinationen lassen sich gar nicht erst herstellen (Zeit ohne Basis, Minuten und Von–bis gleichzeitig, Zukunft ohne Planung, Entscheidungsfelder bei anderen Typen).

**Rückmeldung nach dem Speichern:** Bestätigung mit Typ, Tag und Zeit, nie mit dem Textinhalt. Findet die Secret-Prüfung ein mögliches Zugangsdatum, wird die Notiz **trotzdem gespeichert**, und ein Hinweis nennt den Detektor (nie den Wert) und dass die Notiz **nie an Claude** geht.

### 6.3 Journal (Tab im Tag)

**Zweck:** Den Journal-Entwurf des Tages lesen, wie ein Markdown-Dokument im Web aussieht, und bei Bedarf als Datei öffnen.

- **Entwurfsliste** (Dropdown oder schmale Spalte): Jeder Lauf erzeugt einen neuen Entwurf. Eintrag mit Uhrzeit, Lauf-ID und Etikett `KI-Entwurf` oder `ohne KI`. Der neueste ist vorgewählt, frühere bleiben unverändert erreichbar.
- **Gerendertes Markdown** (siehe Abschnitt 9) als Hauptfläche. Der Hinweis am Anfang des Entwurfs ("persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen") erscheint als abgesetzte Hinweisbox.
- **Gliederung:** Der Entwurf hat immer dieselben 13 Abschnitte (Geplante Arbeiten, Ausgeführte Arbeiten, Probleme und Lösungen, Entscheidungen, Tests, Abweichungen von der Planung, Erkenntnisse, Nächste Schritte, Zeitaufwand, Unklare Tageszuordnung, Offene Analysen und Erfassungslücken, Unbekannt/offen, Quellen). Eine mitlaufende Gliederung erleichtert das Springen.
- **Referenzen** wie `[N20261014T081500Z-0003]` und `[S000002:E003]` erscheinen als **klickbare Chips**. Eine Notiz-Referenz springt zur Notiz, eine Beleg-Referenz zum Work-Log des Snapshots (Abschnitt Belege).
- **Aktionen:** **Datei öffnen** (Standardprogramm), **Ordner zeigen**, **Text kopieren**, **Pfad kopieren**. Dazu der Hinweis "Endfassung von Hand nach `journal/final/` übernehmen" mit einem Button, der diesen Ordner öffnet. Die App schreibt nie in diesen Ordner.
- **Journal erzeugen** (Button, KI-markiert) mit Umschalter **Ohne KI** und Datumswahl (Standard: der angezeigte Tag).

**Zustände:** noch kein Entwurf (leerer Zustand mit Hauptaktion), Lauf läuft (Laufanzeige), Fehler (zum Beispiel Exit-Code 6 mit Angebot "Ohne KI erzeugen"), Entwurf mit Lücken.

### 6.4 Work-Logs (Tab im Tag)

- Liste der Snapshots des Tages: ID, Beobachtungszeitraum, Branch, Etikett `KI-Entwurf` oder `ohne KI`, Analyse-Status als Chip.
- Der gewählte Work-Log wird als gerendertes Markdown angezeigt. Er hat immer dieselben Abschnitte: Zusammenfassung, Umgesetzt, Entscheidungen, Probleme, Tests, Widersprüche, Statusänderungen (vom Tool), Unbekannt/offen, Erfassungshinweise und die **Tabelle Belege**.
- Aktionen: Datei öffnen, Ordner zeigen. Je nach Status zusätzlich **Erneut versuchen** (nur bei `exhausted`), **Überspringen** (bei offenen Analysen) und bei `blocked` der Hinweis "Limit in der Konfiguration erhöhen" mit Sprung dorthin.
- Ausgangs-Snapshots tragen die Überschrift "Ausgangslage – keine neu erbrachte Leistung" und werden so auch markiert.

### 6.5 Projektübersicht

- **Halt-Banner** (rot), wenn die Erfassung angehalten ist: Grund in Klartext (Branch gewechselt, Historie umgeschrieben, HEAD fehlt), erwarteter und beobachteter Stand, Aktion **Neuen Ausgangspunkt setzen** (6.7).
- **Kennzahlen:** letzter Lauf (Ergebnis, Zeit, Dauer), letzter Snapshot, Analyse-Stand (Cursor), Analysen nach Status (complete, skipped, not_required, pending, failed, blocked, exhausted), zurückgehaltene Einheiten und Notizen, Notizen heute.
- **Claude:** bereit oder nicht (Version, Anmeldeart), Zeitpunkt der letzten Prüfung.
- **Zeitplan:** aktiv, pausiert oder nicht eingerichtet, nächster Lauf.
- **Letzte Tage:** Liste mit Warnpunkten, Klick springt in die Tagesansicht.

### 6.6 Läufe starten und Laufanzeige

**Aktionen** (alle starten das CLI im Hintergrund):

| Aktion | Variante | KI-Markierung |
| --- | --- | --- |
| **Jetzt erfassen** (Split-Button) | Hauptaktion: aufnehmen und analysieren. Alternative im Menü: **Nur aufnehmen** (`--no-analysis`). | Hauptaktion ja |
| **Journal erzeugen** | Standard mit KI, Umschalter **Ohne KI** | mit KI ja |
| **Erneut versuchen** | nur bei `exhausted`, zeigt Versuche (zum Beispiel 3 von 3) und letzte Fehlerklasse | ja |
| **Überspringen** | Pflichtfeld Grund | nein |
| **Neuen Ausgangspunkt setzen** | Pflichtfeld Grund | nein |
| **Prüfen** (doctor) | ohne Modellaufruf | nein |
| **Live-Test** (doctor --live) | echter Modellaufruf, mit Bestätigung | ja |

**Laufanzeige** (fest am unteren Rand, einklappbar): Klartext-Titel ("Erfasse Snapshot und analysiere …"), Laufzeit, einklappbare Live-Ausgabe des Befehls, Button **Abbrechen** mit Hinweis, dass der nächste Lauf sauber fortsetzt. Läufe mit Claude können bis zu 30 Minuten dauern, die Anzeige muss damit leben.

**Ergebnis:** Zusammenfassung wie die CLI-Ausgabe (zum Beispiel "Snapshot S000002 gespeichert, Commits 2, Belege 12, Analyse abgeschlossen") und der Exit-Code in Klartext (Abschnitt 7).

**Sperren:** Während ein Lauf läuft, sind die KI-Buttons gesperrt. Beim Journal ist das zwingend, weil das CLI dafür keinen Lock nimmt und zwei Klicks zwei Claude-Aufrufe auslösen würden. Läuft ein Lauf des Zeitplans, meldet das CLI "Ein anderer Lauf hält den Lock" (Exit-Code 3), und die App zeigt das als Hinweis statt als Fehler.

### 6.7 Dialoge: Ausgangspunkt, Überspringen, Erneut versuchen

- **Neuen Ausgangspunkt setzen:** zeigt Halt-Grund sowie erwarteten und beobachteten Stand (Branch und HEAD). **Grund** ist Pflicht, ein Grund, der wie ein Zugangsdatum aussieht, wird abgelehnt. Hinweis: Arbeit zwischen dem letzten Snapshot und dem neuen Ausgangspunkt bleibt als Lücke sichtbar. Ohne aktiven Halt ist die Aktion nur über "Trotzdem setzen" (`--force`) im Erweitert-Bereich möglich.
- **Überspringen:** zeigt Snapshot, Status und den Hinweis, dass die Lücke in Status und Journal sichtbar bleibt. **Grund** ist Pflicht.
- **Erneut versuchen:** zeigt bisherige Versuche und Fehlerklassen, mit Hinweis, dass dies einen Claude-Aufruf auslöst.

### 6.8 Projekt hinzufügen (Assistent, entspricht `init`)

1. **Ordner wählen.** Die App prüft, ob es ein Git-Repository ist und ob es schon eingerichtet ist (dann Hinweis statt Fehler). Git-Version und Claude-Bereitschaft werden angezeigt.
2. **Einstellungen:** Zeitzone (Standard `Europe/Zurich`, durchsuchbar), Arbeitsbereich **Standard** (ausserhalb des Projekts, empfohlen) oder **im Repository** (`.ipa`, mit Hinweis auf `.gitignore`).
3. **Bestätigen:** Hinweis, dass ein **Ausgangs-Snapshot** aufgenommen wird, der nie als Arbeit zählt. Ergebnis zeigt Repository-ID, Arbeitsbereich, Zeitzone und das Ergebnis der Claude-Prüfung (bereit oder Warnung, der Arbeitsbereich ist in beiden Fällen vollständig).
4. **Danach:** Angebot, einen Zeitplan einzurichten (nicht automatisch).

Fehlerzustände: kein Git-Repository, Datenwurzel nicht beschreibbar (mit den Auswegen), abweichende Angaben bei bereits teilweise eingerichtetem Projekt.

### 6.9 Zeitplan (pro Projekt)

**Status:** eine Karte mit dem Zustand der Windows-Aufgabe: **nicht eingerichtet**, **aktiv**, **pausiert**, **veraltet** (Trigger oder Pfade passen nicht mehr zur Konfiguration) oder **Fehler**. Dazu nächster Lauf, letzter Lauf mit Ergebnis. Die technische Aufgaben-ID (`ipa-assistant-<repositoryId>`) steht nur klein als Info, die App kennt sie und man muss sie nie suchen.

**Formular** (entspricht dem Block `schedule` der Konfiguration):

- Arbeitstage als Chips Mo bis So
- Zeitfenster von–bis
- Intervall in Minuten
- Zusätzliche Läufe (Liste von Uhrzeiten, zum Beispiel 17:45)
- **Live-Vorschau:** die Startzeiten eines Arbeitstags als Liste, dazu **"Höchstens N Claude-Aufrufe pro Arbeitstag"**. N ist die Zahl der Läufe mal `maxAnalysesPerRun`. Die App rechnet die Läufe aus Fenster, Intervall und Zusatzzeiten und zählt dabei vorsichtig einen Lauf genau am Fensterende mit (ob die Aufgabenplanung ihn auslöst, ist noch nicht manuell geprüft). Hinweis: Ohne neue Arbeit ruft ein Lauf Claude gar nicht auf.
- **Warnungen** wie im CLI: Zusatzlauf ausserhalb des Fensters, Intervall länger als das Fenster, Timeout über 10 Minuten. Leere Arbeitstage lassen sich nicht speichern.

**Aktionen:** **Einrichten**, **Aktualisieren** (nach Änderung der Konfiguration), **Pausieren** und **Fortsetzen**, **Jetzt auslösen** (KI-markiert, startet die Aufgabe), **Löschen** (mit Bestätigung).

**Hinweise im Screen:** Die Aufgabe läuft nur bei angemeldetem Benutzer. Verpasste Läufe werden nachgeholt. Ein geplanter Lauf erzeugt keine Arbeitszeit, und das Journal bleibt ein manueller Schritt.

**Lauf-Verlauf:** Tabelle der letzten Läufe aus `runs.jsonl` (Zeit, Befehl, Ergebnis als Chip, Dauer, erzeugter Snapshot, abgeschlossene und gescheiterte Analysen).

### 6.10 Konfiguration (pro Projekt)

Gruppen als Abschnitte oder Unterseiten:

| Gruppe | Felder | Umsetzung |
| --- | --- | --- |
| **Claude** | `model`, `timeoutSeconds`, `maxTurns`, `maxAttemptsPerSnapshot`, `maxAnalysesPerRun` | Das Modell ist ein Dropdown mit den bekannten Modellen und der Option "Standard von Claude Code", dazu ein freies Feld für neue Modelle. Bei grösseren Modellen steht der Hinweis, dass sie in der Regel mehr Kontingent verbrauchen. Daneben das Ergebnis der letzten Prüfung (Version, Anmeldeart, bereit). |
| **Kostenschutz** | `allowPaidUsage` | **Gefahrenbereich** mit Bestätigung. Standard ist aus (nur Abo). Zeigt, welche kostenpflichtigen Wege `doctor` erkannt hat, nur mit Namen. |
| **Zeitplan** | `schedule` | dasselbe Formular wie 6.9, es gibt nur eine Stelle dafür |
| **Dateifilter** | `paths.include`, `paths.exclude` | Chip-Liste für Glob-Muster. `.git` und der Arbeitsbereich im Repository erscheinen als gesperrte Chips. Dazu **Pfad testen**: Eingabe eines Pfads zeigt, ob er erfasst wird und durch welche Regel. |
| **Secrets** | `disabledDetectors`, `extraPatterns` | Neun Detektoren als Schalter mit Erklärung, mit Warnung beim Abschalten. Eigene Regex-Muster mit Testfeld und Gültigkeitsprüfung. |
| **Kontext** | `context.files`, `testReports` | Dateiliste mit Dateiwahl, Testberichte aus Pfad und Bezeichnung |
| **Limits** (erweitert) | acht Grössen- und Wiederholungsgrenzen | Einheiten wie KiB und MiB, je Feld "Auf Standard zurücksetzen" |
| **Info** (nur lesen) | Repository-ID, Pfad, Arbeitsbereich, Zeitzone | Die Zeitzone lässt die App nach `init` bewusst nicht ändern (Designentscheidung, keine Regel des Tools), weil sie bestimmt, welchem Tag bestehende Daten zugeordnet sind |

**Verhalten:**

- Validierung direkt im Formular gegen dasselbe Schema wie im CLI. Fehler nennen das Feld in Klartext.
- Änderungen gelten ab dem nächsten Lauf. Läuft gerade einer, sagt die App das.
- Nach einer Änderung am Zeitplan zeigt die App "Zeitplan nicht mehr aktuell" und bietet **Aktualisieren** an.
- **Es gibt keine globalen Standardwerte und kein "Einstellungen übernehmen".** Neue Projekte starten mit den festen, konservativen Tool-Standards.
- Ein Button **config.json öffnen** für alle, die direkt im Editor arbeiten wollen.

### 6.11 System (projektübergreifend)

- **Claude:** Version, Anmeldeart, bereit oder nicht. **Prüfen** (ohne Modellaufruf) und **Live-Test** (mit Bestätigung, verbraucht Kontingent). Hinweis, dass nicht prüfbar ist, ob es der zugelassene geschäftliche Zugang ist.
- **Git:** Version.
- **Kostenschutz:** Befund, ob ein kostenpflichtiger Weg erkannt wurde (nur Namen von Variablen und Einstellungen, nie Werte), mit Abhilfe in Klartext.
- **Verbrauch:** Claude-Aufrufe pro Tag und Projekt aus `ai-usage.jsonl` (Zweck: Analyse, Journal, Doctor), Dauer, Modell und Ergebnis, dazu ein **Richtwert in USD** laut Claude Code (bei Abo-Nutzung wird nichts abgerechnet, das Wording muss das klar machen). Zeitraum wählbar. Prompt und Antwort stehen dort nie.
- **Daten:** Pfad der Datenwurzel mit Button zum Öffnen. Hinweis, dass das Tool nichts sichert und der Arbeitsbereich in die eigene Sicherung gehört.
- **Version** von App und CLI.

## 7. Zustände, Fehler und Status

### Exit-Codes in Klartext

| Code | Bedeutung | Anzeige und nächster Schritt |
| --- | --- | --- |
| 0 | Erfolg, auch "keine neue Arbeit" | Erfolgsmeldung, bei `unchanged` neutral "Keine neue Arbeit" |
| 1 | Unerwarteter Fehler | Fehlerbanner, Details einblendbar |
| 2 | Bedienungs- oder Konfigurationsfehler | Meldung mit dem betroffenen Feld |
| 3 | Ein anderer Lauf hält den Lock | Hinweis "Ein anderer Lauf ist aktiv", später erneut |
| 4 | Halt wegen Branchwechsel oder Historie | roter Banner, **Neuen Ausgangspunkt setzen** |
| 5 | Arbeitsstand unruhig, nichts gespeichert | Hinweis, später erneut versuchen |
| 6 | KI-Schritt nicht abgeschlossen | Hinweis, **Erneut versuchen**, **Überspringen** oder bei Journal **Ohne KI** |
| 7 | Voraussetzungen nicht erfüllt (doctor) | Liste der fehlenden Voraussetzungen mit Abhilfe |

### Analyse-Status (Chips)

`complete` · `skipped` · `not_required` · `pending` · `failed` (Versuche übrig) · `blocked` (Eingabe zu gross) · `exhausted` (Versuche erschöpft). Jeder Chip hat eine Farbe, ein Icon und einen Kurztext in Klartext.

### Lauf-Ergebnis (Chips)

`ok` · `unchanged` · `halted` · `unstable` · `lock_held` · `analysis_failed` · `outside_window` · `usage_error` · `error`

### Halt-Gründe

`branch_changed` ("Der Branch hat gewechselt") · `history_rewritten` ("Die Historie wurde umgeschrieben, zum Beispiel Rebase, Amend oder Reset") · `head_missing`

### Erfassungslücken

Neuer Ausgangspunkt (`rebaseline`) · Halt vor neuem Ausgangspunkt (`halt_detected`) · Vorgängerstand fehlt (`previous_state_unavailable`)

### Benachrichtigung bei Halt oder Fehler (V1)

Der Zeitplan läuft ohne die App. In V1 gibt es dafür **keine Windows-Benachrichtigungen**. Stattdessen:

- roter Banner beim Öffnen der App
- Warnpunkt am Projekt in der Seitenleiste
- Warnpunkt am betroffenen Tag im Kalender

## 8. Komponenten

- **Etiketten:** `KI-Entwurf`, `ohne KI`, `vom Tool`, `Notiz`, `Ausgangslage`. Dezent, aber immer vorhanden.
- **Status-Chip** mit Farbe, Icon und Text (Analyse-Status, Lauf-Ergebnis, Zeitplan-Zustand)
- **Referenz-Chip** für `N…`- und `S…:E…`-IDs, klickbar, Monospace
- **Banner** in drei Stufen (Info, Warnung, Fehler), der Halt-Banner ist die auffälligste Variante
- **Bestätigungsdialog**, bei teuren oder riskanten Aktionen zweistufig (zum Beispiel `allowPaidUsage`, Live-Test, Zeitplan löschen)
- **Split-Button** (Jetzt erfassen)
- **KI-Markierung** an Buttons (kleines Symbol), die Claude aufrufen
- **Tageswechsel** mit Kalender-Popover und Markierungen
- **Chip-Liste** für Glob-Muster und Uhrzeiten, mit Hinzufügen und Entfernen
- **Laufanzeige** mit einklappbarer Live-Ausgabe
- **Leere Zustände** mit einer Hauptaktion und einem erklärenden Satz
- **Gerendertes Markdown** (Abschnitt 9)
- **Tabellen** mit Sortierung und horizontalem Scrollen bei Platzmangel (Läufe, Verbrauch, Belege)

## 9. Gerendertes Markdown

Work-Logs und Journal-Entwürfe sind Markdown und sollen **wie auf einer Webseite** dargestellt werden, nicht als Rohtext.

- Überschriften (bis Ebene 3), Fliesstext, Listen und verschachtelte Listen, **Fettschrift**, `Code` inline, Zitatblöcke (für Hinweise), horizontale Linien
- **Tabellen** (Zeitaufwand, Belege, Quellen), mit Kopfzeile und Zebra oder feinen Linien, bei Breite horizontal scrollbar. Lange Hashes (SHA-256) werden gekürzt und per Klick vollständig kopierbar.
- Lesebreite begrenzt (etwa 80 Zeichen) für den Fliesstext, Tabellen dürfen breiter sein
- Referenzen in eckigen Klammern werden zu Referenz-Chips (Abschnitt 8)
- Kein rohes HTML aus dem Inhalt: Der Text stammt aus Code, Notizen und KI-Antworten und gilt als nicht vertrauenswürdig. Links aus dem Inhalt öffnen nie von selbst.
- Beide Themes (Hell, Dunkel) mit gleichwertiger Typografie

## 10. Beispieldaten für die Entwürfe

Für realistische Screens:

- **Projekt:** `mein-projekt-3fa9c1`, Repository `C:/GIT/mein-projekt`, Zeitzone `Europe/Zurich`, ein zweites Projekt `projekt-b-7d21e0` mit Halt-Banner
- **Snapshots:** `S000001` (Ausgangs-Snapshot), `S000002` (complete, KI), `S000003` (pending, Secret-Verdacht bei einer Commit-Nachricht), `S000004` (Beobachtungszeitraum 14.10. 16:00 bis 15.10. 09:00, unklare Tageszuordnung), `S000005` (exhausted)
- **Notizen vom 14.10.2026:**
  - Planung: "Wortvalidierung in einen Service verschieben", 60 Minuten geschätzt
  - Tätigkeit: "Recherche zur Testkonfiguration", 09:10 bis 09:55, 45 Minuten gemessen
  - Entscheidung: "Validierung im Service", Grund "Wiederverwendung", Alternative "Logik in der Komponente", 30 Minuten geschätzt
  - Problem: "Build hing beim Start", Ursache "Veralteter Cache", Lösung "Cache geleert", Verzögerung 20 Minuten geschätzt
  - Erkenntnis: "Vitest braucht für Windows längere Timeouts"
  - Allgemein: "Besprechung mit der Fachperson"
- **Zeit dieses Tages:** gemessen 45 Minuten, geschätzt 30 Minuten, geplant 60 Minuten (geschätzt), Verzögerung 20 Minuten, drei Notizen ohne Zeit
- **Läufe:** `ok` 08:00, `unchanged` 10:00, `unstable` (Exit-Code 5) 12:00, `outside_window` 18:00
- **Zeitplan:** Montag bis Freitag, 08:00 bis 18:00, alle 120 Minuten, zusätzlich 17:45, daraus höchstens 7 Läufe (08, 10, 12, 14, 16, 18 Uhr und 17:45) und damit höchstens 35 Claude-Aufrufe pro Arbeitstag
- **Journal-Entwurf:** Aufbau wie in Abschnitt 6.3 mit den 13 Abschnitten, mit Zeitaufwand-Tabelle, Quellen-Tabelle und Referenzen. Ein Entwurf `ohne KI` und einer mit KI.

## 11. Nicht in V1

- Notizen **bearbeiten oder löschen** (später als Korrektur-Notiz, die eine alte ersetzt)
- **Diff-Ansicht** für Belege (Phase 2). In V1 führen Beleg-Referenzen zum Work-Log, nicht zum Diff.
- **Windows-Benachrichtigungen** und Tray-Symbol (später)
- Journal **bearbeiten** oder die Endfassung speichern. Die Endfassung entsteht von Hand in `journal/final/`.
- **Globale Standardwerte** für neue Projekte, Einstellungen von einem Projekt auf ein anderes übernehmen
- Linux, macOS, cron
- Zusammenarbeit, Konten, Cloud-Sync

## 12. Randbedingungen mit Wirkung aufs Design

- Alle Daten liegen lokal als Dateien. Lesen ist schnell, der Aufbau braucht keine Ladebalken für Normalfälle.
- Läufe mit Claude dauern Sekunden bis Minuten (bis zu 30 Minuten). Dafür braucht es eine ehrliche Laufanzeige statt eines Drehrads.
- Das CLI erzeugt keine Dateien im untersuchten Repository, und die App tut das auch nicht.
- Die Windows-Aufgabe läuft unabhängig von der App. Die App muss sie jederzeit korrekt lesen können, auch wenn sie von Hand verändert wurde (Zustand "veraltet").
- Alles im Journal und in den Work-Logs ist belegbar oder als "nicht erfasst" gekennzeichnet. Die Oberfläche darf nichts glätten oder ergänzen.

## 13. Noch offen

- Format des Journals, falls Schule oder Betrieb eines verlangen (O-04)
- Sicherung des Arbeitsbereichs (O-07)
- Genaue Texte der Meldungen, wo das CLI heute nur Konsolenausgabe liefert
- Ob der Journal-Abschnitt "Zeitaufwand" in der App zusätzlich als eigene Auswertung (Woche, IPA-Gesamtzeitraum) gebraucht wird
