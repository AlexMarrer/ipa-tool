import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunner, type Runner } from '../../src/main/cli/runner';
import { resolveRuntime } from '../../src/main/cli/runtime';
import { createSchemaValidator } from '../../src/main/cli/validator';
import { readLockFile } from '../../src/main/run/locks';
import { APP_ROOT, createTestEnv, fingerprintRepo, initProject, isAlive, readFakeCalls, waitFor, type InitializedProject, type TestEnv } from '../helpers/env';

/** AK-10-08: cancel ends the whole process tree; the next run continues without duplicates. */
describe('Abbruch des Prozessbaums (AK-10-08)', () => {
  let env: TestEnv;
  let project: InitializedProject;
  let runner: Runner;

  beforeAll(async () => {
    env = await createTestEnv();
    project = await initProject(env, 'abbruch');
    const runtime = await resolveRuntime({ packaged: false, appRoot: APP_ROOT, nodeExe: process.execPath });
    runner = createRunner({ runtime, cwd: env.userData, env: env.env, validator: createSchemaValidator(runtime.schemasDir) });
  });
  afterAll(async () => env.cleanup());

  it('beendet CLI und hängenden Fake-Claude, und der nächste capture setzt ohne Doppel fort', async () => {
    await project.repo.write('src/neu.ts', 'export const wert = 1;\n');
    const before = await fingerprintRepo(project.repo.root);

    env.env['FAKE_CLAUDE_MODE'] = 'hang';
    const run = runner.start(project.repo.root, { name: 'capture', mode: 'full' });
    const cliPid = run.pid;
    expect(cliPid).toBeGreaterThan(0);

    // The analysis call has started and hangs: the tree is CLI -> fake Claude.
    const call = await waitFor(async () => (await readFakeCalls(env)).find((entry) => entry.kind === 'model-call'));
    expect(isAlive(call.pid)).toBe(true);

    await run.cancel();
    const cancelled = await run.result;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.failure).toBeNull();

    await waitFor(() => !isAlive(call.pid) && !isAlive(cliPid as number), 15_000);
    expect(isAlive(call.pid)).toBe(false);
    expect(isAlive(cliPid as number)).toBe(false);

    // The lock file is left behind by the killed CLI, but a dead lock does not block (spec §3.7).
    expect(await readLockFile(project.workspacePath)).toBeNull();

    env.env['FAKE_CLAUDE_MODE'] = 'analysis';
    const resumed = await runner.start(project.repo.root, { name: 'capture', mode: 'full' }).result;
    expect(resumed.failure).toBeNull();
    expect(resumed.exitCode).toBe(0);

    const snapshots = (await readdir(`${project.workspacePath}/snapshots`)).filter((name) => /^S\d{6}$/.test(name));
    expect(snapshots).toEqual(['S000001', 'S000002']);
    const logs = (await readdir(`${project.workspacePath}/logs`)).filter((name) => name.endsWith('.md'));
    // One work log per snapshot (the baseline has a deterministic one), none twice.
    expect(logs).toEqual(['S000001.md', 'S000002.md']);

    const status = (await runner.start(project.repo.root, { name: 'status' }).result).status;
    expect(status).toMatchObject({ snapshots: { total: 2 }, analyses: { complete: 2, pending: 0, failed: 0, exhausted: 0 } });
    expect(await fingerprintRepo(project.repo.root)).toEqual({ ...before });
  });
});
