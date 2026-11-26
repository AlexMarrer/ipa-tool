import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryState, WorkspaceMode } from '../../shared/types';
import type { SchemaValidator } from '../cli/validator';

export interface RegistryEntry {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
  workspaceMode: WorkspaceMode;
  createdAt: string;
}

export interface RegistryReadResult {
  state: RegistryState;
  path: string;
  /** Short reason for `invalid` and `unreadable`: path and schema issues, never file contents. */
  detail: string | null;
  repositories: RegistryEntry[];
}

/**
 * Data root of the CLI (docs/implementation/spec.md §5.2). The app never passes `--data-dir`, so the console
 * and the app share this root.
 */
export function resolveDataRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | null {
  const home = env['IPA_ASSISTANT_HOME'];
  if (home !== undefined && home.trim() !== '') return home;
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    return local === undefined || local.trim() === '' ? null : path.join(local, 'ipa-assistant');
  }
  return null;
}

export const REGISTRY_FILE = 'registry.json';

/** Reads `registry.json` and validates it against the schema of the CLI (spec AK-10-09). */
export async function readRegistry(dataRoot: string, validator: SchemaValidator): Promise<RegistryReadResult> {
  const file = path.join(dataRoot, REGISTRY_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing', path: file, detail: null, repositories: [] };
    return { state: 'unreadable', path: file, detail: `Datei nicht lesbar (${code ?? 'unbekannt'}).`, repositories: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'invalid', path: file, detail: 'Die Datei ist kein gültiges JSON.', repositories: [] };
  }
  const outcome = validator.validate('registry', parsed);
  if (!outcome.ok) {
    return { state: 'invalid', path: file, detail: `Schemafehler: ${outcome.issues.join('; ')}`, repositories: [] };
  }
  const repositories = (parsed as { repositories: RegistryEntry[] }).repositories;
  return { state: 'ok', path: file, detail: null, repositories };
}
