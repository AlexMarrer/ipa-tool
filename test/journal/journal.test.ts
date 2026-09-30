/**
 * Integration tests of `ipa journal` (package 07 §8) with a real test repository, the fake Claude CLI
 * and an injected clock.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { noteSha256 } from '../../src/analysis/input.js';
import type { AttemptOutcomeRecord } from '../../src/analysis/types.js';
import { PRINT_PROMPTS } from '../../src/claude/args.js';
import type { AiUsageRecord } from '../../src/claude/usage.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { isSameOrInside } from '../../src/core/paths.js';
import { JOURNAL_PROMPT_PATH } from '../../src/journal/generate.js';
import { AI_NOTICE, NO_AI_NOTICE, SECTION_TITLES } from '../../src/journal/render.js';
import type { JournalOutput } from '../../src/journal/types.js';
import { namesIn, runsOf, startLockHolder, stopLockHolder } from '../helpers/analysis.js';
import { captureAt, draftOf, draftsOf, inputOfCall, journalAt, journalInputOf, journalRepo, noteAt } from '../helpers/journal.js';
import { readManifestFile, unchanged } from '../helpers/snapshots.js';
import { filesContaining } from '../helpers/secrets.js';
import { listTree, readJsonFile, runCli, TOOL_ROOT } from '../helpers/workspace.js';
import { bracketRefs, headings, section } from './markdown.js';

const DAY = '2026-10-14';
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const measured = (minutes: number) => ({ minutes, basis: 'measured' as const, start: null, end: null });
const estimated = (minutes: number) => ({ minutes, basis: 'estimated' as const, start: null, end: null });

/** Day with a change analysed by the fake CLI at 10:00 and an activity note. */
async function analysedDay() {
  const env = await journalRepo(`${DAY}T08:00:00+02:00`);
  await env.repo.write('a.txt', 'eins\nzwei\n');
  const capture = await captureAt(env, `${DAY}T10:00:00+02:00`, 'analysis');
  expect(capture.exitCode).toBe(0);
  const activity = await noteAt(env, `${DAY}T11:00:00+02:00`, { type: 'activity', text: 'Service für die Wortvalidierung umgebaut', time: measured(45) });
  const manifest = await readManifestFile(env.workspace, 'S000002');
  const delta = manifest.evidence.find((entry) => entry.kind === 'state_delta');
  if (delta === undefined) throw new Error('Kein Zustandsdelta in S000002');
  return { env, activity, deltaRef: `S000002:${delta.id}` };
}

async function outcomeOfRun(workspace: string, runId: string): Promise<AttemptOutcomeRecord> {
  return readJsonFile<AttemptOutcomeRecord>(`${workspace}/journal/runs/${runId}/outcome.json`);
}

