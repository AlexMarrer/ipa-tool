/**
 * Hält den Lock eines Arbeitsbereichs in einem eigenen Prozess (Lock-Test mit echtem zweitem Prozess).
 * Verwendet das gebaute `dist/core/lock.js`. Gibt `LOCKED` aus, sobald der Lock gehalten wird,
 * und gibt ihn frei, wenn stdin geschlossen wird.
 *
 *   node test/helpers/lock-holder.mjs <arbeitsbereich>
 */
const workspaceDir = process.argv[2];
if (workspaceDir === undefined) {
  process.stderr.write('Arbeitsbereich fehlt\n');
  process.exit(2);
}

/** @type {{ withLock: (ctx: unknown, command: string, fn: () => Promise<void>) => Promise<void> }} */
const { withLock } = await import(new URL('../../dist/core/lock.js', import.meta.url).href);

const ctx = {
  workspaceDir,
  runId: 'R20260929T120000Z-beef',
  clock: { now: () => new Date() },
  config: { timezone: 'Europe/Zurich' },
};

await withLock(ctx, 'lock-holder', async () => {
  process.stdout.write('LOCKED\n');
  await new Promise((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.resume();
  });
});
process.stdout.write('RELEASED\n');
