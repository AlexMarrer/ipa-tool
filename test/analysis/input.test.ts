import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildAnalysisInput, noteSha256, serializeInput } from '../../src/analysis/input.js';
import { createDefaultConfig } from '../../src/core/config.js';
import type { WorkspaceContext } from '../../src/core/context.js';
import { validate } from '../../src/core/schemas.js';
import type { Note } from '../../src/notes/types.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';
import { createTempDir } from '../helpers/workspace.js';
import { fixedContents, fixedManifest, fixedNote } from './fixtures.js';

function note(id: string, recordedAt: string, extra: Partial<Note> = {}): Note {
  return { ...fixedNote(), id, recordedAt, type: 'general', reason: null, alternatives: [], ...extra };
}

async function fixedWorkspace() {
  const workspaceDir = await createTempDir('arbeitsbereich');
  const repoRoot = await createTempDir('repo');
  const manifest = fixedManifest();
  const baseline = {
    ...fixedManifest(),
    snapshotId: 'S000001',
    kind: 'baseline',
    previousSnapshotId: null,
    observedPeriod: { from: null, to: '2026-10-14T08:00:00+02:00' },
    analysisRequired: false,
    commits: [],
    evidence: [fixedManifest().evidence[2]!].map((entry) => ({ ...entry, id: 'E002', file: 'content/E002.patch' })),
    statusChanges: [],
    filterDecisions: [],
    gaps: [],
  };
  for (const snapshot of [baseline, manifest]) {
    await mkdir(`${workspaceDir}/snapshots/${snapshot.snapshotId}/content`, { recursive: true });
    await writeFile(`${workspaceDir}/snapshots/${snapshot.snapshotId}/manifest.json`, JSON.stringify(snapshot));
  }
  for (const [id, text] of Object.entries(fixedContents())) {
    await writeFile(`${workspaceDir}/snapshots/S000002/content/${id}.${id === 'E003' ? 'patch' : 'txt'}`, text);
  }

  const marker = createSecretMarker();
  const notes = [
    note('N20261014T060000Z-0001', '2026-10-14T08:00:00+02:00'),
    note('N20261014T071500Z-0002', '2026-10-14T09:15:00+02:00'),
    note('N20261014T080312Z-0003', '2026-10-14T10:03:12+02:00'),
    note('N20261014T090000Z-0004', '2026-10-14T11:00:00+02:00', { refs: ['S000002:E003'] }),
    note('N20261014T090100Z-0005', '2026-10-14T11:01:00+02:00', { refs: ['S000002:E999'] }),
    note('N20261014T073000Z-0006', '2026-10-14T09:30:00+02:00', { text: `Zugang ${secretAssignment(marker)}` }),
    note('N20261014T090200Z-0007', '2026-10-14T11:02:00+02:00', { refs: ['S000001:E002'] }),
  ];
  await mkdir(`${workspaceDir}/notes`);
  await writeFile(`${workspaceDir}/notes/2026-10-14.jsonl`, notes.map((entry) => `${JSON.stringify(entry)}\n`).join(''));

  await mkdir(`${repoRoot}/docs`);
  await writeFile(`${repoRoot}/docs/anforderungen.md`, '# Anforderungen\n');
  await writeFile(`${repoRoot}/gross.md`, 'x'.repeat(200));
  await writeFile(`${repoRoot}/geheim.md`, `${secretAssignment(marker)}\n`);
  await writeFile(`${workspaceDir}/bild.bin`, Buffer.from([0x89, 0x50, 0x00, 0x01]));

  const config = createDefaultConfig({ repositoryId: manifest.repositoryId, repoPath: repoRoot, timezone: 'Europe/Zurich' });
  config.limits.maxContextFileBytes = 100;
  // A pattern added after the capture: the old test report must be withheld now (I-05).
  config.secrets.extraPatterns = ['failures="1"'];
  config.context.files = ['docs/anforderungen.md', 'fehlt.md', 'gross.md', 'geheim.md', `${workspaceDir}/bild.bin`];
  const ctx: WorkspaceContext = {
    dataRoot: await createTempDir('daten'),
    repoRoot,
    repositoryId: manifest.repositoryId,
    workspaceDir,
    config,
    clock: { now: () => new Date('2026-10-14T10:05:00+02:00') },
    runId: 'R20261014T080500Z-a3f9',
  };
  return { ctx, notes, marker };
}

describe('Eingabepaket aus einem festen Manifest (spec.md §9.6, §12.2)', () => {
  it('übernimmt nur Belege für Claude mit Inhalt, Notizen des Zeitraums oder mit Verweis und geprüften Kontext', async () => {
    const { ctx, notes, marker } = await fixedWorkspace();
    const warnings: string[] = [];
    const input = await buildAnalysisInput(ctx, 'S000002', { onWarning: (message) => warnings.push(message) });
    expect(validate('analysis-input', input)).toEqual({ ok: true });

    expect(input.evidence.map((entry) => [entry.id, entry.kind, entry.content === null ? null : 'inhalt', entry.omitted?.reason ?? null])).toEqual([
      ['E001', 'commit_message', 'inhalt', null],
      ['E003', 'state_delta', 'inhalt', null],
      ['E004', 'state_delta', null, 'secret_suspected'],
      ['E005', 'state_delta', null, 'binary'],
      ['E006', 'test_report', 'inhalt', null],
      ['E007', 'test_report', null, 'secret_suspected'],
    ]);
    expect(input.evidence.find((entry) => entry.id === 'E007')?.omitted).toEqual({ reason: 'secret_suspected', detector: 'custom' });
    expect(input.evidence[1]?.content).toBe(fixedContents()['E003']);
    expect(input.evidence.every((entry) => !('file' in entry))).toBe(true);
    expect(input.commits[0]?.files[0]).not.toHaveProperty('blob');

    // (from, to]: the note at `from` is outside, the one at `to` inside; E999 is ignored with a warning.
    expect(input.notes.map((entry) => entry.id)).toEqual(['N20261014T071500Z-0002', 'N20261014T080312Z-0003', 'N20261014T090000Z-0004']);
    expect(input.notes[0]).toEqual(notes[1]);
    expect(noteSha256(input.notes[0]!)).toMatch(/^[0-9a-f]{64}$/);
    expect(warnings).toContain('Warnung: Notiz N20261014T090100Z-0005 verweist auf den unbekannten Beleg S000002:E999; der Verweis wird ignoriert.');

    expect(input.context).toEqual([{ id: 'C01', path: 'docs/anforderungen.md', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), content: '# Anforderungen\n' }]);
    expect(warnings.filter((message) => message.startsWith('Hinweis: Kontextdatei'))).toHaveLength(4);
    expect(input.filterSummary).toEqual({
      excluded: 1,
      withheld: 4,
      omitted: 4,
      byReason: { excluded: 1, secret_suspected: 4, binary: 2, unreadable: 1, file_too_large: 1 },
    });
    expect(input.allowedEvidenceIds).toEqual([
      'E001',
      'E003',
      'E004',
      'E005',
      'E006',
      'E007',
      'N20261014T071500Z-0002',
      'N20261014T080312Z-0003',
      'N20261014T090000Z-0004',
      'C01',
    ]);

    const text = serializeInput(input);
    expect(text).not.toContain(marker);
    expect(text).not.toContain('secrets/zugang.txt');
    expect(text).not.toContain('failures="1"');
    expect(`${warnings.join('\n')}`).not.toContain(marker);
  });
});
