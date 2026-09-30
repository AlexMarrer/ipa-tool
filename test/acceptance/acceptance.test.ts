import { describe, expect, it } from 'vitest';
import { type ClaudePurpose, renderAcceptanceReport, runAcceptance } from '../helpers/acceptance.js';
import { fakeClaudeEnv, useFakeClaude } from '../helpers/claude.js';

const FAKE_MODES: Record<ClaudePurpose, string> = { analysis: 'analysis', journal: 'journal', doctor: 'ok', timeout: 'hang' };

// The live run of the same scenario is test/live/acceptance.live.ts (AK-08-08).
describe('Abnahmeszenario V1 mit der Fake-CLI (Konzept §17, Paket 08)', () => {
  it(
    'besteht alle Fälle der Abnahmematrix an einem künstlichen Repository mit Arbeitsbereich .ipa',
    async () => {
      const report = await runAcceptance({
        live: false,
        claudeEnv: async (purpose) => (await fakeClaudeEnv(FAKE_MODES[purpose])).env,
        prepareWorkspace: (workspace) => useFakeClaude(workspace),
      });

      expect(report.cases.map((entry) => entry.id)).toEqual(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14']);
      expect(
        report.cases.filter((entry) => entry.failures.length > 0).map((entry) => `${entry.id}: ${entry.failures.join('; ')} | beobachtet: ${entry.observations.join(' / ')}`),
      ).toEqual([]);
      expect(report.cases.every((entry) => entry.steps.length > 0 && entry.observations.length > 0 && entry.evidence.length > 0)).toBe(true);

      // Two doctor calls, five analyses (one timed out), three journals; nothing else calls a model.
      expect(report.modelCalls.map((call) => call.purpose)).toEqual(['doctor', 'doctor', 'analysis', 'analysis', 'analysis', 'analysis', 'analysis', 'journal', 'journal', 'journal']);
      expect(report.modelCalls.map((call) => call.subjectId).slice(2, 7)).toEqual(['S000002', 'S000004', 'S000005', 'S000005', 'S000006']);
      expect(report.modelCalls[4]).toMatchObject({ outcome: 'claude_error', errorCode: 'timeout' });

      expect(report.samples.workLogs.length).toBeGreaterThanOrEqual(3);
      expect(report.samples.journals.length).toBeGreaterThanOrEqual(3);
      const markdown = renderAcceptanceReport(report);
      expect(markdown).toContain('| F14 | Neues Journal wird erzeugt | bestanden |');
      expect(markdown).not.toContain('IPA_TEST_SECRET_');
    },
    900_000,
  );
});
