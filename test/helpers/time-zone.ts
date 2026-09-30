/**
 * Switches the time zone of the test process (`TZ`), which Node.js applies to `Date` at run time
 * (AK-08-03). Deleting `TZ` again does not switch back, so the zone active at load time is set first.
 */
const initialZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The value of `TZ` when the test file started, for checks that nothing leaked. */
export const initialTzVariable = process.env['TZ'];

function switchTimeZone(zone: string): () => void {
  const original = process.env['TZ'];
  process.env['TZ'] = zone;
  return () => {
    process.env['TZ'] = original ?? initialZone;
    if (original === undefined) delete process.env['TZ'];
  };
}

/** Runs `action` with `TZ=<zone>`; also waits for a returned promise before switching back. */
export function withProcessTimeZone<T>(zone: string, action: () => T): T {
  const restore = switchTimeZone(zone);
  let result: T;
  try {
    result = action();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}
