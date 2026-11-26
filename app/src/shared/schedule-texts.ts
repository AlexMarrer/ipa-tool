import { WEEKDAY_NAME, type ScheduleConfig, type ScheduleState } from './config';

/** Texts of the schedule states (app spec §8.10, §9.5). */
export const SCHEDULE_STATE_TEXT: Record<ScheduleState, { label: string; text: string; tone: 'neutral' | 'warn' | 'err' }> = {
  not_installed: { label: 'Nicht eingerichtet', text: 'Für dieses Projekt läuft keine Windows-Aufgabe. Erfasst wird nur mit Jetzt erfassen.', tone: 'neutral' },
  active: { label: 'Aktiv', text: 'Die Windows-Aufgabe läuft nach Plan.', tone: 'neutral' },
  paused: { label: 'Pausiert', text: 'Es werden keine Läufe ausgelöst, bis du fortsetzt.', tone: 'warn' },
  stale: { label: 'Veraltet', text: 'Trigger oder Pfade passen nicht mehr zur Konfiguration.', tone: 'warn' },
  error: { label: 'Fehler', text: 'Die Aufgabe konnte nicht gelesen werden. Details in den Windows-Aufgaben.', tone: 'err' },
};

export const DIFFERENCE_LABEL: Record<string, string> = {
  node_path: 'Pfad zu Node',
  cli_path: 'Pfad zu cli.js',
  arguments: 'Argumente',
  triggers: 'Trigger',
  execution_time_limit: 'Zeitlimit',
};

export const staleMessage = (differences: readonly string[]): string =>
  `Zeitplan nicht mehr aktuell: Die Windows-Aufgabe passt nicht mehr zur Konfiguration (${differences.map((name) => DIFFERENCE_LABEL[name] ?? name).join(', ')}). Mit Aktualisieren wird sie angepasst. Bis dahin läuft der alte Plan weiter.`;

export const SCHEDULE_NOTES = ['Die Aufgabe läuft nur bei angemeldetem Benutzer. Verpasste Läufe werden nachgeholt.', 'Ein geplanter Lauf erzeugt keine Arbeitszeit. Das Journal bleibt ein manueller Schritt.'];

/** "Montag bis Freitag" for a consecutive range, otherwise the names joined. */
export function workdaysText(workdays: readonly string[]): string {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const sorted = [...workdays].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const names = sorted.map((day) => WEEKDAY_NAME[day as keyof typeof WEEKDAY_NAME] ?? day);
  if (names.length === 0) return 'keine Arbeitstage';
  const first = order.indexOf(sorted[0] as string);
  const consecutive = sorted.every((day, index) => order.indexOf(day) === first + index);
  if (names.length >= 3 && consecutive) return `${names[0]} bis ${names[names.length - 1]}`;
  return names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/** The summary of the Zeitplan group: "Montag bis Freitag, 08:00 bis 18:00 · Europe/Zurich · Alle 120 Minuten, zusätzlich 17:45." */
export function scheduleSummary(schedule: ScheduleConfig, timezone: string, maxClaudeCallsPerDay: number | null): string {
  const extra = schedule.extraRunTimes.length > 0 ? `, zusätzlich ${[...schedule.extraRunTimes].sort().join(', ')}` : '';
  const limit = maxClaudeCallsPerDay === null ? '' : ` Höchstens ${maxClaudeCallsPerDay} Claude-Aufrufe pro Arbeitstag.`;
  return `${workdaysText(schedule.workdays)}, ${schedule.windowStart} bis ${schedule.windowEnd} · ${timezone} · Alle ${schedule.intervalMinutes} Minuten${extra}.${limit}`;
}

/** `2026-10-14T08:00:00+02:00` as `Mi, 14.10.2026 08:00` in the time zone of the project; `null` is "unbekannt" (package 09 §9). */
export function formatRunStamp(iso: string | null, timeZone: string): string {
  if (iso === null) return 'unbekannt';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  const parts = new Intl.DateTimeFormat('de-CH', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday').replace('.', '')}, ${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}`;
}
