import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '../../src/core/context.js';
import { addNote } from '../../src/notes/store.js';
import type { Note, NoteInput } from '../../src/notes/types.js';
import { attemptFiles, captureOnly, filesWith, inputOf, ipa, type PipelineEnv, pipelineRepo, recordOf, statusOf } from '../helpers/analysis.js';
import { createSecretMarker, filesContaining, secretAssignment } from '../helpers/secrets.js';
import { evidenceFor, readManifestFile } from '../helpers/snapshots.js';

const EXCLUDED_NAME = 'zugang-ipa-exklusiv.txt';

/** A note recorded at `at` through the real `addNote` with an injected clock. */
async function noteAt(env: PipelineEnv, at: number, input: NoteInput): Promise<Note> {
  const ctx = await resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true, clock: { now: () => new Date(at) } });
  return addNote(ctx, input);
}

describe('Filter und Secrets im Eingabepaket (spec.md §12.2, §14.6)', () => {
  it('übermittelt weder ausgeschlossene Pfade noch zurückgehaltene Inhalte; filterSummary zählt sie (AK-06-10)', async () => {
    const env = await pipelineRepo();
    const marker = createSecretMarker();
    await env.repo.write(`geheim/secrets/${EXCLUDED_NAME}`, `${marker}\n`);
    await env.repo.write('.env', `${secretAssignment(marker)}\n`);
    await env.repo.write('src/einstellungen.ts', `export const ${secretAssignment(marker)};\n`);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await env.repo.git('add', '-A');
    await env.repo.git('commit', '-q', '-m', `Einstellungen ${secretAssignment(marker)}`);

    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    const input = inputOf(modelCalls[0]);
    const stdin = modelCalls[0]?.stdin ?? '';
    for (const needle of [marker, EXCLUDED_NAME, '.env']) {
      expect(stdin.includes(needle), needle).toBe(false);
      expect(await filesWith(await attemptFiles(env.workspace), needle), needle).toEqual([]);
    }
    expect(await filesContaining(env.dataDir, marker)).toEqual([]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);

    expect(input.filterSummary.excluded).toBeGreaterThanOrEqual(2);
    expect(input.filterSummary.byReason.excluded).toBe(input.filterSummary.excluded);
    // Commit message, commit diff and state delta of the file with the secret.
    expect(input.filterSummary.withheld).toBeGreaterThanOrEqual(3);
    expect(input.filterSummary.byReason.secret_suspected).toBe(input.filterSummary.withheld);
    const message = input.evidence.find((entry) => entry.kind === 'commit_message');
    expect(message).toMatchObject({ content: null, omitted: { reason: 'secret_suspected' } });
    expect(input.evidence.find((entry) => entry.path === 'src/einstellungen.ts')).toMatchObject({ content: null, omitted: { reason: 'secret_suspected' } });
    expect(input.allowedEvidenceIds).toContain(message?.id);
    expect(((await statusOf(env))['withheld'] as { units: number }).units).toBeGreaterThanOrEqual(3);
  });

  it('enthält genau die Notizen des Beobachtungszeitraums und mit Verweis, ohne Notizen mit Secret (AK-06-11)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    // Timestamps have whole seconds: without a pause `from` may equal `to`, and (from, to] is empty.
    await setTimeout(1100);
    await captureOnly(env);
    const manifest = await readManifestFile(env.workspace, 'S000002');
    const from = Date.parse(manifest.observedPeriod.from!);
    const to = Date.parse(manifest.observedPeriod.to);
    expect(to).toBeGreaterThan(from);
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt').id;
    const marker = createSecretMarker();

    const atTo = await noteAt(env, to, { type: 'activity', text: 'Am Ende des Zeitraums erfasst' });
    await noteAt(env, from, { type: 'general', text: 'Genau am Beginn, also ausserhalb' });
    const referencing = await noteAt(env, to + 60_000, { type: 'insight', text: 'Später mit Verweis', refs: [`S000002:${delta}`] });
    await noteAt(env, to + 120_000, { type: 'general', text: 'Später ohne Verweis' });
    await noteAt(env, to + 180_000, { type: 'general', text: `Mit Verweis ${secretAssignment(marker)}`, refs: [`S000002:${delta}`] });
    await noteAt(env, from + 1000, { type: 'decision', text: 'Im Zeitraum', reason: `Grund ${secretAssignment(marker)}` });

    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    const input = inputOf(modelCalls[0]);
    expect(input.notes.map((note) => note.id)).toEqual([atTo.id, referencing.id]);
    expect(input.allowedEvidenceIds).toEqual(expect.arrayContaining([atTo.id, referencing.id]));
    expect(input.filterSummary.withheld).toBe(2);
    expect(input.filterSummary.byReason.secret_suspected).toBe(2);
    expect(await filesWith(await attemptFiles(env.workspace), marker)).toEqual([]);
    expect(modelCalls[0]?.stdin).not.toContain(marker);

    // The notes may lie in different day files when the test runs around midnight.
    const lineSha = async (note: Note) => {
      const lines = (await readFile(`${env.workspace}/notes/${note.activityDay}.jsonl`, 'utf8')).split('\n');
      return createHash('sha256').update(lines.find((line) => line.includes(`"id":"${note.id}"`))!).digest('hex');
    };
    const record = await recordOf(env.workspace, 'S000002');
    expect(record.provenance).toMatchObject({
      notesUsed: [
        { id: atTo.id, sha256: await lineSha(atTo) },
        { id: referencing.id, sha256: await lineSha(referencing) },
      ],
    });
    expect(record.evidenceIndex).toEqual(expect.arrayContaining([{ id: atTo.id, kind: 'note', path: null, snapshotFile: null }]));
    // Withheld notes stay an open review in status (spec.md §12.2).
    expect((await statusOf(env))['withheld']).toMatchObject({ notes: 2 });
  });
});
