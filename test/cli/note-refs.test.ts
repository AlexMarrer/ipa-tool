import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/notes/types.js';
import { captureOnly, ipa, pipelineRepo } from '../helpers/analysis.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';
import { evidenceFor, readManifestFile } from '../helpers/snapshots.js';

async function notesIn(workspace: string): Promise<Note[]> {
  const notes: Note[] = [];
  for (const file of await readdir(`${workspace}/notes`).catch(() => [])) {
    const lines = (await readFile(`${workspace}/notes/${file}`, 'utf8')).split('\n').filter((line) => line !== '');
    notes.push(...lines.map((line) => JSON.parse(line) as Note));
  }
  return notes;
}

describe('ipa note ab Paket 06 (D-23)', () => {
  it('speichert --ref auf einen vorhandenen Beleg; ein unbekannter Snapshot oder Beleg ergibt Exit-Code 2 (AK-06-19)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    const delta = evidenceFor(await readManifestFile(env.workspace, 'S000002'), 'state_delta', 'a.txt').id;

    const ok = await ipa(env, ['note', '--type', 'activity', '--ref', `S000002:${delta}`, 'Zweite Zeile ergänzt']);
    expect(ok.result.exitCode, ok.result.stderr).toBe(0);
    expect(ok.result.stdout).toMatch(new RegExp(`Verweise:\\s+S000002:${delta}`));
    expect((await notesIn(env.workspace)).map((note) => note.refs)).toEqual([[`S000002:${delta}`]]);

    for (const [ref, expected] of [
      ['S000009:E001', 'Den Snapshot S000009 gibt es nicht'],
      ['S000002:E999', 'Snapshot S000002 hat keinen Beleg E999'],
      // Evidence of another snapshot: the baseline of a clean repository has none.
      [`S000001:${delta}`, `Snapshot S000001 hat keinen Beleg ${delta}`],
    ] as const) {
      const bad = await ipa(env, ['note', '--ref', ref, 'Verweis']);
      expect(bad.result.exitCode, ref).toBe(2);
      expect(bad.result.stderr, ref).toContain(expected);
    }
    expect(await notesIn(env.workspace)).toHaveLength(1);
  });

  it('speichert eine Notiz mit künstlichem Secret und warnt mit Detektorname, ohne den Wert auszugeben (AK-06-20)', async () => {
    const env = await pipelineRepo();
    const marker = createSecretMarker();
    const { result } = await ipa(env, ['note', '--type', 'problem', '--cause', secretAssignment(marker), 'Anmeldung schlug fehl']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Notiz gespeichert.');
    expect(result.stderr).toContain('Detektor assignment in cause');
    expect(result.stderr).toContain('nie an Claude übermittelt');
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
    const [note] = await notesIn(env.workspace);
    expect(note?.cause).toBe(secretAssignment(marker));

    const clean = await ipa(env, ['note', 'Ohne Secret']);
    expect(clean.result.exitCode).toBe(0);
    expect(clean.result.stderr).toBe('');
  });
});
