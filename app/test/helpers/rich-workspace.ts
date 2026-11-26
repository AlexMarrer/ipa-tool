/**
 * Workspaces for reader tests, created by the real CLI with the fake Claude CLI (app spec §17). Hand edits are
 * limited to edge cases (a period over several days, a defective line, a halt of type head_missing).
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { todayIn, shiftDay } from '../../src/shared/dates';
import { git, initProject, runCli, type InitializedProject, type TestEnv } from './env';

export const SECRET_MARKER = 'IPA_TEST_SECRET_0123456789abcdef';
export const TIMEZONE = 'Europe/Zurich';

/** Timestamps in CLI files have no fractional seconds (schema pattern). */
const iso = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function expectOk(result: { exitCode: number; stderr: string; stdout: string }, what: string, allowed: number[] = [0]): Promise<void> {
  if (!allowed.includes(result.exitCode)) throw new Error(`${what} endete mit ${result.exitCode}: ${result.stderr}${result.stdout}`);
}

export interface StatesWorkspace {
  project: InitializedProject;
  today: string;
  yesterday: string;
}

/**
 * Statuses complete (AI and baseline), exhausted, failed, skipped, pending and not_required, notes of every type
 * (one with a secret hit, one on another day, one with a reference), journals with and without AI, one period over
 * several days and defective lines.
 */
export async function buildStatesWorkspace(env: TestEnv): Promise<StatesWorkspace> {
  const project = await initProject(env, 'zustaende');
  const { repo } = project;
  const run = (args: string[], extra: Record<string, string> = {}) => runCli(env, repo.root, args, extra);

  await repo.write('src/a.ts', 'export const a = 1;\n');
  await expectOk(await run(['capture']), 'capture (S000002)');
  for (const name of ['b', 'c', 'd', 'e', 'f']) {
    await repo.write(`src/${name}.ts`, `export const ${name} = 1;\n`);
    await expectOk(await run(['capture', '--no-analysis']), `capture --no-analysis (${name})`);
  }
  // Three failures exhaust S000003. An exhausted snapshot stops the queue, so S000004 and later stay pending.
  for (let attempt = 1; attempt <= 3; attempt += 1) await expectOk(await run(['capture'], { FAKE_CLAUDE_MODE: 'invalid-json' }), `capture ${attempt} (ungültige Antwort)`, [6]);
  await expectOk(await run(['skip', 'S000005', '--reason', 'Test: bewusst ausgelassen']), 'skip');
  await repo.commit('alles committen');
  await expectOk(await run(['capture', '--no-analysis']), 'capture nach Commit');

  const today = todayIn(TIMEZONE);
  const yesterday = shiftDay(today, -1);
  const manifest = JSON.parse(await readFile(`${project.workspacePath}/snapshots/S000002/manifest.json`, 'utf8')) as { evidence: { id: string }[] };
  const ref = `S000002:${manifest.evidence[0]?.id ?? 'E001'}`;
  const notes: string[][] = [
    ['--type', 'activity', '--minutes', '45', '--measured', 'Implementierung der Projektliste'],
    ['--type', 'activity', '--start', '09:10', '--end', '09:55', '--measured', '--ref', ref, 'Pair-Programming am Runner'],
    ['--type', 'problem', '--delay', '20', '--estimated', '--cause', 'Lock-Datei blieb liegen', '--solution', 'Toten Lock erkannt', 'Der Lauf blieb hängen'],
    ['--type', 'decision', '--reason', 'Kleinere Angriffsfläche', '--alternative', 'Tauri', '--alternative', 'NW.js', 'Electron statt Tauri'],
    ['--type', 'insight', 'Sandbox verlangt einen Preload als CommonJS'],
    ['--type', 'general', 'Kurzes Gespräch mit dem Betreuer'],
    ['--type', 'plan', '--minutes', '60', '--estimated', 'Notizdialog planen'],
    ['--type', 'activity', `api_key = "${SECRET_MARKER}" in der Konfiguration gefunden`],
    ['--type', 'activity', '--day', yesterday, '--minutes', '30', '--estimated', 'Recherche am Vortag'],
  ];
  for (const args of notes) {
    const [text, ...rest] = [args.at(-1) as string, ...args.slice(0, -1)];
    await expectOk(await run(['note', ...rest, '--', text]), `note ${text.slice(0, 20)}`);
  }
  await expectOk(await run(['journal'], { FAKE_CLAUDE_MODE: 'journal' }), 'journal (KI)', [0, 6]);
  await expectOk(await run(['journal', '--no-ai']), 'journal --no-ai');

  // Edge cases by hand: S000006 observed over two days.
  const file = `${project.workspacePath}/snapshots/S000006/manifest.json`;
  const edited = JSON.parse(await readFile(file, 'utf8')) as { observedPeriod: { from: string | null; to: string } };
  edited.observedPeriod.from = iso(new Date(Date.parse(edited.observedPeriod.to) - 26 * 3_600_000));
  await writeFile(file, JSON.stringify(edited, null, 2));
  await appendFile(`${project.workspacePath}/notes/${today}.jsonl`, '{kaputt\n');
  await appendFile(`${project.workspacePath}/runs.jsonl`, '{kaputt\n');
  return { project, today, yesterday };
}

