import { describe, expect, it } from 'vitest';
import { buildCommand, classify, describeCommand, isAutoAllowed, type CommandRequest } from '../../src/main/cli/commands';

describe('buildCommand (AK-10-06)', () => {
  it('hängt --json an alle Aktionsbefehle, status --json bleibt ohne Hülle', () => {
    expect(buildCommand({ name: 'status' })).toEqual({ args: ['status', '--json'], output: 'status', schema: null });
    expect(buildCommand({ name: 'capture', mode: 'full' }).args).toEqual(['capture', '--json']);
    expect(buildCommand({ name: 'capture', mode: 'noAnalysis' }).args).toEqual(['capture', '--no-analysis', '--json']);
    expect(buildCommand({ name: 'capture', mode: 'retry', retrySnapshotId: 'S000004' }).args).toEqual(['capture', '--retry=S000004', '--json']);
    expect(buildCommand({ name: 'journal', day: '2026-11-25', noAi: true }).args).toEqual(['journal', '--day=2026-11-25', '--no-ai', '--json']);
    expect(buildCommand({ name: 'doctor', live: true }).args).toEqual(['doctor', '--live', '--json']);
    expect(buildCommand({ name: 'scheduleInstall', update: true }).args).toEqual(['schedule', 'install', '--update', '--json']);
    expect(buildCommand({ name: 'configCheck' }).args).toEqual(['config', 'check', '--json']);
  });

  it('übergibt freie Texte als --option=wert, auch wenn sie mit - beginnen', () => {
    expect(buildCommand({ name: 'skip', snapshotId: 'S000002', reason: '-nicht nötig' }).args).toEqual(['skip', 'S000002', '--reason=-nicht nötig', '--json']);
    expect(buildCommand({ name: 'baseline', reason: 'Branch gewechselt', force: true }).args).toEqual(['baseline', '--reason=Branch gewechselt', '--force', '--json']);
  });

  it('stellt den Notiztext hinter --', () => {
    const built = buildCommand({
      name: 'note',
      text: '--text, der wie eine Option aussieht',
      type: 'decision',
      day: '2026-11-25',
      minutes: 30,
      timeKind: 'estimated',
      alternatives: ['A', 'B'],
      refs: ['S000002'],
    });
    expect(built.args).toEqual([
      'note',
      '--type=decision',
      '--day=2026-11-25',
      '--minutes=30',
      '--estimated',
      '--alternative=A',
      '--alternative=B',
      '--ref=S000002',
      '--json',
      '--',
      '--text, der wie eine Option aussieht',
    ]);
    expect(built.schema).toBe('cli-note');
  });

  it('baut config set mit Pfad=Wert, --dry-run und --confirm-paid-usage', () => {
    const built = buildCommand({ name: 'configSet', changes: [{ path: 'limits.maxRunSeconds', value: '1200' }], dryRun: true });
    expect(built.args).toEqual(['config', 'set', 'limits.maxRunSeconds=1200', '--dry-run', '--json']);
    expect(buildCommand({ name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: 'true' }], confirmPaidUsage: true }).args).toContain('--confirm-paid-usage');
    expect(() => buildCommand({ name: 'configSet', changes: [] })).toThrow();
    expect(() => buildCommand({ name: 'capture', mode: 'retry' })).toThrow();
  });
});

describe('classify, isAutoAllowed, describeCommand (AK-10-07, AK-10-15)', () => {
  const cases: [CommandRequest, { kind: string; ai: boolean }][] = [
    [{ name: 'capture', mode: 'full' }, { kind: 'write', ai: true }],
    [{ name: 'capture', mode: 'noAnalysis' }, { kind: 'write', ai: false }],
    [{ name: 'capture', mode: 'retry', retrySnapshotId: 'S000002' }, { kind: 'write', ai: true }],
    [{ name: 'skip', snapshotId: 'S000002', reason: 'x' }, { kind: 'write', ai: false }],
    [{ name: 'baseline', reason: 'x' }, { kind: 'write', ai: false }],
    [{ name: 'journal' }, { kind: 'journal', ai: true }],
    [{ name: 'journal', noAi: true }, { kind: 'journal', ai: false }],
    [{ name: 'doctor' }, { kind: 'doctor', ai: false }],
    [{ name: 'doctor', live: true }, { kind: 'write', ai: true }],
    [{ name: 'scheduleRun' }, { kind: 'short', ai: true }],
    [{ name: 'note', text: 'x' }, { kind: 'short', ai: false }],
    [{ name: 'configSet', changes: [{ path: 'a', value: 'b' }] }, { kind: 'short', ai: false }],
  ];
  it.each(cases)('ordnet %j ein', (request, expected) => {
    expect(classify(request)).toMatchObject(expected);
  });

  it('erlaubt automatisch nur status, schedule status, config check und config set --dry-run', () => {
    expect(isAutoAllowed({ name: 'status' })).toBe(true);
    expect(isAutoAllowed({ name: 'scheduleStatus' })).toBe(true);
    expect(isAutoAllowed({ name: 'configCheck' })).toBe(true);
    expect(isAutoAllowed({ name: 'configSet', changes: [{ path: 'a', value: 'b' }], dryRun: true })).toBe(true);
    for (const request of [
      { name: 'configSet', changes: [{ path: 'a', value: 'b' }] },
      { name: 'capture', mode: 'full' },
      { name: 'journal' },
      { name: 'doctor' },
      { name: 'scheduleRun' },
      { name: 'note', text: 'x' },
    ] as CommandRequest[]) {
      expect(isAutoAllowed(request), JSON.stringify(request)).toBe(false);
    }
  });

  it('beschreibt Befehle ohne Argumentwerte', () => {
    expect(describeCommand({ name: 'skip', snapshotId: 'S000002', reason: 'GEHEIMER GRUND' })).toBe('skip');
    expect(describeCommand({ name: 'note', text: 'GEHEIMER TEXT' })).toBe('note');
    expect(describeCommand({ name: 'capture', mode: 'retry', retrySnapshotId: 'S000002' })).toBe('capture --retry');
    expect(describeCommand({ name: 'configSet', changes: [{ path: 'k', value: 'GEHEIM' }], dryRun: true })).toBe('config set --dry-run');
  });
});
