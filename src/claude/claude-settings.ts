/**
 * Claude Code settings documents for the billing guard (spec.md §13.1): user settings, the cached
 * server-managed settings, managed settings files with `managed-settings.d/` and, on Windows, the policy
 * registry values. Locations as in Claude Code 2.1.114. The documents stay in memory; callers keep only
 * key names, never values.
 */
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { errnoCode } from '../core/errors.js';
import { stripBom } from '../core/json.js';
import { runProcess } from './process.js';

export interface SettingsLocations {
  files: { label: string; file: string }[];
  /** `*.json` files of these directories are read in alphabetical order, like `managed-settings.d/`. */
  dropInDirs: { label: string; dir: string }[];
  /** Registry keys whose value `Settings` holds a settings document. */
  registryKeys: { label: string; key: string }[];
}

export interface SettingsDocument {
  label: string;
  settings: Record<string, unknown>;
}

export interface SettingsRead {
  documents: SettingsDocument[];
  /** Documents that exist but could not be read or are not a JSON object: label and location. */
  unreadable: string[];
}

export const REGISTRY_TIMEOUT_MS = 5000;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === name && value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** `CLAUDE_CONFIG_DIR` or `~/.claude`, with the home directory the `claude` process would see. */
export function claudeConfigDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const configured = envValue(env, 'CLAUDE_CONFIG_DIR');
  if (configured !== undefined) return path.resolve(configured);
  const home = envValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME') ?? os.homedir();
  return path.join(home, '.claude');
}

export function defaultSettingsLocations(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): SettingsLocations {
  const configDir = claudeConfigDir(env, platform);
  const managedDir =
    platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return {
    files: [
      { label: 'Benutzereinstellungen', file: path.join(configDir, 'settings.json') },
      { label: 'Server-Einstellungen (Cache)', file: path.join(configDir, 'remote-settings.json') },
      { label: 'verwaltete Einstellungen', file: join(managedDir, 'managed-settings.json') },
    ],
    dropInDirs: [{ label: 'verwaltete Einstellungen', dir: join(managedDir, 'managed-settings.d') }],
    registryKeys:
      platform === 'win32'
        ? [
            { label: 'Richtlinie HKLM', key: 'HKLM\\SOFTWARE\\Policies\\ClaudeCode' },
            { label: 'Richtlinie HKCU', key: 'HKCU\\SOFTWARE\\Policies\\ClaudeCode' },
          ]
        : [],
  };
}

type Content = { text: string } | 'absent' | 'unreadable';

async function readContent(file: string): Promise<Content> {
  try {
    return { text: await readFile(file, 'utf8') };
  } catch (error) {
    const code = errnoCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unreadable';
  }
}

/** The value `Settings` from the output of `reg query <key> /v Settings`; `null` without it. */
export function parseRegistrySettings(stdout: string): string | null {
  const match = /^[ \t]+Settings[ \t]+REG_(?:EXPAND_)?SZ[ \t]+([\s\S]*)$/m.exec(stdout);
  return match === null ? null : (match[1] ?? '').trim();
}

async function readRegistry(key: string, env: NodeJS.ProcessEnv): Promise<Content> {
  const reg = path.win32.join(envValue(env, 'SYSTEMROOT') ?? 'C:\\Windows', 'System32', 'reg.exe');
  const result = await runProcess({
    command: [reg],
    args: ['query', key, '/v', 'Settings'],
    cwd: os.tmpdir(),
    env,
    input: '',
    timeoutMs: REGISTRY_TIMEOUT_MS,
  });
  if (result.spawnError !== null || result.timedOut) return 'unreadable';
  // Exit code 1: neither key nor value exists.
  if (result.exitCode !== 0) return 'absent';
  const value = parseRegistrySettings(result.stdout);
  return value === null ? 'absent' : { text: value };
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stripBom(text));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Reads every existing document; starts no `claude` process and never a model call. */
export async function readSettingsDocuments(env: NodeJS.ProcessEnv, locations: SettingsLocations = defaultSettingsLocations(env)): Promise<SettingsRead> {
  const result: SettingsRead = { documents: [], unreadable: [] };
  const add = (label: string, location: string, content: Content): void => {
    if (content === 'absent') return;
    const settings = content === 'unreadable' ? null : parseObject(content.text);
    if (settings === null) result.unreadable.push(`${label}: ${location}`);
    else result.documents.push({ label, settings });
  };
  for (const { label, file } of locations.files) add(label, file, await readContent(file));
  for (const { label, dir } of locations.dropInDirs) {
    let names: string[];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
    } catch (error) {
      const code = errnoCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') result.unreadable.push(`${label}: ${dir}`);
      continue;
    }
    for (const name of names) add(`${label} ${name}`, path.join(dir, name), await readContent(path.join(dir, name)));
  }
  for (const { label, key } of locations.registryKeys) add(label, key, await readRegistry(key, env));
  return result;
}
