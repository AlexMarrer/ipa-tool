/**
 * Test-Helfer für temporäre Datenwurzeln und Aufrufe des echten CLI-Einstiegs (spec.md §16.2).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';

export const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLI_PATH = path.join(TOOL_ROOT, 'dist', 'cli.js');

/** Pfad mit `/` und grossem Laufwerksbuchstaben, wie ihn das Tool ausgibt. */
export function portable(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/.test(slashed) ? slashed.charAt(0).toUpperCase() + slashed.slice(1) : slashed;
}

/** Neues leeres Verzeichnis im Test-Verzeichnis, kanonisch und portabel geschrieben. */
export async function createTempDir(prefix = 'tmp'): Promise<string> {
  const created = await mkdtemp(path.join(inject('ipaTestRoot'), `${prefix}-`));
  return portable(await realpath(created));
}

/** Pfad einer eigenen Datenwurzel pro Test. Der Ordner existiert noch nicht. */
export async function createTempDataRoot(): Promise<string> {
  return `${await createTempDir('data')}/ipa-daten`;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  /** Eigene Datenwurzel über `--data-dir`. `null` lässt die Option bewusst weg. */
  dataDir: string | null;
  repo?: string;
  cwd?: string;
  /** Zusätzliche oder entfernte (`undefined`) Umgebungsvariablen. */
  env?: Record<string, string | undefined>;
}

/** Startet `node dist/cli.js` ohne Shell. */
export async function runCli(args: readonly string[], opts: RunCliOptions): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const fullArgs = [
    CLI_PATH,
    ...(opts.dataDir !== null ? ['--data-dir', opts.dataDir] : []),
    ...(opts.repo !== undefined ? ['--repo', opts.repo] : []),
    ...args,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, fullArgs, {
      cwd: opts.cwd ?? inject('ipaTestRoot'),
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
}

export async function readJsonFile<T = unknown>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export interface TreeEntry {
  type: 'file' | 'dir' | 'link';
  size: number;
  mtimeMs: number;
  sha256: string | null;
}

/** Alle Einträge unter `dir` mit Grösse, Änderungszeit und Hash, für „schreibt keine Datei“-Prüfungen. */
export async function listTree(dir: string): Promise<Record<string, TreeEntry>> {
  const result: Record<string, TreeEntry> = {};
  async function walk(current: string, relative: string): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(current)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(current, name);
      const rel = relative === '' ? name : `${relative}/${name}`;
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        result[rel] = { type: 'link', size: 0, mtimeMs: info.mtimeMs, sha256: await readlink(full) };
      } else if (info.isDirectory()) {
        result[rel] = { type: 'dir', size: 0, mtimeMs: info.mtimeMs, sha256: null };
        await walk(full, rel);
      } else {
        const hash = createHash('sha256').update(await readFile(full)).digest('hex');
        result[rel] = { type: 'file', size: info.size, mtimeMs: info.mtimeMs, sha256: hash };
      }
    }
  }
  await walk(dir, '');
  return result;
}
