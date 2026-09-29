import { describe, expect, it } from 'vitest';
import { exitCodeOf, IpaError, LockHeldError, mergeExitCodes } from '../../src/core/errors.js';
import { outcomeForExitCode } from '../../src/core/run-log.js';

describe('Exit-Codes (spec.md §6.4)', () => {
  it('bildet Fehler auf Exit-Codes ab', () => {
    expect(exitCodeOf(new IpaError('not_initialized', 2, 'x'))).toBe(2);
    expect(exitCodeOf(new LockHeldError('C:/ws/lock', null, 'x'))).toBe(3);
    expect(exitCodeOf(new Error('x'))).toBe(1);
    expect(exitCodeOf('kein Error')).toBe(1);
  });

  it('nimmt bei mehreren Fällen den höchsten Code, ausser Code 1', () => {
    expect(mergeExitCodes()).toBe(0);
    expect(mergeExitCodes(0, 2, 4)).toBe(4);
    expect(mergeExitCodes(6, 4, 5)).toBe(6);
    expect(mergeExitCodes(7, 1, 3)).toBe(1);
  });

  it('ordnet Exit-Codes dem Ergebnis im Laufprotokoll zu', () => {
    expect(([0, 1, 2, 3, 4, 5, 6, 7] as const).map((code) => outcomeForExitCode(code))).toEqual([
      'ok',
      'error',
      'usage_error',
      'lock_held',
      'halted',
      'unstable',
      'analysis_failed',
      'error',
    ]);
  });
});
