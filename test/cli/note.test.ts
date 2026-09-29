import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { appendFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';
import { initializeWorkspace } from '../../src/core/init.js';
import { ID_PATTERNS } from '../../src/core/ids.js';
import { validate } from '../../src/core/schemas.js';
import { dayOf } from '../../src/core/time.js';
import type { Note } from '../../src/notes/types.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from '../helpers/repo-fingerprint.js';
import { createSecretMarker } from '../helpers/secrets.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, listTree, runCli, TOOL_ROOT } from '../helpers/workspace.js';

const ZURICH = 'Europe/Zurich';

/** Day in Zurich, shifted by whole days from now. */
function zurichDay(offsetDays = 0): string {
  return dayOf(new Date(Date.now() + offsetDays * 86_400_000), ZURICH);
}

async function initialized(args: string[] = []): Promise<{ repo: TempRepo; dataDir: string; workspace: string }> {
  const repo = await createTempRepo();
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir, args);
  return { repo, dataDir, workspace };
}

/** All lines of a note file; each must be a schema-valid note. */
async function notesOf(workspace: string, day: string): Promise<Note[]> {
  let text: string;
  try {
    text = await readFile(`${workspace}/notes/${day}.jsonl`, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const note = JSON.parse(line) as Note;
      expect(validate('note', note)).toEqual({ ok: true });
      return note;
    });
}

async function noteFiles(workspace: string): Promise<string[]> {
  return (await readdir(`${workspace}/notes`)).sort();
}

/** A note without the fields that differ between two otherwise identical inputs. */
function content(note: Note): Omit<Note, 'id' | 'recordedAt'> {
  const { id: _id, recordedAt: _recordedAt, ...rest } = note;
  return rest;
}

/** `ipa` in this process with injected terminal streams; all answers are written ahead. */
async function runInteractive(args: string[], answers: string[], isTTY = true) {
  const input = new PassThrough();
  input.end(answers.map((answer) => `${answer}\n`).join(''));
  const output = new PassThrough();
  let prompts = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    prompts += chunk;
  });
  let stdout = '';
  let stderr = '';
  const exitCode = await main(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    env: process.env,
    terminal: () => ({ input, output, isTTY }),
  });
  return { exitCode, stdout, stderr, prompts };
}

