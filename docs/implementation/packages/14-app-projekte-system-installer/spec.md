# Paket 14 – App Projekte, System und Installer

Die Spezifikation der App steht in `docs/app/spec.md` (hier `app/spec.md §…`). Die Verträge des CLI stehen in `docs/implementation/spec.md` (`spec.md §…`). Dieses Dokument verweist nur darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Die letzten Seiten und die Auslieferung: der Assistent „Projekt hinzufügen“ (entspricht `init`), die Seite System (Claude, Git, Kostenschutz, Verbrauch, Daten, Version, Live-Test) und der Windows-Installer, der das CLI und die Node-Laufzeit mitliefert. Danach ist die App vollständig, ausgeliefert und Ende-zu-Ende geprüft.

## 2. Umfang

| Thema | Abschnitt |
| --- | --- |
| Assistent Projekt hinzufügen (vier Schritte, Fehlerzustände, Angebot Zeitplan) | `app/spec.md §8.12` |
| Seite System, Live-Test mit Bestätigung | `app/spec.md §8.13` |
| Lesepfade Verbrauch, Claude-Status, Datenwurzel | `app/spec.md §5.8`, `§4.2` |
| Lesende Git-Aufrufe und Schreibprobe im Assistenten | `app/spec.md §12.5`, `§4.3` |
| Installer: `app:dist`, `stage-cli`, `fetch-node`, `extraResources`, NSIS pro Benutzer, Deinstallation | `app/spec.md §6.3`, `§6.4`, `§6.5` |
| Mitgelieferte Laufzeit des CLI und Zeitplan-Pfade | `app/spec.md §3.3`, `§6.2` |
| Ende-zu-Ende-Abnahme und manuelle Prüfungen | `app/spec.md §16` (AK-10-79, AK-10-80), `§17` |
| Offene Punkte der Auslieferung (Signierung, Grösse, Name, Auto-Update, Aufgabe nach Deinstallation) | `app/spec.md §18` (AO-01 bis AO-03, AO-06, AO-07, AO-09) |

Nicht im Umfang: Auto-Update, Signierung ohne Entscheidung des Benutzers (AO-01), Benachrichtigungen (AO-13), Änderungen am CLI. Claude-Prüfung ohne vorhandenes Projekt nur im Rahmen von AO-08.

## 3. Voraussetzungen

- Paket 13 ist im Code vorhanden, seine Tests sind grün.
- Ein sauberes Windows 11 ohne installiertes Node.js für die manuelle Installerprüfung (Benutzer).
- Der Live-Test in System ruft Claude auf (zwei kurze Aufrufe). Die Prüfung bereitet das Paket vor, der Benutzer führt sie selbst aus.

## 4. Akzeptanzkriterien

AK-10-69 bis AK-10-81 (`app/spec.md §16`, Abschnitt „Paket 14“). Die Artboards der Gruppen `Hinzufuegen*` und `System*` sind abgedeckt (`app/spec.md` Anhang A). Mit diesem Paket ist jeder Screen des Design-Briefs (`app/spec.md §1.3`) einer Komponente und einem Kriterium zugeordnet und umgesetzt.

## 5. Tests und Validierung

Nach `app/spec.md §17`: Komponententests aller Zustände in beiden Themes; Tests des Assistenten mit echtem CLI (`init`) in temporären Datenwurzeln, auch mit teilweise eingerichtetem Projekt; Prüfung des Installerinhalts (entpackt: `resources/cli`, `resources/node/node.exe`, Prüfsumme, gleicher Dateiumfang wie `npm pack`); `npm test` des CLI mit der mitgelieferten `node.exe` (AK-10-76); Ende-zu-Ende mit Playwright gegen die entpackte App (AK-10-79); Prüfung der Vorlage von `schedule install` mit Ersatz-Runner (AK-10-77).

## 6. Offene Punkte

AO-01 (Signierung), AO-02 (Installergrösse messen), AO-03 (Wartung der Versionen), AO-06 (Name und Icon), AO-07 (Konfiguration von `electron-builder`), AO-08 (Claude-Prüfung ohne Projekt), AO-09 (Aufgabe nach Deinstallation), AO-11 (AK-09-17), AO-14, AO-15; siehe `app/spec.md §18`. Klärungen gehören in `app/spec.md §19`.
