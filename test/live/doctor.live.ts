/**
 * AK-05-09 with the real Claude Code, via `npm run test:live` only: it runs only with IPA_LIVE_CLAUDE=1
 * and after the user's explicit approval (spec.md §16.2). `ipa doctor --live` makes two small model calls
 * with artificial data; the repository is an empty test repository.
 */
import { describe, expect, it } from 'vitest';
import type { DoctorRecord } from '../../src/claude/types.js';
import type { AiUsageRecord } from '../../src/claude/usage.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { validate } from '../../src/core/schemas.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, readJsonFile, runCli } from '../helpers/workspace.js';

const enabled = process.env['IPA_LIVE_CLAUDE'] === '1';

describe.runIf(enabled)('ipa doctor --live mit dem installierten Claude Code (AK-05-09)', () => {
  it('meldet ausser StructuredOutput keine Werkzeuge, keine MCP-Server und ein gültiges structured_output', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    const before = await fingerprintRepo(repo.root);

    const result = await runCli(['doctor', '--live'], { dataDir, repo: repo.root });
    const record = await readJsonFile<DoctorRecord>(`${workspace}/doctor.json`);
    const usage = await readJsonl<AiUsageRecord>(`${workspace}/ai-usage.jsonl`, 'ai-usage');
    // Printed for the checklist and spec.md §18; doctor.json holds no personal data (AK-05-06).
    console.log(
      JSON.stringify(
        {
          exitCode: result.exitCode,
          doctor: record,
          findings: result.stderr.split(/\r?\n/).filter((line) => line.startsWith('Befund:')),
          aiUsage: usage.records.map(({ outcome, errorCode, models, costUsd, durationMs }) => ({ outcome, errorCode, models, costUsd, durationMs })),
        },
        null,
        2,
      ),
    );

    expect(validate('doctor', record)).toEqual({ ok: true });
    expect(record.live).not.toBeNull();
    expect(record.live?.toolsReported.filter((tool) => tool !== 'StructuredOutput')).toEqual([]);
    expect(record.live?.mcpServersReported).toEqual([]);
    expect(record.live?.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(usage.invalid).toEqual([]);
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });
});

describe.skipIf(enabled)('Live-Tests', () => {
  it.skip('laufen nur mit IPA_LIVE_CLAUDE=1 und nach ausdrücklicher Freigabe des Benutzers', () => undefined);
});
