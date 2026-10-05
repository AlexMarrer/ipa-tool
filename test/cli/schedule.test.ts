import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import { CRON_UNTESTED_COMMENT } from '../../src/schedule/templates.js';
import { createTempRepo, type TempRepo } from '../helpers/git-repo.js';
import { initRepo, unchanged } from '../helpers/snapshots.js';
import { CLI_PATH, createTempDataRoot, createTempDir, listTree, readJsonFile, runCli } from '../helpers/workspace.js';
import { only, parseXml, textAt } from '../helpers/xml.js';

interface Initialised {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
}

async function initialised(): Promise<Initialised> {
  const repo = await createTempRepo({ name: 'mein projekt' });
  const dataDir = await createTempDataRoot();
  return { repo, dataDir, workspace: await initRepo(repo, dataDir) };
}

async function runs(workspace: string): Promise<RunRecord[]> {
  return (await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record')).records;
}

/** `ipa schedule …`; the repository must stay unchanged and the workspace untouched (no lock, no run log). */
async function schedule(env: Initialised, args: string[], cwd?: string) {
  const before = await listTree(env.workspace);
  const result = await unchanged(env.repo, () => runCli(['schedule', ...args], { dataDir: env.dataDir, repo: env.repo.root, ...(cwd === undefined ? {} : { cwd }) }));
  expect(await listTree(env.workspace)).toEqual(before);
  return result;
}

describe('ipa schedule (Paket 08)', () => {
  it('gibt mit --os windows wohlgeformtes XML mit absoluten Pfaden, --scheduled --repo und --data-dir aus (AK-08-04, AK-08-10)', async () => {
    const env = await initialised();
    const result = await schedule(env, ['--os', 'windows']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('Warnung');

    const document = parseXml(result.stdout);
    expect(document.declaration).toEqual({ version: '1.0' });
    const exec = only(only(document.root, 'Actions'), 'Exec');
    expect(textAt(exec, 'Command')).toBe(`"${process.execPath}"`);
    expect(path.isAbsolute(process.execPath)).toBe(true);
    expect(textAt(exec, 'Arguments')).toBe(`"${CLI_PATH}" capture --scheduled --repo "${env.repo.root}" --data-dir "${env.dataDir}"`);
    expect(textAt(document.root, 'Settings/MultipleInstancesPolicy')).toBe('IgnoreNew');
    expect(textAt(document.root, 'Settings/StartWhenAvailable')).toBe('true');
    expect(textAt(document.root, 'Settings/ExecutionTimeLimit')).toBe('PT40M');
    const config = await readJsonFile<Config>(`${env.workspace}/config.json`);
    expect(document.comments[0]).toContain(`/TN ipa-assistant-${config.repositoryId}`);
    // schedule changes nothing and is not logged (spec.md §18).
    expect((await runs(env.workspace)).map((run) => run.command)).toEqual(['init']);
  });

  it('schreibt mit --output eine neue Datei als UTF-16 und überschreibt keine vorhandene (AK-08-04)', async () => {
    const env = await initialised();
    const target = `${await createTempDir('vorlage')}/ipa aufgabe.xml`;
    const written = await schedule(env, ['--os', 'windows', '--output', target]);
    expect(written.exitCode, written.stderr).toBe(0);
    expect(written.stdout).toContain(`Vorlage für die Windows-Aufgabenplanung geschrieben: ${target}`);
    expect(written.stdout).toContain(`schtasks /Create /XML "${path.normalize(target)}" /TN ipa-assistant-`);

    const bytes = await readFile(target);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const text = bytes.subarray(2).toString('utf16le');
    expect(text).toContain('\r\n');
    const document = parseXml(text);
    expect(document.declaration).toEqual({ version: '1.0', encoding: 'UTF-16' });
    expect(textAt(document.root, 'Actions/Exec/Arguments')).toContain('capture --scheduled --repo');

    const again = await schedule(env, ['--os', 'windows', '--output', target]);
    expect(again.exitCode).toBe(2);
    expect(again.stderr).toContain('existiert bereits und wird nicht überschrieben');
    expect(await readFile(target)).toEqual(bytes);
  });

  it('lehnt eine Ausgabedatei im untersuchten Repository ab, auch relativ zum aktuellen Verzeichnis', async () => {
    const env = await initialised();
    for (const [output, cwd] of [
      [`${env.repo.root}/aufgabe.xml`, undefined],
      ['aufgabe.xml', env.repo.root],
      ['../andere/../mein projekt/neu/aufgabe.xml', env.repo.root],
    ] as const) {
      const result = await runCli(['schedule', '--os', 'windows', '--output', output], { dataDir: env.dataDir, repo: env.repo.root, ...(cwd === undefined ? {} : { cwd }) });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('läge im untersuchten Repository');
    }
    expect(Object.keys(await listTree(env.repo.root)).filter((name) => name.endsWith('aufgabe.xml'))).toEqual([]);

    const final = await runCli(['schedule', '--os', 'cron', '--output', `${env.workspace}/journal/final/aufgabe.txt`], { dataDir: env.dataDir, repo: env.repo.root });
    expect(final.exitCode).toBe(2);
    expect(final.stderr).toContain('journal/final/');
  });

  it('gibt mit --os cron Zeilen mit CRON_TZ und dem Kommentar „nicht geprüft“ aus (AK-08-05)', async () => {
    const env = await initialised();
    const result = await schedule(env, ['--os', 'cron']);
    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(CRON_UNTESTED_COMMENT);
    expect(lines).toContain('CRON_TZ=Europe/Zurich');
    const entries = lines.filter((line) => /^\d/.test(line));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatch(/^0 8,10,12,14,16,18 \* \* 1-5 '.+' '.+cli\.js' capture --scheduled --repo '.+mein projekt' --data-dir '.+'$/);
    expect(entries[1]).toMatch(/^45 17 \* \* 1-5 /);
    if (process.platform === 'win32') expect(result.stderr).toContain('cron gibt es unter Windows nicht');
  });

  it('warnt bei einem Zusatzlauf ausserhalb des Zeitfensters und erzeugt die Vorlage trotzdem', async () => {
    const env = await initialised();
    const config = await readJsonFile<Config>(`${env.workspace}/config.json`);
    await writeFile(`${env.workspace}/config.json`, JSON.stringify({ ...config, schedule: { ...config.schedule, extraRunTimes: ['18:30'] } }, null, 2));
    const result = await schedule(env, ['--os', 'windows']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Der Zusatzlauf 18:30 (schedule.extraRunTimes) liegt ausserhalb des Zeitfensters 08:00–18:00');
    expect(parseXml(result.stdout).root.name).toBe('Task');
  });

  it('übergibt --data-dir nur, wenn die Datenwurzel nicht der Standard ist', async () => {
    // Default data root: LOCALAPPDATA (or XDG_DATA_HOME) of the test environment, without IPA_ASSISTANT_HOME.
    const repo = await createTempRepo();
    const env = { IPA_ASSISTANT_HOME: undefined };
    const init = await runCli(['init'], { dataDir: null, repo: repo.root, env });
    expect(init.exitCode, init.stderr).toBe(0);
    const byDefault = await runCli(['schedule', '--os', 'windows'], { dataDir: null, repo: repo.root, env });
    expect(byDefault.exitCode, byDefault.stderr).toBe(0);
    expect(textAt(parseXml(byDefault.stdout).root, 'Actions/Exec/Arguments')).toBe(`"${CLI_PATH}" capture --scheduled --repo "${repo.root}"`);

    // IPA_ASSISTANT_HOME of the current shell is not visible to a scheduled task, so it is pinned.
    const other = await initialised();
    const byVariable = await runCli(['schedule', '--os', 'windows'], { dataDir: null, repo: other.repo.root, env: { IPA_ASSISTANT_HOME: other.dataDir } });
    expect(byVariable.exitCode, byVariable.stderr).toBe(0);
    expect(textAt(parseXml(byVariable.stdout).root, 'Actions/Exec/Arguments')).toContain(`--data-dir "${other.dataDir}"`);
  });

  it('meldet Bedienungsfehler mit Exit-Code 2', async () => {
    const env = await initialised();
    const missing = await runCli(['schedule'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Die Option '--os <windows|cron>' ist erforderlich");

    const unknown = await runCli(['schedule', '--os', 'launchd'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain('--os "launchd" ist unbekannt. Erlaubt sind windows und cron.');

    const config = await readJsonFile<Config>(`${env.workspace}/config.json`);
    await writeFile(`${env.workspace}/config.json`, JSON.stringify({ ...config, schedule: { ...config.schedule, workdays: [] } }, null, 2));
    const noDays = await runCli(['schedule', '--os', 'windows'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(noDays.exitCode).toBe(2);
    expect(noDays.stderr).toContain('schedule.workdays');
    expect(noDays.stdout).toBe('');

    const stranger = await createTempRepo();
    const notInitialised = await runCli(['schedule', '--os', 'windows'], { dataDir: env.dataDir, repo: stranger.root });
    expect(notInitialised.exitCode).toBe(2);
    expect(notInitialised.stderr).toContain('nicht initialisiert');
  });
});
