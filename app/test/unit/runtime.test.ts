import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/main/cli/errors';
import { findOnPath, parseNodeMajor, resolveRuntime, scheduleInstallWarning } from '../../src/main/cli/runtime';
import { APP_ROOT, REPO_ROOT } from '../helpers/env';

const present = (...files: string[]) => (file: string) => files.map((f) => path.normalize(f)).includes(path.normalize(file));

describe('resolveRuntime (AK-10-05)', () => {
  it('findet im Entwicklungsbetrieb node im PATH und das Wurzel-dist/cli.js', async () => {
    const nodeExe = path.join('C:', 'tools', 'node.exe');
    const runtime = await resolveRuntime({
      packaged: false,
      appRoot: APP_ROOT,
      env: { PATH: `C:\\andere;${path.join('C:', 'tools')}` },
      exists: (file) => path.normalize(file) === path.normalize(nodeExe) || present(path.join(REPO_ROOT, 'dist', 'cli.js'), path.join(REPO_ROOT, 'schemas'))(file),
      nodeVersionOf: async () => 'v24.20.0',
    });
    expect(runtime).toMatchObject({ mode: 'development', nodeExe, cliRoot: REPO_ROOT, nodeVersion: 'v24.20.0' });
    expect(runtime.cliJs).toBe(path.join(REPO_ROOT, 'dist', 'cli.js'));
    expect(runtime.schemasDir).toBe(path.join(REPO_ROOT, 'schemas'));
  });

  it('nutzt im Test das Node des Tests und im installierten Betrieb resources/node und resources/cli', async () => {
    const test = await resolveRuntime({ packaged: false, appRoot: APP_ROOT, nodeExe: process.execPath });
    expect(test.mode).toBe('test');
    expect(test.nodeExe).toBe(process.execPath);

    const resources = path.join('C:', 'Programme', 'IPA Assistant', 'resources');
    const installed = await resolveRuntime({
      packaged: true,
      resourcesPath: resources,
      appRoot: path.join(resources, 'app.asar'),
      exists: () => true,
      nodeVersionOf: async () => 'v24.22.3',
    });
    expect(installed).toMatchObject({
      mode: 'installed',
      nodeExe: path.join(resources, 'node', 'node.exe'),
      cliJs: path.join(resources, 'cli', 'dist', 'cli.js'),
      schemasDir: path.join(resources, 'cli', 'schemas'),
    });
  });

  it.each([
    ['node fehlt im PATH', { packaged: false, env: { PATH: '' }, exists: () => false }],
    ['cli.js fehlt', { packaged: false, nodeExe: 'C:/x/node.exe', exists: (file: string) => file.endsWith('node.exe') }],
    ['installiertes node.exe fehlt', { packaged: true, resourcesPath: 'C:/r', exists: () => false }],
  ])('meldet runtime_missing, wenn %s', async (_name, options) => {
    await expect(resolveRuntime({ appRoot: APP_ROOT, ...options })).rejects.toMatchObject({ code: 'runtime_missing' });
  });

  it('meldet runtime_missing bei Node unter Version 24, mit klarer Meldung', async () => {
    const attempt = resolveRuntime({
      packaged: false,
      appRoot: APP_ROOT,
      nodeExe: process.execPath,
      nodeVersionOf: async () => 'v22.12.0',
    });
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code: 'runtime_missing', message: expect.stringContaining('v22.12.0') });
  });

  it('warnt im Entwicklungsbetrieb vor schedule install, installiert nicht', () => {
    expect(scheduleInstallWarning({ mode: 'development' })).toContain('Entwicklungsordner');
    expect(scheduleInstallWarning({ mode: 'test' })).not.toBeNull();
    expect(scheduleInstallWarning({ mode: 'installed' })).toBeNull();
  });

  it('liest die Hauptversion von node --version', () => {
    expect(parseNodeMajor('v24.22.3\n')).toBe(24);
    expect(parseNodeMajor('24.0.0')).toBe(24);
    expect(parseNodeMajor('kein node')).toBeNull();
  });

  it('sucht in PATH nur echte Programme, keine .cmd-Hüllen', () => {
    const exe = path.join('C:', 'a', 'node.exe');
    expect(findOnPath('node', { PATH: 'C:\\a' }, (file) => path.normalize(file) === exe, 'win32')).toBe(exe);
    expect(findOnPath('node', { PATH: 'C:\\a' }, (file) => file.endsWith('node.cmd'), 'win32')).toBeNull();
  });
});
