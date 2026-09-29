/**
 * Holds the lock of a workspace in a separate process, using the built `dist/core/lock.js`.
 * Prints `LOCKED` once the lock is held and releases it when stdin closes.
 *
 *   node test/helpers/lock-holder.mjs <workspace>
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
