/** Time of day in the time zone of the project (spec AD-11), `HH:MM:SS`. */
export function formatClock(iso: string, timeZone: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  try {
    return new Intl.DateTimeFormat('de-CH', { timeZone: timeZone ?? 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
  } catch {
    return date.toISOString().slice(11, 19);
  }
}