function startLockHolder(workspace: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [path.join(TOOL_ROOT, 'test', 'helpers', 'lock-holder.mjs'), workspace], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('LOCKED')) resolve(child);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Lock-Halter beendet (${String(code)})`)));
  });
}

async function stopLockHolder(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  await exited;
}

describe('ipa note (Paket 04)', () => {
  it('speichert eine schemagültige Notiz vom Typ general für heute, ohne den Text auszugeben (AK-04-01)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const before = await fingerprintRepo(repo.root);
    const text = 'Recherche Notiztext-Marker-7f3a';
    const dayBefore = zurichDay();
    const result = await runCli(['note', text], { dataDir, repo: repo.root });
    const dayAfter = zurichDay();
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe('');

    const day = (await noteFiles(workspace))[0]?.replace('.jsonl', '');
    expect([dayBefore, dayAfter]).toContain(day);
    const [note] = await notesOf(workspace, day!);
    expect(note).toMatchObject({ type: 'general', text, activityDay: day, time: null, delay: null, reason: null, refs: [] });
    expect(note!.id).toMatch(ID_PATTERNS.noteId);
    expect(note!.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(note!.recordedAt.startsWith(day!)).toBe(true);

    expect(result.stdout).toContain(`Notiz-ID: ${note!.id}`);
    expect(result.stdout).toMatch(new RegExp(`Tag:\\s+${day}`));
    expect(result.stdout).toMatch(/Typ:\s+general/);
    expect(result.stdout).not.toContain('Notiztext-Marker-7f3a');
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('speichert Text mit Anführungszeichen, Semikolon und Umlauten unverändert', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const text = 'Mock lieferte "falschen" Typ; Testdaten angepasst – Grösse äöü ÄÖÜ, ca. 20 Minuten Verzögerung.';
    const result = await runCli(['note', text], { dataDir, repo: repo.root });
    expect(result.exitCode, result.stderr).toBe(0);
    const day = (await noteFiles(workspace))[0]!.replace('.jsonl', '');
    expect((await notesOf(workspace, day))[0]?.text).toBe(text);
  });

  it('speichert bei decision Grund und Alternativen, ohne --reason null; --reason bei activity ergibt Exit-Code 2 (AK-04-02)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const withReason = await runCli(
      ['note', '--type', 'decision', '--day', day, '--reason', 'Wiederverwendung', '--alternative', 'A', '--alternative', 'B', 'Validierung im Service'],
      { dataDir, repo: repo.root },
    );
    expect(withReason.exitCode, withReason.stderr).toBe(0);
    const withoutReason = await runCli(['note', '--type', 'decision', '--day', day, 'Validierung im Service'], { dataDir, repo: repo.root });
    expect(withoutReason.exitCode, withoutReason.stderr).toBe(0);
    const [first, second] = await notesOf(workspace, day);
    expect(first).toMatchObject({ type: 'decision', reason: 'Wiederverwendung', alternatives: ['A', 'B'] });
    expect(second).toMatchObject({ type: 'decision', reason: null, alternatives: [] });

    const wrongType = await runCli(['note', '--type', 'activity', '--day', day, '--reason', 'weil', 'Text'], { dataDir, repo: repo.root });
    expect(wrongType.exitCode).toBe(2);
    expect(wrongType.stderr).toContain('--reason und --alternative sind nur bei --type decision erlaubt');
    expect(await notesOf(workspace, day)).toHaveLength(2);
  });

  it('speichert gemessene und geschätzte Zeiten und lehnt Zeiten ohne Basis ab (AK-04-03)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const note = (args: string[]) => runCli(['note', '--day', day, ...args], { dataDir, repo: repo.root });

    const measured = await note(['--type', 'activity', '--minutes', '45', '--measured', 'Recherche zur Testkonfiguration']);
    expect(measured.exitCode, measured.stderr).toBe(0);
    expect(measured.stdout).toMatch(/Zeit:\s+45 Minuten, gemessen/);
    const span = await note(['--type', 'activity', '--start', '09:10', '--end', '09:55', '--estimated', 'Besprechung']);
    expect(span.exitCode, span.stderr).toBe(0);
    expect((await notesOf(workspace, day)).map((entry) => entry.time)).toEqual([
      { minutes: 45, basis: 'measured', start: null, end: null },
      { minutes: 45, basis: 'estimated', start: '09:10', end: '09:55' },
    ]);

    for (const args of [
      ['--minutes', '45', 'ohne Basis'],
      ['--minutes', '0', '--measured', 'null Minuten'],
      ['--start', '09:55', '--end', '09:10', '--measured', 'rückwärts'],
      ['--start', '09:10', '--end', '09:10', '--measured', 'gleich'],
      ['--minutes', '45', '--measured', '--estimated', 'beide'],
      ['--minutes', '45', '--start', '09:10', '--end', '09:55', '--measured', 'doppelt'],
      ['--start', '09:10', '--measured', 'ohne Ende'],
    ]) {
      const result = await note(args);
      expect(result.exitCode, args.join(' ')).toBe(2);
      expect(result.stdout).toBe('');
    }
    expect(await notesOf(workspace, day)).toHaveLength(2);
  });

  it('speichert die Verzögerung getrennt von der Zeit (AK-04-04)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const onlyDelay = await runCli(['note', '--day', day, '--type', 'problem', '--delay', '20', '--estimated', 'Mock lieferte falschen Typ'], {
      dataDir,
      repo: repo.root,
    });
    expect(onlyDelay.exitCode, onlyDelay.stderr).toBe(0);
    const both = await runCli(['note', '--day', day, '--minutes', '45', '--delay', '20', '--measured', 'Integrationstest'], { dataDir, repo: repo.root });
    expect(both.exitCode, both.stderr).toBe(0);
    expect(both.stdout).toMatch(/Verzögerung:\s+20 Minuten, gemessen/);
    const [first, second] = await notesOf(workspace, day);
    expect(first).toMatchObject({ time: null, delay: { minutes: 20, basis: 'estimated' } });
    expect(second).toMatchObject({ time: { minutes: 45, basis: 'measured' }, delay: { minutes: 20, basis: 'measured' } });
    expect((await runCli(['note', '--day', day, '--delay', '20', 'ohne Basis'], { dataDir, repo: repo.root })).exitCode).toBe(2);
  });

  it('speichert vergangene Tage; ein zukünftiger Tag ist nur bei plan erlaubt (AK-04-05)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const past = zurichDay(-10);
    const future = zurichDay(3);
    expect((await runCli(['note', '--day', past, 'Nachtrag'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const futureGeneral = await runCli(['note', '--day', future, 'Zu früh'], { dataDir, repo: repo.root });
    expect(futureGeneral.exitCode).toBe(2);
    expect(futureGeneral.stderr).toContain('nur bei --type plan erlaubt');
    const plan = await runCli(['note', '--type', 'plan', '--day', future, 'Sprint planen'], { dataDir, repo: repo.root });
    expect(plan.exitCode, plan.stderr).toBe(0);
    expect((await runCli(['note', '--day', '2026-02-30', 'Kein Tag'], { dataDir, repo: repo.root })).exitCode).toBe(2);
    expect(await noteFiles(workspace)).toEqual([`${past}.jsonl`, `${future}.jsonl`].sort());
    expect(await notesOf(workspace, past)).toMatchObject([{ activityDay: past, type: 'general' }]);
    expect(await notesOf(workspace, future)).toMatchObject([{ activityDay: future, type: 'plan' }]);
  });

  it('interaktiv mit injizierten Strömen entsteht dieselbe Notiz wie direkt (AK-04-06)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const global = ['--data-dir', dataDir, '--repo', repo.root];
    const text = 'Mock lieferte falschen Typ; "Tests" rot – äöü';

    const interactive = await runInteractive([...global, 'note', '--day', day], ['problem', text, 'Falscher Datentyp', 'Testdaten angepasst', '20', 's']);
    expect(interactive.exitCode, interactive.stderr).toBe(0);
    expect(interactive.stdout).toContain('Notiz gespeichert.');
    expect(interactive.stdout).not.toContain('Falscher Datentyp');
    expect(interactive.prompts).toContain('Ursache (Enter = unbekannt)');
    const direct = await runCli(
      ['note', '--day', day, '--type', 'problem', '--cause', 'Falscher Datentyp', '--solution', 'Testdaten angepasst', '--minutes', '20', '--estimated', text],
      { dataDir, repo: repo.root },
    );
    expect(direct.exitCode, direct.stderr).toBe(0);

    const decisionAnswers = ['4', 'Validierung im Service', 'Wiederverwendung', 'Logik in der Komponente', 'Eigener Service', '', ''];
    expect((await runInteractive([...global, 'note', '--day', day], decisionAnswers)).exitCode).toBe(0);
    const directDecision = await runCli(
      ['note', '--day', day, '--type', 'decision', '--reason', 'Wiederverwendung', '--alternative', 'Logik in der Komponente', '--alternative', 'Eigener Service', 'Validierung im Service'],
      { dataDir, repo: repo.root },
    );
    expect(directDecision.exitCode, directDecision.stderr).toBe(0);

    const [problemAsked, problemDirect, decisionAsked, decisionDirect] = await notesOf(workspace, day);
    expect(content(problemAsked!)).toEqual(content(problemDirect!));
    expect(content(problemAsked!)).toMatchObject({ type: 'problem', cause: 'Falscher Datentyp', time: { minutes: 20, basis: 'estimated' } });
    expect(content(decisionAsked!)).toEqual(content(decisionDirect!));
    expect(content(decisionAsked!)).toMatchObject({ alternatives: ['Logik in der Komponente', 'Eigener Service'] });
  });

  it('ohne TTY und ohne Text endet ipa note mit Exit-Code 2 und verweist auf die direkte Eingabe (AK-04-06)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const viaCli = await runCli(['note'], { dataDir, repo: repo.root });
    expect(viaCli.exitCode).toBe(2);
    expect(viaCli.stderr).toContain('TTY');
    expect(viaCli.stderr).toContain('ipa note "');
    const withoutTty = await runInteractive(['--data-dir', dataDir, '--repo', repo.root, 'note'], ['general', 'Text'], false);
    expect(withoutTty.exitCode).toBe(2);
    expect(withoutTty.prompts).toBe('');
    expect(await noteFiles(workspace)).toEqual([]);
  });

  it('prüft --ref nur syntaktisch und speichert die Referenz (AK-04-07)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const ok = await runCli(['note', '--day', day, '--ref', 'S000001:E001', '--ref', 'S000042:E0007', 'Mit Verweis'], { dataDir, repo: repo.root });
    expect(ok.exitCode, ok.stderr).toBe(0);
    expect((await notesOf(workspace, day))[0]?.refs).toEqual(['S000001:E001', 'S000042:E0007']);
    const bad = await runCli(['note', '--day', day, '--ref', 'S1:E1', 'Kaputter Verweis'], { dataDir, repo: repo.root });
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain('S000001:E001');
    expect(bad.stderr).not.toContain('S1:E1');
    expect(await notesOf(workspace, day)).toHaveLength(1);
  });

  it('wiederholt abgelehnte Werte von --ref und --type nicht in der Ausgabe', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const marker = createSecretMarker();
    for (const args of [['--ref', marker], ['--ref', 'S000001:E001', '--ref', marker], ['--type', marker]]) {
      const result = await runCli(['note', ...args, 'Text'], { dataDir, repo: repo.root });
      expect(result.exitCode, args.join(' ')).toBe(2);
      expect(`${result.stdout}${result.stderr}`, args.join(' ')).not.toContain(marker);
    }
    expect(await noteFiles(workspace)).toEqual([]);
  });

  it('funktioniert in einem Arbeitsbereich aus Paket 01 ohne Snapshots (AK-04-08)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const created = await initializeWorkspace({ repo: repo.root, dataDir });
    const workspace = created.entry.workspacePath;
    expect(await readdir(`${workspace}/snapshots`)).toEqual([]);
    const stateBefore = await readFile(`${workspace}/state.json`, 'utf8');
    const before = await fingerprintRepo(repo.root);
    const day = zurichDay(-3);
    const today = zurichDay();

    for (const args of [
      ['note', 'Nur Text'],
      ['note', '--day', day, '--ref', 'S000001:E001', 'Verweis auf einen noch nicht vorhandenen Beleg'],
      ['note', '--day', day, '--type', 'activity', '--start', '09:10', '--end', '09:55', '--measured', '--delay', '10', 'Besprechung'],
      ['note', '--day', day, '--type', 'decision', '--reason', 'Grund', '--alternative', 'Alternative', 'Entscheidung'],
      ['note', '--day', day, '--type', 'problem', '--cause', 'Ursache', '--solution', 'Lösung', 'Problem'],
    ]) {
      const result = await runCli(args, { dataDir, repo: repo.root });
      expect(result.exitCode, `${args.join(' ')}: ${result.stderr}`).toBe(0);
    }
    const interactive = await runInteractive(['--data-dir', dataDir, '--repo', repo.root, 'note', '--day', day], ['insight', 'Erkenntnis', '']);
    expect(interactive.exitCode, interactive.stderr).toBe(0);

    expect(await notesOf(workspace, day)).toHaveLength(5);
    const status = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ baselineSnapshotId: null, snapshots: { total: 0 } });
    // Only a run across midnight in Zurich would see a different day.
    if (zurichDay() === today) expect(JSON.parse(status.stdout)).toMatchObject({ notesToday: 1 });
    expect(await readdir(`${workspace}/snapshots`)).toEqual([]);
    expect(await readFile(`${workspace}/state.json`, 'utf8')).toBe(stateBefore);
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('gelingt, während ein anderer Prozess den Lock hält (AK-04-09, D-16)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const holder = await startLockHolder(workspace);
    try {
      const lock = await readFile(`${workspace}/lock`, 'utf8');
      const capture = await runCli(['capture'], { dataDir, repo: repo.root });
      expect(capture.exitCode).toBe(3);
      const note = await runCli(['note', '--type', 'activity', 'Während ein capture läuft'], { dataDir, repo: repo.root });
      expect(note.exitCode, note.stderr).toBe(0);
      expect(await readFile(`${workspace}/lock`, 'utf8')).toBe(lock);
    } finally {
      await stopLockHolder(holder);
    }
    const [file] = await noteFiles(workspace);
    expect(await notesOf(workspace, file!.replace('.jsonl', ''))).toMatchObject([{ type: 'activity', text: 'Während ein capture läuft' }]);
  });

  it('schreibt keinen Eintrag in runs.jsonl und ändert ausser der Notizdatei nichts', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const day = zurichDay(-3);
    const before = await listTree(workspace);
    expect((await runCli(['note', '--day', day, 'Nur die Notiz'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const after = await listTree(workspace);
    // Folders are left out: adding a file changes the modification time of its folder.
    const changedFiles = Object.keys({ ...before, ...after })
      .filter((key) => (after[key] ?? before[key])?.type !== 'dir')
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    expect(changedFiles).toEqual([`notes/${day}.jsonl`]);
  });

  it('meldet ein nicht initialisiertes Repository mit Exit-Code 2', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const result = await runCli(['note', 'Text'], { dataDir, repo: repo.root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('nicht initialisiert');
  });

  it('bestimmt den Tätigkeitstag in Europe/Zurich, unabhängig von der Zeitzone des Systems (Paket 04 §6)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
      const dayBefore = zurichDay();
      const result = await runCli(['note', `Systemzeitzone ${tz}`], { dataDir, repo: repo.root, env: { TZ: tz } });
      const dayAfter = zurichDay();
      expect(result.exitCode, result.stderr).toBe(0);
      const note = (await notesOf(workspace, dayBefore)).concat(await notesOf(workspace, dayAfter)).find((entry) => entry.text === `Systemzeitzone ${tz}`);
      expect(note, tz).toBeDefined();
      expect(note!.recordedAt).toMatch(/\+0[12]:00$/);
    }
  });
});

describe('ipa note und ipa status (AK-04-10, AK-04-11)', () => {
  it('status zeigt notesToday, --help listet note, das Repository bleibt unverändert (AK-04-11)', async () => {
    const { repo, dataDir } = await initialized();
    const before = await fingerprintRepo(repo.root);
    const empty = JSON.parse((await runCli(['status', '--json'], { dataDir, repo: repo.root })).stdout) as Record<string, unknown>;
    expect(empty['notesToday']).toBe(0);

    const today = zurichDay();
    expect((await runCli(['note', 'Eins'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    expect((await runCli(['note', '--type', 'plan', 'Zwei'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    expect((await runCli(['note', '--day', zurichDay(-3), 'Früher'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    expect((await runCli(['note', '--type', 'plan', '--day', zurichDay(3), 'Später'], { dataDir, repo: repo.root })).exitCode).toBe(0);

    const status = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(status.exitCode).toBe(0);
    const report = JSON.parse(status.stdout) as Record<string, unknown>;
    // Package 05 appends `claude` after `notesToday` (spec.md §6.6).
    expect(Object.keys(report).slice(-2)).toEqual(['notesToday', 'claude']);
    // Only a run across midnight in Zurich would see a different day.
    if (zurichDay() === today) expect(report['notesToday']).toBe(2);
    const human = await runCli(['status'], { dataDir, repo: repo.root });
    expect(human.stdout).toMatch(/Notizen heute:\s+\d+/);

    const help = await runCli(['--help'], { dataDir: null });
    expect(help.stdout).toMatch(/^\s{2}note \[optionen\] \[text\]/m);
    const noteHelp = await runCli(['note', '--help'], { dataDir: null });
    expect(noteHelp.exitCode).toBe(0);
    for (const option of ['--type <typ>', '--day <YYYY-MM-DD>', '--minutes <n>', '--start <HH:MM>', '--end <HH:MM>', '--measured', '--estimated', '--delay <minuten>', '--reason <text>', '--alternative <text>', '--cause <text>', '--solution <text>', '--ref <beleg>']) {
      expect(noteHelp.stdout).toContain(option);
    }
    expect(noteHelp.stdout).not.toContain('default');
    expectRepoUnchanged(before, await fingerprintRepo(repo.root));
  });

  it('legt Notizen bei Arbeitsbereich .ipa dort ab; ausserhalb bleibt das Repository unverändert (AK-04-11)', async () => {
    const { repo, dataDir, workspace } = await initialized(['--workspace', '.ipa']);
    expect(workspace).toBe(`${repo.root}/.ipa`);
    const before = await fingerprintRepo(repo.root, { workspace: '.ipa' });
    const day = zurichDay(-3);
    expect((await runCli(['note', '--day', day, '--type', 'insight', 'Im Repository abgelegt'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    expect((await runCli(['status', '--json'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const after = await fingerprintRepo(repo.root, { workspace: '.ipa' });
    expectRepoUnchanged(before, after);
    expect(Object.keys(after.workspace ?? {})).toContain(`notes/${day}.jsonl`);
    expect(await notesOf(workspace, day)).toMatchObject([{ type: 'insight' }]);
  });

  it('eine von Hand beschädigte Zeile wird gemeldet, die übrigen Notizen bleiben lesbar (AK-04-10)', async () => {
    const { repo, dataDir, workspace } = await initialized();
    const today = zurichDay();
    expect((await runCli(['note', 'Vorher'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    await appendFile(`${workspace}/notes/${today}.jsonl`, '{"schemaVersion":1,"id":"von Hand');
    expect((await runCli(['note', 'Nachher'], { dataDir, repo: repo.root })).exitCode).toBe(0);

    const status = await runCli(['status', '--json'], { dataDir, repo: repo.root });
    expect(status.exitCode).toBe(0);
    if (zurichDay() === today) {
      expect(status.stderr).toContain(`Warnung: notes/${today}.jsonl, Zeile 2 wird übersprungen (kein gültiges JSON)`);
      expect((JSON.parse(status.stdout) as { notesToday: number }).notesToday).toBe(2);
    }
    const lines = (await readFile(`${workspace}/notes/${today}.jsonl`, 'utf8')).split('\n');
    expect(JSON.parse(lines[2]!)).toMatchObject({ text: 'Nachher' });
  });
});