/** One snapshot with a single failed attempt (status `failed`). */
export async function buildFailedWorkspace(env: TestEnv): Promise<InitializedProject> {
  const project = await initProject(env, 'fehlgeschlagen');
  await project.repo.write('src/a.ts', 'export const a = 1;\n');
  await expectOk(await runCli(env, project.repo.root, ['capture'], { FAKE_CLAUDE_MODE: 'invalid-json' }), 'capture (ungültige Antwort)', [6]);
  return project;
}

/** One snapshot that is `blocked`: its input exceeds the limit. */
export async function buildBlockedWorkspace(env: TestEnv): Promise<InitializedProject> {
  const project = await initProject(env, 'blockiert');
  const file = `${project.workspacePath}/config.json`;
  const config = JSON.parse(await readFile(file, 'utf8')) as { limits: { maxAnalysisInputBytes: number } };
  config.limits.maxAnalysisInputBytes = 1000;
  await writeFile(file, JSON.stringify(config, null, 2));
  await project.repo.write('gross.txt', `${'x'.repeat(30_000)}\n`);
  await expectOk(await runCli(env, project.repo.root, ['capture']), 'capture (blockiert)', [6]);
  return project;
}

export type HaltKind = 'branch_changed' | 'history_rewritten' | 'head_missing';

/** A project in halt; the first two reasons come from the real CLI, `head_missing` is a hand-written state. */
export async function buildHaltWorkspace(env: TestEnv, kind: HaltKind, name = `halt-${kind.replace('_', '-')}`): Promise<InitializedProject> {
  const project = await initProject(env, name);
  const { repo } = project;
  const run = (args: string[]) => runCli(env, repo.root, args);
  await repo.write('src/a.ts', 'export const a = 1;\n');
  await expectOk(await run(['capture', '--no-analysis']), 'capture');
  if (kind === 'branch_changed') {
    await git(repo.root, 'checkout', '-q', '-b', 'anderer-branch');
    await expectOk(await run(['capture', '--no-analysis']), 'capture (Branch)', [4]);
  } else if (kind === 'history_rewritten') {
    await repo.commit('Stand');
    await expectOk(await run(['capture', '--no-analysis']), 'capture nach Commit');
    await git(repo.root, 'commit', '-q', '--amend', '-m', 'umgeschrieben');
    await expectOk(await run(['capture', '--no-analysis']), 'capture (Historie)', [4]);
  } else {
    const file = `${project.workspacePath}/state.json`;
    const state = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    state['halt'] = {
      reason: 'head_missing',
      detectedAt: iso(new Date()),
      expected: { branch: 'main', head: 'a'.repeat(40) },
      observed: { branch: 'main', head: null },
    };
    await writeFile(file, JSON.stringify(state, null, 2));
  }
  return project;
}

/** A halt followed by `ipa baseline`: the new baseline snapshot carries a `rebaseline` gap. */
export async function buildRebaselineWorkspace(env: TestEnv): Promise<InitializedProject> {
  const project = await buildHaltWorkspace(env, 'branch_changed', 'neuer-ausgangspunkt');
  await expectOk(await runCli(env, project.repo.root, ['baseline', '--reason', 'Neuer Branch ist gewollt']), 'baseline');
  return project;
}
