/**
 * Central texts of the app (spec §9). German, Swiss spelling (ss, no ß). Every message names what happened
 * and the next step; the app never shows only a code.
 */

export type AnalysisStatus =
  | 'complete'
  | 'skipped'
  | 'not_required'
  | 'pending'
  | 'failed'
  | 'blocked'
  | 'exhausted'
  | 'baseline';

export type Tone = 'neutral' | 'warn' | 'err';

/** spec §9.2 */
export const ANALYSIS_STATUS: Record<AnalysisStatus, { label: string; tone: Tone; hint: string | null }> = {
  complete: { label: 'Analyse abgeschlossen', tone: 'neutral', hint: null },
  skipped: { label: 'Übersprungen', tone: 'neutral', hint: null },
  not_required: { label: 'Keine Analyse nötig', tone: 'neutral', hint: null },
  pending: { label: 'Analyse ausstehend', tone: 'warn', hint: null },
  failed: { label: 'Analyse fehlgeschlagen', tone: 'warn', hint: 'Der nächste Lauf versucht es erneut.' },
  blocked: { label: 'Eingabe zu gross', tone: 'warn', hint: 'Limit in der Konfiguration erhöhen.' },
  exhausted: { label: 'Versuche erschöpft', tone: 'err', hint: 'Erneut versuchen oder Überspringen.' },
  baseline: { label: 'Ausgangslage', tone: 'neutral', hint: null },
};

export type RunOutcome =
  | 'ok'
  | 'unchanged'
  | 'halted'
  | 'unstable'
  | 'lock_held'
  | 'analysis_failed'
  | 'outside_window'
  | 'usage_error'
  | 'error';

/** spec §9.4 */
export const RUN_OUTCOME: Record<RunOutcome, { label: string; tone: Tone }> = {
  ok: { label: 'Erfolgreich', tone: 'neutral' },
  unchanged: { label: 'Keine neue Arbeit', tone: 'neutral' },
  halted: { label: 'Angehalten', tone: 'err' },
  unstable: { label: 'Arbeitsstand unruhig', tone: 'warn' },
  lock_held: { label: 'Ein anderer Lauf war aktiv', tone: 'neutral' },
  analysis_failed: { label: 'Analyse gescheitert', tone: 'err' },
  outside_window: { label: 'Ausserhalb des Zeitfensters', tone: 'neutral' },
  usage_error: { label: 'Bedienungsfehler', tone: 'warn' },
  error: { label: 'Fehler', tone: 'err' },
};

/** Labels that separate facts from AI text (spec §1.2, principle 3). */
export const CONTENT_LABELS = {
  ai: 'KI-Entwurf',
  noAi: 'ohne KI',
  tool: 'vom Tool',
  note: 'Notiz',
  /** A line taken over from a Claude analysis, also inside a draft made without AI (spec §11.3). */
  aiWorkLog: 'KI-Entwurf (Work-Log)',
  /** Header label of a baseline snapshot. */
  baseline: 'Ausgangslage',
} as const;
export type ContentLabelKind = keyof typeof CONTENT_LABELS;

/** Tooltip and accessible name of every button that can call Claude (spec §12.2). */
export const AI_MARK_TOOLTIP = 'ruft Claude auf';

/** spec §9.1 */
export const EXIT_CODE_MESSAGES: Record<number, { title: string; text: string; level: 'info' | 'warn' | 'err' }> = {
  0: { title: 'Erfolg', text: 'Der Befehl wurde ausgeführt.', level: 'info' },
  1: {
    title: 'Unerwarteter Fehler',
    text: 'Das CLI hat einen unerwarteten Fehler gemeldet. Melde ihn mit den Angaben unter System › Version.',
    level: 'err',
  },
  2: {
    title: 'Eingabe oder Konfiguration prüfen',
    text: 'Der Befehl wurde nicht ausgeführt, weil eine Angabe oder die Konfiguration nicht stimmt. Korrigiere das genannte Feld und versuche es erneut.',
    level: 'warn',
  },
  3: {
    title: 'Ein anderer Lauf ist aktiv',
    text: 'Dieser Start wurde nicht ausgeführt, es wurde nichts verändert. Versuche es erneut, sobald der laufende Lauf beendet ist.',
    level: 'info',
  },
  4: {
    title: 'Zuordnung angehalten',
    text: 'Die Zuordnung ist wegen eines Branchwechsels oder einer umgeschriebenen Historie angehalten. Setze einen neuen Ausgangspunkt, um fortzufahren.',
    level: 'err',
  },
  5: {
    title: 'Arbeitsstand unruhig',
    text: 'Der Arbeitsstand war während der Aufnahme unruhig, es wurde nichts gespeichert. Später erneut versuchen.',
    level: 'warn',
  },
  6: {
    title: 'KI-Schritt nicht abgeschlossen',
    text: 'Der Snapshot ist gespeichert. Die Analyse wurde nicht abgeschlossen. Du kannst es erneut versuchen oder die Analyse überspringen.',
    level: 'warn',
  },
  7: {
    title: 'Voraussetzungen nicht erfüllt',
    text: 'Eine Voraussetzung fehlt. Die Liste nennt, was zu tun ist.',
    level: 'warn',
  },
};

/** Failures of the app itself, not exit codes of the CLI (spec §3.4). */
export const APP_ERROR_MESSAGES = {
  runtime_missing: 'Die mitgelieferte CLI-Laufzeit fehlt oder ist beschädigt. Installiere die App neu.',
  spawn_failed: 'Das CLI liess sich nicht starten. Details nennen die Systemmeldung.',
  cli_output_invalid: 'Das CLI hat eine unerwartete Antwort geliefert. App- und CLI-Version stehen in den Details.',
  cli_version_mismatch: 'Die Version des CLI passt nicht zur App. Installiere die App neu.',
  commander_error: 'Der Befehl wurde vom CLI als Bedienungsfehler abgelehnt (Exit-Code 2).',
  auto_not_allowed: 'Dieser Befehl darf nicht automatisch gestartet werden.',
  project_unknown: 'Dieses Projekt ist nicht in der Projektliste.',
  not_cancellable: 'Dieser Befehl lässt sich nicht abbrechen.',
  run_unknown: 'Dieser Lauf ist nicht (mehr) aktiv.',
  invalid_request: 'Die Anfrage der Oberfläche war ungültig.',
  untrusted_sender: 'Die Nachricht stammt nicht aus dem Hauptfenster und wurde abgelehnt.',
  internal: 'Unerwarteter Fehler in der App. Details stehen im Protokoll.',
} as const;
export type AppErrorCode = keyof typeof APP_ERROR_MESSAGES;

/** Why a start was rejected without starting a process (spec §3.7). */
export type RejectReason = 'write_run_active' | 'journal_run_active' | 'foreign_lock' | 'doctor_active' | 'auto_not_allowed';

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  write_run_active: 'Ein Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.',
  journal_run_active: 'Ein Journal-Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.',
  foreign_lock: 'Ein anderer Lauf ist aktiv (geplanter Lauf oder Konsole). Dieser Befehl ist gesperrt, bis er endet.',
  doctor_active: 'Die Prüfung läuft bereits.',
  auto_not_allowed: APP_ERROR_MESSAGES.auto_not_allowed,
};

export const PROJECT_STATUS_LABEL = {
  ok: 'In Ordnung',
  warning: 'Warnung',
  error: 'Fehler',
  halt: 'Halt',
} as const;

export const SECTION_LABEL = {
  overview: 'Übersicht',
  day: 'Tag',
  schedule: 'Zeitplan',
  config: 'Konfiguration',
} as const;
