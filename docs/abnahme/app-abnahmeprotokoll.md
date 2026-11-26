# Abnahmeprotokoll IPA Assistant: Desktop-App

Grundlage: `docs/app/spec.md` (AK-10-80), Paket 14 (`docs/implementation/packages/14-app-projekte-system-installer/`), das [Abnahmeprotokoll des CLI](v1-abnahmeprotokoll.md).

Stand: 26.11.2026

## Status

| Teil | Stand |
| --- | --- |
| Automatische Prüfung der App (Typprüfung, Komponenten-, Reader-, Befehls- und Ende-zu-Ende-Tests gegen das echte CLI mit gespieltem Claude und gespielter Aufgabenplanung) | **bestanden** am 26.11.2026, siehe [Automatische Nachweise](#automatische-nachweise) |
| (a) Zeitplan an der echten Windows-Aufgabenplanung (AK-09-17, AK-08-07, Seite Zeitplan) | **offen**, vom Benutzer auszuführen |
| (b) Sichtprüfung aller 72 Artboards in Hell und Dunkel | **offen**, vom Benutzer auszuführen |
| (c) Bedienung allein per Tastatur, Stichprobe mit Screenreader | **offen**, vom Benutzer auszuführen |
| (d) Installer auf einem sauberen Windows 11 ohne Node.js | **offen**, vom Benutzer auszuführen |
| Ein echter Lauf mit Claude aus der App (Jetzt erfassen, Journal erzeugen) und der Live-Test in System | **offen**, vom Benutzer auszuführen (verbraucht Kontingent, zwei kurze Testaufrufe beim Live-Test) |

Die App ist erst abgenommen, wenn alle offenen Zeilen hier mit Datum und Ergebnis stehen. Der Installer ist unsigniert (AO-01): Windows zeigt beim ersten Start die SmartScreen-Warnung („Weitere Informationen“, dann „Trotzdem ausführen“).

## Umgebung

| | Automatischer Lauf | Prüfung durch den Benutzer |
| --- | --- | --- |
| Datum | 26.11.2026 | offen |
| Betriebssystem | Windows 11 Pro 10.0.26200 | offen |
| App | `IPA Assistant Setup 0.1.0.exe`, 140,3 MB, entpackt rund 450 MB (AO-02) | offen |
| Electron / Node der App | 45.5.0 / 24.22.3 (mitgeliefert, `app/node-runtime.json`) | offen |
| Claude Code | gespielt (`test/helpers/fake-claude.mjs`) | offen (`claude auth status`, Abo) |

## Automatische Nachweise

| Kriterium | Nachweis |
| --- | --- |
| AK-10-69 bis AK-10-71 (Assistent) | `test/unit/wizard-system.test.ts` (echtes CLI), `test/components/wizard-system.test.tsx`, `test/e2e/full-flow.e2e.ts` |
| AK-10-72 bis AK-10-74 (System) | `test/components/wizard-system.test.tsx`, `test/unit/wizard-system.test.ts` |
| AK-10-75 (Installer) | `test/unit/staged-runtime.test.ts` (Inhalt des gestagten CLI, `resources/` im entpackten Installer), `test/unit/build.test.ts` |
| AK-10-76 (CLI-Tests mit der mitgelieferten `node.exe`) | `test/unit/staged-runtime.test.ts` (init, note, capture --no-analysis); die vollständige Testsuite des CLI mit derselben `node.exe`: siehe Eintrag unten |
| AK-10-77 (Zeitplan mit mitgelieferter Laufzeit) | `test/unit/staged-runtime.test.ts` (Pfade in der Aufgabe, `stale` mit `node_path` und `cli_path`) |
| AK-10-78 (Versionsabgleich) | `test/unit/runner.test.ts`, `test/unit/services.test.ts` |
| AK-10-79 (Ende-zu-Ende) | `test/e2e/full-flow.e2e.ts` |

## (a) Zeitplan an der echten Aufgabenplanung

Voraussetzung: ein Projekt, dessen Zeitplan du ohne Sorge ändern darfst. Die Aufgabe heisst `ipa-assistant-<Projekt>` und erscheint in der Windows-Aufgabenplanung (`taskschd.msc`).

| Schritt | Erwartung | Ergebnis |
| --- | --- | --- |
| Seite Zeitplan öffnen | „Nicht eingerichtet“, Vorschau mit Startzeiten | offen |
| **Einrichten** | Zustand „Aktiv“, Aufgabe in `taskschd.msc` sichtbar, Pfade zeigen auf `…\resources\node\node.exe` und `…\resources\cli\dist\cli.js` | offen |
| Nächster und letzter Lauf | Datum und Uhrzeit stimmen mit der Aufgabenplanung überein (AO-11: Format der Systemsprache) | offen |
| **Pausieren**, **Fortsetzen** | Zustand wechselt, in `taskschd.msc` „Deaktiviert“ und wieder „Bereit“; **Jetzt auslösen** ist bei „Pausiert“ gesperrt | offen |
| Intervall ändern, speichern | Zustand „Veraltet“ mit „Trigger“ | offen |
| **Aktualisieren** | Zustand „Aktiv“ | offen |
| **Jetzt auslösen** (verbraucht Kontingent, wenn es neue Arbeit gibt) | Die Aufgabe startet, der Lauf erscheint im Lauf-Verlauf | offen |
| Lauf genau auf `windowEnd` (AO-11) | beobachten, ob die Aufgabenplanung am Fensterende auslöst | offen |
| **Löschen** | Aufgabe verschwunden, Konfiguration und Snapshots unverändert | offen |

## (b) Sichtprüfung der Artboards

Die Zustandsgalerie zeigt jede Komponente in jedem Zustand in beiden Themes: `npm run app:dev`, dann in der Adresse `#/gallery` aufrufen (nur in Entwicklung und Tests). Dieselben Seiten ohne Galerie gibt es in der App mit dem Design in `docs/app/spec.md` Anhang A. Abweichungen sind nur die Punkte aus §13.

| Gruppe der Artboards | Hell | Dunkel | Bemerkung |
| --- | --- | --- | --- |
| Main, Übersicht, Halt | offen | offen | |
| Tag, Kalender, Zeitstrahl | offen | offen | |
| Work-Log, Notizen, Journal | offen | offen | |
| Lauf (läuft, Live, Ergebnis, Gesperrt) | offen | offen | |
| Notiz-Dialog (alle Zustände) | offen | offen | |
| Dialoge (Ausgangspunkt, Überspringen, Erneut) | offen | offen | |
| Zeitplan (alle Zustände) | offen | offen | |
| Konfiguration (alle Gruppen) | offen | offen | |
| Hinzufügen (alle Schritte und Fehler) | offen | offen | |
| System (alle Bereiche) | offen | offen | |

## (c) Bedienung per Tastatur

| Prüfung | Erwartung | Ergebnis |
| --- | --- | --- |
| Tab-Reihenfolge durch Seitenleiste, Kopf, Bereichsleiste, Inhalt | alles erreichbar, der Fokus ist sichtbar (2 px Rahmen) | offen |
| `Strg+N` | öffnet **Neue Notiz**, der Fokus liegt im Textfeld | offen |
| `Strg+Enter` | speichert im Notiz-Dialog, bestätigt in den anderen Dialogen | offen |
| `Esc` | schliesst Dialog und Kalender | offen |
| `←` und `→` in der Tagesansicht | wechseln den Tag, wenn kein Eingabefeld den Fokus hat | offen |
| Stichprobe mit Narrator oder NVDA (AO-15) | Schaltflächen, Chips und Tabellen tragen verständliche Namen; KI-Schaltflächen nennen „ruft Claude auf“ | offen |

## (d) Installer auf einem sauberen Windows 11

| Schritt | Erwartung | Ergebnis |
| --- | --- | --- |
| `npm run app:dist` im Wurzelordner | erzeugt `app/release/IPA Assistant Setup 0.1.0.exe` | offen |
| Setup auf einem Rechner ohne Node.js und ohne Git-Projekt-Daten starten | installiert pro Benutzer ohne Administratorrechte, legt einen Desktop-Link und einen Startmenü-Eintrag an, kein Autostart | offen |
| App starten | Fenster öffnet, „Noch kein Projekt“, System › Version zeigt App, CLI und „Node (mitgeliefert)“ | offen |
| **Projekt hinzufügen** mit einem kleinen Git-Repository | vier Schritte, „Projekt eingerichtet“ | offen |
| **Neue Notiz**, **Nur aufnehmen** | Snapshot erscheint im Tag | offen |
| Deinstallieren | App weg, Datenwurzel `%LOCALAPPDATA%\ipa-assistant` und die Arbeitsbereiche bleiben | offen |

## Ein echter Lauf mit Claude

| Schritt | Erwartung | Ergebnis |
| --- | --- | --- |
| System › **Prüfen** | „bereit“, Version und Anmeldeart, kein Modellaufruf | offen |
| System › **Live-Test** (zweistufig bestätigen) | zwei kurze Testaufrufe, „Der Live-Test ist bestanden.“ | offen |
| **Jetzt erfassen** in einem Projekt mit neuer Arbeit | Snapshot gespeichert und analysiert, Work-Log mit dem Etikett „KI-Entwurf“ | offen |
| **Journal erzeugen** | Entwurf mit dem Etikett „KI-Entwurf“, alle 13 Abschnitte | offen |
| Stichprobe: trägt jeder zitierte Beleg die Aussage? (AK-08-08) | ja | offen |
| System › Verbrauch | die Aufrufe stehen mit Dauer und Modell, Richtwert „–“ oder geschätzt | offen |

## Messungen

| Messung | Wert | Stand |
| --- | --- | --- |
| Grösse des Installers (AO-02) | 140,3 MB (entpackt rund 450 MB) | 26.11.2026 |
| Verzögerung zwischen einer Änderung aus der Konsole und der Anzeige in der App (AO-12) | 1,2 bis 1,7 s | 26.11.2026 |