describe('ipa journal mit Claude (Paket 07)', () => {
  it('erzeugt an einem Tag mit Analyse und Notizen .md und .json; alle Abschnitte in fester Reihenfolge, jede Referenz in sources (AK-07-01, AK-07-12)', async () => {
    const { env, activity, deltaRef } = await analysedDay();
    const decision = await noteAt(env, `${DAY}T11:05:00+02:00`, { type: 'decision', text: 'Validierung im Service', reason: 'Zwei Komponenten nutzen sie' });

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.modelCalls).toHaveLength(1);
    expect(run.modelCalls[0]?.args?.slice(0, 2)).toEqual(['-p', PRINT_PROMPTS.journal]);
    expect(await draftsOf(env.workspace)).toEqual([`${DAY}-${run.runId}.json`, `${DAY}-${run.runId}.md`]);
    expect(run.stdout).toContain(`Journal-Entwurf für ${DAY} gespeichert: KI-Entwurf mit Claude.`);
    expect(run.stdout).toContain(`journal/drafts/${DAY}-${run.runId}.md`);

    const { markdown, record } = await draftOf(env, DAY, run.runId);
    expect(markdown.split('\n')[2]).toBe(`> ${AI_NOTICE}`);
    expect(headings(markdown)).toEqual([...SECTION_TITLES]);
    expect(record).toMatchObject({
      day: DAY,
      runId: run.runId,
      generatedAt: '2026-10-14T18:00:00+02:00',
      mode: 'ai',
      provenance: { promptVersion: 'journal@1', outputSchemaVersion: 'journal-output@1', cliVersion: '9.9.9', models: ['claude-fake-model'], runDir: `journal/runs/${run.runId}` },
    });
    const shown = [...new Set(bracketRefs(markdown))].sort();
    expect(shown.length).toBeGreaterThan(0);
    expect(record.sources.map((source) => source.ref).sort()).toEqual(shown);
    expect(record.sources.find((source) => source.ref === deltaRef)).toEqual({
      ref: deltaRef,
      kind: 'state_delta',
      path: 'a.txt',
      snapshotId: 'S000002',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(record.sources.find((source) => source.ref === activity.id)).toEqual({ ref: activity.id, kind: 'note', path: null, snapshotId: null, sha256: noteSha256(activity) });
    expect(section(markdown, 'Ausgeführte Arbeiten')).toBe(
      [`- Service für die Wortvalidierung umgebaut [${activity.id}]`, `- Änderung an a.txt [${deltaRef}]`].join('\n'),
    );
    expect(section(markdown, 'Entscheidungen')).toContain(`**Validierung im Service** (Begründung: Zwei Komponenten nutzen sie; Alternativen: nicht erfasst) [${decision.id}]`);
    // Times only from notes: the snapshot period 08:00–10:00 counts nowhere (I-07).
    expect(record.timeSummary.totals).toEqual({ measuredMinutes: 45, estimatedMinutes: 0 });

    const runDir = `${env.workspace}/journal/runs/${run.runId}`;
    expect(await namesIn(runDir)).toEqual(['input.json', 'outcome.json', 'prompt.md', 'response.json', 'schema.json', 'stderr.txt']);
    expect(sha256(await readFile(`${runDir}/input.json`))).toBe(run.modelCalls[0]?.stdinSha256);
    expect(await readFile(`${runDir}/prompt.md`, 'utf8')).toBe(await readFile(JOURNAL_PROMPT_PATH, 'utf8'));
    expect(await outcomeOfRun(env.workspace, run.runId)).toMatchObject({ snapshotId: null, runId: run.runId, attempt: 1, outcome: 'success', errorCode: null });
    const input = await journalInputOf(env, run.runId);
    expect(input).toMatchObject({ purpose: 'journal', promptVersion: 'journal@1', day: DAY, timezone: 'Europe/Zurich' });
    expect(input.analyses.map((entry) => [entry.snapshotId, entry.dayAttribution, entry.derived === null])).toEqual([['S000002', 'day', false]]);
    expect(input.analyses[0]?.derived?.implemented[0]?.evidence).toEqual([deltaRef]);

    // One line per model call in ai-usage.jsonl, and no entry in runs.jsonl (spec.md §18).
    const usage = (await readJsonl<AiUsageRecord>(`${env.workspace}/ai-usage.jsonl`, 'ai-usage')).records.filter((line) => line.purpose === 'journal');
    expect(usage).toEqual([
      expect.objectContaining({
        runId: run.runId,
        subjectId: DAY,
        promptVersion: 'journal@1',
        outputSchemaVersion: 'journal-output@1',
        outcome: 'success',
        inputSha256: run.modelCalls[0]?.stdinSha256,
        inputIds: input.allowedEvidenceIds,
      }),
    ]);
    expect((await runsOf(env.workspace)).map((line) => line.command)).not.toContain('journal');
  });

  it('erzeugt an einem Tag nur mit Notizen einen Entwurf; Zeiten gemessen und geschätzt getrennt, Verzögerung separat (AK-07-02)', async () => {
    const env = await journalRepo('2026-10-13T08:00:00+02:00');
    await noteAt(env, `${DAY}T10:00:00+02:00`, { type: 'activity', text: 'Recherche zur Testkonfiguration', time: measured(45) });
    await noteAt(env, `${DAY}T11:00:00+02:00`, { type: 'activity', text: 'Dokumentation zu Vitest gelesen', time: estimated(30) });
    await noteAt(env, `${DAY}T12:00:00+02:00`, { type: 'problem', text: 'Proxy blockierte den Download', delay: { minutes: 20, basis: 'estimated' } });

    const run = await journalAt(env, `${DAY}T17:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    const input = inputOfCall(run.modelCalls[0]);
    expect(input.analyses).toEqual([]);
    expect(input.commits).toEqual([]);
    expect(input.timeSummary).toMatchObject({
      totals: { measuredMinutes: 45, estimatedMinutes: 30 },
      delayTotals: { measuredMinutes: 0, estimatedMinutes: 20 },
    });
    expect(input.timeSummary.entries).toHaveLength(2);
    expect(input.openItems.gaps.map((gap) => gap.type)).toEqual(['no_capture']);

    const { markdown, record } = await draftOf(env, DAY, run.runId);
    const time = section(markdown, 'Zeitaufwand');
    expect(time).toContain('- Summe gemessen: 45 Minuten\n- Summe geschätzt: 30 Minuten');
    expect(time).toMatch(/- Verzögerung \(separat, nicht zusätzlich summiert\): 20 Minuten geschätzt \[N\d{8}T\d{6}Z-[0-9a-f]{4}\]/);
    expect(time).not.toMatch(/Gesamt|75 Minuten|95 Minuten|65 Minuten|50 Minuten/);
    expect(record.timeSummary).toEqual(input.timeSummary);
    expect(section(markdown, 'Ausgeführte Arbeiten')).toContain('Recherche zur Testkonfiguration');
  });

  it('lässt frühere Entwürfe und die persönliche Endfassung byte-gleich; zwei Läufe in derselben Sekunde ergeben zwei Entwürfe (AK-07-03)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await noteAt(env, `${DAY}T09:00:00+02:00`, { type: 'activity', text: 'Recherche' });
    const finalFile = `${env.workspace}/journal/final/${DAY}.md`;
    await writeFile(finalFile, '# Meine Endfassung\n\nPersönlich überarbeitet.\n');
    const finalBefore = await listTree(`${env.workspace}/journal/final`);

    const first = await journalAt(env, `${DAY}T18:00:00+02:00`, { noAi: true });
    expect(first.exitCode, first.stderr).toBe(0);
    const firstDrafts = await listTree(`${env.workspace}/journal/drafts`);
    expect(Object.keys(firstDrafts)).toHaveLength(2);

    const second = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(second.runId).not.toBe(first.runId);
    expect(second.runId.slice(0, 17)).toBe(first.runId.slice(0, 17));
    const after = await listTree(`${env.workspace}/journal/drafts`);
    expect(Object.keys(after)).toHaveLength(4);
    for (const [name, entry] of Object.entries(firstDrafts)) expect(after[name], name).toEqual(entry);
    expect(await listTree(`${env.workspace}/journal/final`)).toEqual(finalBefore);
  });

  it('liest weder frühere Entwürfe noch die Endfassung; allowedEvidenceIds sind nur Original-Belege, Notizen und Kontext (AK-07-04, I-10)', async () => {
    const { env } = await analysedDay();
    await writeFile(`${env.repo.root}/../anforderungen.md`, '# Anforderungen\n');
    const config = await readJsonFile<Record<string, { files: string[] }>>(`${env.workspace}/config.json`);
    await writeFile(`${env.workspace}/config.json`, JSON.stringify({ ...config, context: { files: ['../anforderungen.md'] } }, null, 2));
    const marker = `IPA_TEST_MARKER_${randomBytes(6).toString('hex')}`;
    await writeFile(`${env.workspace}/journal/drafts/${DAY}-R20261014T120000Z-0000.md`, `# Alter Entwurf\n\n- ${marker}\n`);
    await writeFile(`${env.workspace}/journal/drafts/${DAY}-R20261014T120000Z-0000.json`, JSON.stringify({ text: marker }));
    await writeFile(`${env.workspace}/journal/final/${DAY}.md`, `# Endfassung ${marker}\n`);

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(await filesContaining(`${env.workspace}/journal/runs`, marker)).toEqual([]);
    expect(run.modelCalls[0]?.stdin).not.toContain(marker);
    const { markdown } = await draftOf(env, DAY, run.runId);
    expect(markdown).not.toContain(marker);

    const input = await journalInputOf(env, run.runId);
    const manifest = await readManifestFile(env.workspace, 'S000002');
    expect(input.context.map((entry) => entry.id)).toEqual(['C01']);
    for (const id of input.allowedEvidenceIds) {
      if (id.startsWith('S')) {
        const [snapshotId, evidenceId] = id.split(':');
        expect(snapshotId).toBe('S000002');
        expect(manifest.evidence.some((entry) => entry.id === evidenceId), id).toBe(true);
        expect(input.evidence.some((entry) => entry.ref === id), id).toBe(true);
      } else if (id.startsWith('N')) {
        expect(input.notes.some((note) => note.id === id), id).toBe(true);
      } else {
        expect(input.context.some((entry) => entry.id === id), id).toBe(true);
      }
    }
    expect(input.allowedEvidenceIds).toContain('C01');
  });

  it('endet bei einem Fehler der Fake-CLI mit Exit-Code 6 ohne Entwurf; --no-ai erzeugt dann ohne Claude einen Entwurf (AK-07-07)', async () => {
    const { env } = await analysedDay();
    const failing = await journalAt(env, `${DAY}T18:00:00+02:00`, { mode: 'error-result' });
    expect(failing.exitCode).toBe(6);
    expect(failing.stderr).toContain(`Fehler: Kein Journal-Entwurf für ${DAY} (error_result)`);
    expect(failing.stderr).toContain(`ipa journal --day ${DAY} --no-ai`);
    expect(failing.stdout).toBe('');
    expect(await draftsOf(env.workspace)).toEqual([]);
    expect(await namesIn(`${env.workspace}/journal/runs/${failing.runId}`)).toEqual(['input.json', 'outcome.json', 'prompt.md', 'response.json', 'schema.json', 'stderr.txt']);
    expect(await outcomeOfRun(env.workspace, failing.runId)).toMatchObject({ outcome: 'claude_error', errorCode: 'error_result' });
    const usage = (await readJsonl<AiUsageRecord>(`${env.workspace}/ai-usage.jsonl`, 'ai-usage')).records.filter((line) => line.purpose === 'journal');
    expect(usage).toEqual([expect.objectContaining({ runId: failing.runId, outcome: 'claude_error', errorCode: 'error_result' })]);

    // The shipped entry point with --no-ai: no Claude process at all.
    const fallback = await unchanged(env.repo, () => runCli(['journal', '--day', DAY, '--no-ai'], { dataDir: env.dataDir, repo: env.repo.root }));
    expect(fallback.exitCode, fallback.stderr).toBe(0);
    expect(fallback.stdout).toContain(`Journal-Entwurf für ${DAY} gespeichert: ohne KI, --no-ai.`);
    const drafts = await draftsOf(env.workspace);
    expect(drafts).toHaveLength(2);
    const runId = drafts[0]!.slice(DAY.length + 1, -'.json'.length);
    const { markdown, record } = await draftOf(env, DAY, runId);
    expect(record).toMatchObject({ mode: 'no_ai', journal: null, provenance: { deterministic: true, reason: 'requested' } });
    expect(markdown.split('\n')[2]).toBe(`> ${NO_AI_NOTICE}`);
    expect(section(markdown, 'Ausgeführte Arbeiten')).toContain('aus Work-Log übernommen (S000002)');
    expect(await namesIn(`${env.workspace}/journal/runs`)).toEqual([failing.runId]);
    expect((await readJsonl<AiUsageRecord>(`${env.workspace}/ai-usage.jsonl`, 'ai-usage')).records.filter((line) => line.purpose === 'journal')).toHaveLength(1);

    const fake = await journalAt(env, `${DAY}T19:00:00+02:00`, { noAi: true });
    expect(fake.exitCode).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('lehnt Antworten mit unbekannter Referenz, passed ohne frischen Bericht, Begründung ohne Beleg oder done ohne passenden Beleg ab (AK-07-08)', async () => {
    const env = await journalRepo('2026-10-13T08:00:00+02:00');
    const yesterday = await noteAt(env, '2026-10-13T16:00:00+02:00', { type: 'activity', text: 'Arbeit von gestern' });
    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await captureAt(env, `${DAY}T09:00:00+02:00`)).exitCode).toBe(0);
    await env.repo.write('a.txt', 'eins\nzwei\ndrei\n');
    expect((await captureAt(env, `${DAY}T10:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    const plan = await noteAt(env, `${DAY}T10:30:00+02:00`, { type: 'plan', text: 'Service fertigstellen' });
    const manifest = await readManifestFile(env.workspace, 'S000003');
    const delta = `S000003:${manifest.evidence.find((entry) => entry.kind === 'state_delta')!.id}`;

    const empty: JournalOutput = { planned: [], done: [], problems: [], decisions: [], tests: [], deviations: [], insights: [], nextSteps: [], unknowns: [] };
    const cases: [string, Partial<JournalOutput>, string][] = [
      ['Notiz eines anderen Tages', { insights: [{ text: 'Erkenntnis', evidence: [yesterday.id] }] }, 'evidence_invalid'],
      ['passed ohne frischen Bericht', { tests: [{ description: 'Tests', result: 'passed', evidence: [delta] }] }, 'rule_violation'],
      ['Begründung ohne Notiz- oder Commit-Beleg', { decisions: [{ decision: 'Service', rationale: 'Wiederverwendung', alternatives: [], evidence: [delta] }] }, 'rule_violation'],
      ['done ohne passenden Beleg', { done: [{ text: 'Service fertiggestellt', evidence: [plan.id] }] }, 'rule_violation'],
    ];
    let minute = 0;
    for (const [name, patch, errorCode] of cases) {
      minute += 1;
      const run = await journalAt(env, `${DAY}T18:0${minute}:00+02:00`, { mode: 'ok', extra: { FAKE_CLAUDE_OUTPUT: JSON.stringify({ ...empty, ...patch }) } });
      expect(run.exitCode, name).toBe(6);
      expect(run.stderr, name).toContain(`(${errorCode})`);
      expect(await outcomeOfRun(env.workspace, run.runId), name).toMatchObject({ outcome: 'validation_failed', errorCode });
    }
    expect(await draftsOf(env.workspace)).toEqual([]);
  });

  it('nimmt ohne --day den heutigen Tag der Zeitzone (Uhr 23:30 UTC); ein ungültiges --day ergibt Exit-Code 2 (AK-07-11)', async () => {
    const env = await journalRepo('2026-10-14T20:00:00Z');
    const late = await noteAt(env, '2026-10-14T23:30:00Z', { type: 'activity', text: 'Späte Recherche' });
    expect(late.activityDay).toBe('2026-10-15');

    const run = await journalAt(env, '2026-10-14T23:30:00Z', { noAi: true });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain('Journal-Entwurf für 2026-10-15 gespeichert');
    const { record, markdown } = await draftOf(env, '2026-10-15', run.runId);
    expect(record.day).toBe('2026-10-15');
    expect(record.generatedAt).toBe('2026-10-15T01:30:00+02:00');
    expect(section(markdown, 'Ausgeführte Arbeiten')).toContain(`Späte Recherche – Notiz (Tätigkeit) [${late.id}]`);

    for (const day of ['2026-02-30', '14.10.2026', '2026-10-1']) {
      const invalid = await runCli(['journal', '--day', day, '--no-ai'], { dataDir: env.dataDir, repo: env.repo.root });
      expect(invalid.exitCode, day).toBe(2);
      expect(invalid.stderr, day).toContain(`--day "${day}" ist kein gültiger Tag`);
    }
    expect(await draftsOf(env.workspace)).toHaveLength(2);

    const help = await runCli(['journal', '--help'], { dataDir: null });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('--day <YYYY-MM-DD>');
    expect(help.stdout).toContain('--no-ai');
  });

  it('läuft ohne Lock, auch wenn ein anderer Lauf ihn hält (D-16)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await noteAt(env, `${DAY}T09:00:00+02:00`, { type: 'activity', text: 'Recherche' });
    const holder = await startLockHolder(env.workspace);
    try {
      const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
      expect(run.exitCode, run.stderr).toBe(0);
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('läuft mit Arbeitsbereich .ipa im Repository; Claude arbeitet ausserhalb, das Repository bleibt ausserhalb von .ipa unverändert (AK-07-12)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`, { workspace: '.ipa' });
    expect(env.workspace).toBe(`${env.repo.root}/.ipa`);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await captureAt(env, `${DAY}T10:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    const cwd = run.modelCalls[0]!.cwd!;
    expect(isSameOrInside(cwd, env.repo.root)).toBe(false);
    expect(isSameOrInside(cwd, env.workspace)).toBe(false);
    expect(run.modelCalls[0]!.cwdFiles).toEqual(['prompt.md']);
    expect(await draftsOf(env.workspace)).toHaveLength(2);
  });

  it('greift in src/journal nie auf journal/final/ zu (I-09)', async () => {
    const sources = [
      ...(await readdir(path.join(TOOL_ROOT, 'src', 'journal'))).map((name) => path.join(TOOL_ROOT, 'src', 'journal', name)),
      path.join(TOOL_ROOT, 'src', 'cli', 'commands', 'journal.ts'),
    ];
    for (const file of sources) {
      const code = (await readFile(file, 'utf8')).split(/\r?\n/).filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));
      // The only use in code is the notice that tells the user to copy the draft there by hand.
      for (const line of code.filter((candidate) => candidate.includes('final'))) expect(line, file).toContain('journal/final/ übernehmen');
    }
  });
});
