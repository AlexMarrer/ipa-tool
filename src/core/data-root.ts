/**
 * Datenwurzel (spec.md §5.2).
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { randomHex } from './ids.js';
import { canonicalizePath, isSameOrInside, toPortablePath } from './paths.js';

export const DATA_ROOT_ENV = 'IPA_ASSISTANT_HOME';
export const DATA_ROOT_FOLDER = 'ipa-assistant';

export type DataRootSource = 'option' | 'env' | 'default';

export interface DataRootInput {
  /** Globale Option `--data-dir`. */
  dataDir?: string | undefined;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  cwd?: string;
}

export interface DataRoot {
  /** Kanonischer absoluter Pfad mit `/`. */
  path: string;
  source: DataRootSource;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/**
 * Bestimmt den Pfad der Datenwurzel ohne Dateisystemzugriff:
 * `--data-dir`, dann `IPA_ASSISTANT_HOME`, dann der Standard der Plattform.
 */
export function dataRootCandidate(input: DataRootInput = {}): { path: string; source: DataRootSource } {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const cwd = input.cwd ?? process.cwd();
  const pathApi = platform === 'win32' ? path.win32 : path.posix;

  if (input.dataDir !== undefined) {
    if (input.dataDir.trim() === '') {
      throw new IpaError('data_root_invalid', EXIT.usage, 'Die Option --data-dir braucht einen Pfad.');
    }
    return { path: toPortablePath(pathApi.resolve(cwd, input.dataDir)), source: 'option' };
  }
  const fromEnv = nonEmpty(env[DATA_ROOT_ENV]);
  if (fromEnv !== undefined) {
    return { path: toPortablePath(pathApi.resolve(cwd, fromEnv)), source: 'env' };
  }

  const home = input.homedir ?? os.homedir();
  if (platform === 'win32') {
    const localAppData = nonEmpty(env['LOCALAPPDATA']);
    if (localAppData === undefined) {
      throw new IpaError(
        'data_root_unknown',
        EXIT.usage,
        `Die Umgebungsvariable LOCALAPPDATA ist nicht gesetzt, daher ist der Standard-Speicherort unbekannt. ` +
          `Bitte die Datenwurzel mit --data-dir <pfad> oder ${DATA_ROOT_ENV} angeben.`,
      );
    }
    return { path: toPortablePath(pathApi.join(localAppData, DATA_ROOT_FOLDER)), source: 'default' };
  }
  if (platform === 'darwin') {
    return { path: toPortablePath(pathApi.join(home, 'Library', 'Application Support', DATA_ROOT_FOLDER)), source: 'default' };
  }
  const xdg = nonEmpty(env['XDG_DATA_HOME']);
  const base = xdg !== undefined && pathApi.isAbsolute(xdg) ? xdg : pathApi.join(home, '.local', 'share');
  return { path: toPortablePath(pathApi.join(base, DATA_ROOT_FOLDER)), source: 'default' };
}

/** Datenwurzel mit kanonischem Pfad. Legt nichts an. */
export async function resolveDataRoot(input: DataRootInput = {}): Promise<DataRoot> {
  const candidate = dataRootCandidate(input);
  return { path: await canonicalizePath(candidate.path), source: candidate.source };
}

/** Datenwurzel und Repository dürfen nicht ineinander liegen (spec.md §5.2, D-02). */
export function assertDataRootSeparate(dataRoot: string, repoRoot: string): void {
  if (isSameOrInside(dataRoot, repoRoot)) {
    throw new IpaError(
      'data_root_in_repository',
      EXIT.usage,
      `Die Datenwurzel ${dataRoot} liegt im untersuchten Repository ${repoRoot}. ` +
        `Bitte eine Datenwurzel ausserhalb wählen (--data-dir oder ${DATA_ROOT_ENV}). ` +
        'Für einen Arbeitsbereich im Repository dient ipa init --workspace.',
    );
  }
  if (isSameOrInside(repoRoot, dataRoot)) {
    throw new IpaError(
      'repository_in_data_root',
      EXIT.usage,
      `Das Repository ${repoRoot} liegt in der Datenwurzel ${dataRoot}. ` +
        `Bitte eine Datenwurzel ausserhalb des Repositorys wählen (--data-dir oder ${DATA_ROOT_ENV}).`,
    );
  }
}

/** Deutsche Kurzbeschreibung eines Dateisystemfehlers, ohne Inhalte. */
export function describeFsError(error: unknown): string {
  switch (errnoCode(error)) {
    case 'EEXIST':
    case 'ENOTDIR':
      return 'der Pfad oder ein übergeordneter Pfad ist eine Datei';
    case 'EACCES':
    case 'EPERM':
      return 'Zugriff verweigert';
    case 'EROFS':
      return 'schreibgeschütztes Dateisystem';
    case 'ENOSPC':
      return 'kein freier Speicherplatz';
    case 'ENOENT':
      return 'Laufwerk oder übergeordneter Ordner nicht vorhanden';
    default:
      return errnoCode(error) ?? 'unbekannter Fehler';
  }
}

/** Meldung für eine nicht beschreibbare Datenwurzel mit allen Auswegen (D-21). */
export function dataRootNotWritableMessage(dataRoot: string, reason: string): string {
  return [
    `Die Datenwurzel ist nicht beschreibbar: ${dataRoot} (${reason}).`,
    'Mögliche Auswege:',
    '  --data-dir <pfad>            eine andere Datenwurzel für diesen Aufruf angeben',
    `  ${DATA_ROOT_ENV}=<pfad>   die Datenwurzel über die Umgebungsvariable festlegen`,
    '  ipa init --workspace <pfad>  den Arbeitsbereich selbst wählen, zum Beispiel .ipa im Repository.',
    '                               Die Registry bleibt in der Datenwurzel, diese muss daher trotzdem beschreibbar sein.',
    'Der Speicherort wird nicht automatisch gewechselt.',
  ].join('\n');
}

/**
 * Legt die Datenwurzel bei Bedarf an und prüft mit einer Probedatei, ob sie beschreibbar ist.
 * Scheitert das, folgt Exit-Code 2 mit Pfad und Auswegen. Es wird nie ein anderer Ort verwendet.
 */
export async function ensureDataRootWritable(dataRoot: string): Promise<void> {
  const fail = (error: unknown): never => {
    throw new IpaError('data_root_not_writable', EXIT.usage, dataRootNotWritableMessage(dataRoot, describeFsError(error)), {
      cause: error,
    });
  };
  try {
    await mkdir(dataRoot, { recursive: true });
  } catch (error) {
    fail(error);
  }
  try {
    const info = await stat(dataRoot);
    if (!info.isDirectory()) fail(Object.assign(new Error('kein Ordner'), { code: 'ENOTDIR' }));
  } catch (error) {
    if (error instanceof IpaError) throw error;
    fail(error);
  }
  const probe = path.join(dataRoot, `.ipa-schreibtest-${process.pid}-${randomHex(8)}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch (error) {
    fail(error);
  }
  await rm(probe, { force: true });
}
