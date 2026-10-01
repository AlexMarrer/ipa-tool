/**
 * Acceptance of V1 with the installed Claude Code (package 08, AK-08-08), via
 * `npm run test:live -- test/live/acceptance.live.ts` only: it runs only with IPA_LIVE_CLAUDE=1 and after
 * the user's decision (spec.md §16.2). About ten model calls: two of `ipa doctor --live`, five analyses
 * (one of them stopped on purpose after one second) and three journals. The report and a copy of the
 * workspace of the artificial repository stay after the run, in IPA_ACCEPTANCE_OUT or in the temp folder.
 */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { renderAcceptanceReport, runAcceptance } from '../helpers/acceptance.js';

const enabled = process.env['IPA_LIVE_CLAUDE'] === '1';

describe.runIf(enabled)('Abnahme V1 mit dem installierten Claude Code (AK-08-08)', () => {
  it(
    'führt alle Fälle aus Konzept §17 an einem künstlichen Repository durch',
    async () => {
      const report = await runAcceptance({ live: true, claudeEnv: async () => ({}) });
      const stamp = report.startedAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      const target = process.env['IPA_ACCEPTANCE_OUT'] ?? path.join(inject('ipaSystemTmpDir'), `ipa-abnahme-${stamp}`);
      await mkdir(target, { recursive: true });
      const markdown = renderAcceptanceReport(report);
      await writeFile(path.join(target, 'bericht.md'), markdown);
      await writeFile(path.join(target, 'bericht.json'), `${JSON.stringify(report, null, 2)}\n`);
      // Artificial data only; F09 checks that the secret marker is nowhere in it.
      await cp(report.workspace, path.join(target, 'arbeitsbereich'), { recursive: true });
      console.log(markdown);
      console.log(`Bericht und Kopie des Arbeitsbereichs: ${target}`);

      expect(
        report.cases.filter((entry) => entry.failures.length > 0).map((entry) => `${entry.id}: ${entry.failures.join('; ')} | beobachtet: ${entry.observations.join(' / ')}`),
      ).toEqual([]);
    },
    60 * 60 * 1000,
  );
});
