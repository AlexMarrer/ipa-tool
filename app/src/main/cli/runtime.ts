import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors';

const execFileAsync = promisify(execFile);

export const REQUIRED_NODE_MAJOR = 24;

export type RuntimeMode = 'development' | 'test' | 'installed';

export interface Runtime {
  nodeExe: string;
  cliJs: string;
  /** Contains dist/, schemas/, prompts/, package.json and node_modules/. */
  cliRoot: string;
  schemasDir: string;
  mode: RuntimeMode;
  nodeVersion: string;
}

export interface ResolveRuntimeOptions {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.resourcesPath`, used when packaged. */
  resourcesPath?: string;
  /** Folder of the app package (`app/`); the CLI root is its parent in development and test. */
  appRoot: string;
  env?: NodeJS.ProcessEnv;
  /** Test mode: the Node executable of the test. */
  nodeExe?: string;
  /** Overrides the CLI root (tests). */
  cliRoot?: string;
  exists?: (file: string) => boolean;
  /** Returns the output of `node --version`. */
  nodeVersionOf?: (nodeExe: string) => Promise<string>;
}

/** Looks `name` up in PATH (and PATHEXT on Windows) without starting a process. */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const pathValue = env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
  const separator = platform === 'win32' ? ';' : ':';
  // .cmd shims cannot be started without a shell, so only real executables count.
  const extension = platform === 'win32' ? '.exe' : '';
  for (const rawDir of pathValue.split(separator)) {
    const dir = rawDir.trim().replace(/^"|"$/g, '');
    if (dir === '') continue;
    const candidate = path.join(dir, `${name}${extension}`);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function parseNodeMajor(versionOutput: string): number | null {
  const match = /^v?(\d+)\.\d+\.\d+/.exec(versionOutput.trim());
  return match === null ? null : Number(match[1]);
}

async function defaultNodeVersion(nodeExe: string): Promise<string> {
  const { stdout } = await execFileAsync(nodeExe, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 20_000 });
  return stdout.trim();
}

function missing(details: string): AppError {
  return new AppError('runtime_missing', details);
}

/** spec §6.2: development uses `node` from PATH, tests the test's own Node, an installation its resources. */
export async function resolveRuntime(options: ResolveRuntimeOptions): Promise<Runtime> {
  const exists = options.exists ?? existsSync;
  const nodeVersionOf = options.nodeVersionOf ?? defaultNodeVersion;
  const env = options.env ?? process.env;

  let mode: RuntimeMode;
  let nodeExe: string | null;
  let cliRoot: string;
  if (options.packaged) {
    if (options.resourcesPath === undefined) throw missing('resourcesPath fehlt.');
    mode = 'installed';
    nodeExe = path.join(options.resourcesPath, 'node', 'node.exe');
    cliRoot = options.cliRoot ?? path.join(options.resourcesPath, 'cli');
  } else {
    mode = options.nodeExe !== undefined ? 'test' : 'development';
    nodeExe = options.nodeExe ?? findOnPath('node', env, exists);
    cliRoot = options.cliRoot ?? path.resolve(options.appRoot, '..');
  }

  if (nodeExe === null || !exists(nodeExe)) {
    throw missing(nodeExe === null ? 'node wurde im PATH nicht gefunden.' : `Nicht gefunden: ${nodeExe}`);
  }
  const cliJs = path.join(cliRoot, 'dist', 'cli.js');
  if (!exists(cliJs)) throw missing(`Nicht gefunden: ${cliJs}. Das CLI ist nicht gebaut (npm run build).`);
  const schemasDir = path.join(cliRoot, 'schemas');
  if (!exists(schemasDir)) throw missing(`Nicht gefunden: ${schemasDir}`);

  let nodeVersion: string;
  try {
    nodeVersion = await nodeVersionOf(nodeExe);
  } catch (error) {
    throw missing(`${nodeExe} liess sich nicht starten: ${error instanceof Error ? error.message : String(error)}`);
  }
  const major = parseNodeMajor(nodeVersion);
  if (major === null || major < REQUIRED_NODE_MAJOR) {
    throw new AppError(
      'runtime_missing',
      `Node ${nodeVersion} ist zu alt, das CLI braucht Node ${REQUIRED_NODE_MAJOR} oder neuer.`,
      `Die CLI-Laufzeit ist zu alt (Node ${nodeVersion}). Node ${REQUIRED_NODE_MAJOR} oder neuer ist nötig.`,
    );
  }
  return { nodeExe, cliJs, cliRoot, schemasDir, mode, nodeVersion };
}

/** `ipa schedule install` from a development tree points the task at that tree (spec AK-10-05, AO-18). */
export function scheduleInstallWarning(runtime: Pick<Runtime, 'mode'>): string | null {
  return runtime.mode === 'installed'
    ? null
    : 'Dies ist ein Entwicklungsbetrieb: Eine jetzt eingerichtete Aufgabe zeigt auf den Entwicklungsordner und auf node aus dem PATH.';
}
