# Paket 10 – App-Gerüst

Die Spezifikation der App steht in `docs/app/spec.md` (hier `app/spec.md §…`). Die Verträge des CLI stehen in `docs/implementation/spec.md` (`spec.md §…`). Dieses Dokument verweist nur darauf und wiederholt sie nicht.

## 1. Ziel und konkretes Ergebnis

Eine bauende und startende Electron-App in `app/` mit sicherem Prozessmodell, eigener Laufzeit für das CLI, einem CLI-Runner mit Sperren und Abbruch, der Projektliste aus der Registry, dem Layout mit Navigation, den Tokens in Hell und Dunkel, den Basiskomponenten und der Zustandsgalerie. Die App zeigt noch keine Tagesdaten und löst noch keine Aktion des Benutzers aus. Das CLI bleibt unverändert (`app/spec.md §6.1`).

## 2. Umfang

| Thema | Abschnitt |
| --- | --- |
| Entscheidungen AD-01 bis AD-04, AD-08, AD-13 bis AD-15 | `app/spec.md §2` |
| Technik, Versionen, Prozessmodell und Sicherheitseinstellungen | `app/spec.md §3.1`, `§3.2` |
| Laufzeit des CLI (mitgelieferte `node.exe`, Entwicklungsbetrieb) | `app/spec.md §3.3`, `§6.2` |
| CLI-Runner, Fehlerklassen der App, Sperren, Abbruch | `app/spec.md §3.4`, `§3.6`, `§3.7`, `§4.1` (Runner), `§9.1` (Grundlage) |
| Fortschritt aus Dateiereignissen (Gerüst: Beobachter und Zeilenerzeugung ohne Oberfläche) | `app/spec.md §3.5`, `§3.8` |
| IPC-Schnittstelle | `app/spec.md §3.9` |
| Projektliste und Statuspunkt | `app/spec.md §5.1`, `§8.1` |
| Repository-Struktur, Skripte, Build bis `app:build` | `app/spec.md §6.1` bis `§6.3` |
| Ordnerstruktur der App | `app/spec.md §7` |
| Tokens, Typografie, Icons, Barrierefreiheit | `app/spec.md §10` |
| Basiskomponenten und Zustandsgalerie | `app/spec.md §2` (AD-15), `§8` (Komponentenliste), `§10` |
| Nichts startet Claude von selbst (Grundlage) | `app/spec.md §12.1`, `§12.2` |

Nicht im Umfang: Tagesansicht, Work-Logs, Notizen, Journal, Übersicht (Paket 11); Aktionen und Dialoge (Paket 12); Zeitplan und Konfiguration (Paket 13); Assistent, System und Installer (Paket 14). Der Bau des Installers (`app:dist`, `stage-cli`, `fetch-node`) wird als Skript angelegt und geprüft, der Installer selbst ist Paket 14.

## 3. Voraussetzungen

- Paket 09 ist im Code vorhanden (`--json`, `ipa config`, `ipa schedule install|…`). `npm run typecheck` und `npm test` im Wurzelordner sind vor Beginn grün.
- Windows 11, Node.js 24 oder neuer, Git, Internetzugang für `npm` und den Download von Electron und `node.exe`.
- Claude wird nicht aufgerufen. Es gibt keine Live-Tests.

## 4. Akzeptanzkriterien

AK-10-01 bis AK-10-16 (`app/spec.md §16`, Abschnitt „Paket 10“).

## 5. Tests und Validierung

Nach `app/spec.md §17`: Vitest für Main-Prozess (Runner, Sperren, Abbruch, `resolveRuntime`, IPC-Prüfung) und Komponenten; Kontrastprüfung der Tokens; Playwright nur als Start-Test der gebauten App (Fenster öffnet, Optionen der Sicherheitseinstellungen). Arbeitsbereiche für Tests erzeugt das echte CLI mit der Fake-CLI (`test/helpers/fake-claude.mjs`).

## 6. Offene Punkte

AO-04 (TypeScript-Version der App), AO-05 (interne CLI-Module), AO-07 (Konfiguration von `electron-builder`), AO-12 (Dateibeobachtung), AO-18 (Entwicklungsbetrieb und Aufgabe); Einzelheiten in `app/spec.md §18`. Klärungen gehören in `app/spec.md §19`.
