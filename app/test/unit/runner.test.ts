import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertCliVersion, createRunner, readExpectedCliVersion, type Runner } from '../../src/main/cli/runner';
import { resolveRuntime, type Runtime } from '../../src/main/cli/runtime';
import { createSchemaValidator } from '../../src/main/cli/validator';
import { APP_ROOT, REPO_ROOT, createTestEnv, fingerprintRepo, initProject, type InitializedProject, type TestEnv } from '../helpers/env';
import { createStubRuntime } from '../helpers/stub-cli';

describe('CLI-Runner mit dem echten CLI (AK-10-06)', () => {
  let env: TestEnv;
  let project: InitializedProject;
  let runtime: Runtime;
  let runner: Runner;

  beforeAll(async () => {
    env = await createTestEnv();
    // Spaces and umlauts in the path are required test cases (spec §3.4).
    project = await initProject(env, 'Prüfung Projekt ä');
    runtime = await resolveRuntime({ packaged: false, appRoot: APP_ROOT, nodeExe: process.execPath });
    runner = createRunner({ runtime, cwd: env.userData, env: env.env, validator: createSchemaValidator(runtime.schemasDir) });
  });
  afterAll(async () => env.cleanup());

  it('liest status --json ohne Hülle und lässt das Repository unverändert', async () => {
    const before = await fingerprintRepo(project.repo.root);
    const result = await runner.start(project.repo.root, { name: 'status' }).result;
    expect(result.failure).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.status).toMatchObject({ repositoryId: project.repositoryId, snapshots: { total: 1, baseline: 1, work: 0 }, halt: null });
    expect(result.status?.repoPath).toContain('Prüfung Projekt ä');
    expect(await fingerprintRepo(project.repo.root)).toEqual(before);
  });

  it('prüft die Hülle von config check gegen das Schema und gleicht den Exit-Code ab', async () => {
    const result = await runner.start(project.repo.root, { name: 'configCheck' }).result;
    expect(result.failure).toBeNull();
    expect(result.envelope).toMatchObject({ command: 'config', ok: true, exitCode: 0, errors: [] });
  });

  it('startet ohne Shell: Shell-Zeichen im Wert bleiben ein Wert und werden vom CLI abgelehnt', async () => {
    const result = await runner.start(project.repo.root, { name: 'skip', snapshotId: 'S000001', reason: '& echo gefährlich | type nul' }).result;
    // The CLI answers (usage error or wrong status), the shell never interprets the text.
    expect(result.failure).toBeNull();
    expect(result.envelope?.command).toBe('skip');
    expect(result.exitCode).toBe(2);
  });

  it('startet mit cwd ausserhalb jedes Repositorys und gibt stderr UTF-8 weiter', async () => {
    const result = await runner.start(project.repo.root, { name: 'status' }).result;
    expect(result.stderr).not.toContain('\uFFFD');
    expect(env.userData.startsWith(project.repo.root)).toBe(false);
  });

  it('meldet für ein unbekanntes Repository kein Absturz: status endet ohne Bericht, Exit-Code 2', async () => {
    const result = await runner.start(`${env.root}/gibt-es-nicht`, { name: 'status' }).result;
    expect(result.exitCode).toBe(2);
    expect(result.status).toBeNull();
    expect(result.failure).toBeNull();
  });

  it('gleicht die CLI-Version ab (cli_version_mismatch)', async () => {
    const expected = readExpectedCliVersion(APP_ROOT, REPO_ROOT);
    expect(expected).toMatch(/^\d+\.\d+\.\d+/);
    await expect(assertCliVersion(runner, expected)).resolves.toBe(expected);
    await expect(assertCliVersion(runner, '99.0.0')).rejects.toMatchObject({ code: 'cli_version_mismatch' });
  });
});

describe('CLI-Runner mit Stand-in-CLI: Fehlerklassen (AK-10-06)', () => {
  let env: TestEnv;
  let stub: Runtime;
  let runner: Runner;
  const run = (stdout: string, exit: number, stderr = '') => {
    env.env['STUB_STDOUT'] = stdout;
    env.env['STUB_EXIT'] = String(exit);
    env.env['STUB_STDERR'] = stderr;
    return runner.start('C:/egal', { name: 'configCheck' }).result;
  };

  beforeAll(async () => {
    env = await createTestEnv();
    stub = await createStubRuntime(env.root);
    runner = createRunner({ runtime: stub, cwd: env.userData, env: env.env, validator: createSchemaValidator(stub.schemasDir) });
  });
  afterAll(async () => env.cleanup());

  const envelope = (exitCode: number) =>
    JSON.stringify({ schemaVersion: 1, command: 'config', runId: null, ok: exitCode === 0, exitCode, outcome: exitCode === 0 ? 'ok' : 'usage_error', errors: [], warnings: [], result: null });

  it('akzeptiert eine gültige Hülle', async () => {
    expect((await run(envelope(0), 0)).failure).toBeNull();
  });

  it('meldet cli_output_invalid bei Text statt JSON', async () => {
    const result = await run('das ist kein JSON', 0);
    expect(result.failure).toMatchObject({ code: 'cli_output_invalid' });
    expect(result.envelope).toBeNull();
  });

  it('meldet cli_output_invalid bei einer Hülle, die das Schema verletzt', async () => {
    const result = await run(JSON.stringify({ schemaVersion: 1, command: 'config' }), 0);
    expect(result.failure).toMatchObject({ code: 'cli_output_invalid' });
    expect(result.failure?.details).toContain('cli-config');
  });

  it('meldet cli_output_invalid, wenn Exit-Code der Hülle und des Prozesses abweichen', async () => {
    const result = await run(envelope(0), 2);
    expect(result.failure).toMatchObject({ code: 'cli_output_invalid' });
    expect(result.failure?.details).toContain('weicht');
  });

  it('meldet cli_output_invalid ohne Ausgabe bei Exit-Code 1', async () => {
    expect((await run('', 1, 'Absturz')).failure).toMatchObject({ code: 'cli_output_invalid' });
  });

  it('meldet commander_error bei Exit-Code 2 ohne JSON und nimmt stderr in die Details', async () => {
    const result = await run('', 2, "error: unknown option '--foo'");
    expect(result.failure).toMatchObject({ code: 'commander_error' });
    expect(result.failure?.details).toContain('--foo');
    expect(result.exitCode).toBe(2);
  });

  it('meldet spawn_failed, wenn das Programm nicht startet', async () => {
    const broken = createRunner({
      runtime: { ...stub, nodeExe: `${env.root}/gibt-es/node.exe` },
      cwd: env.userData,
      env: env.env,
      validator: createSchemaValidator(stub.schemasDir),
    });
    const result = await broken.start('C:/egal', { name: 'configCheck' }).result;
    expect(result.failure).toMatchObject({ code: 'spawn_failed' });
  });

  it('liest die erwartete Version aus dem Stand-in', async () => {
    env.env['STUB_VERSION'] = '0.2.0';
    await expect(assertCliVersion(runner, '0.1.0')).rejects.toMatchObject({ code: 'cli_version_mismatch' });
    await expect(assertCliVersion(runner, '0.2.0')).resolves.toBe('0.2.0');
    await rm(stub.cliRoot, { recursive: true, force: true });
  });
});
