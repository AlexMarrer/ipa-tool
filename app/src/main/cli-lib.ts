import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from './cli/errors';

export interface SecretHit {
  detector: string;
  line: number;
}

export interface SecretScanner {
  scan(text: string): SecretHit[];
}

export interface SecretsConfig {
  extraPatterns: readonly string[];
  disabledDetectors: readonly string[];
}

export type PathDecision = { allowed: true } | { allowed: false; rule: string };

export interface PathFilter {
  decide(path: string): PathDecision;
}

export interface PathFilterOptions {
  include: readonly string[];
  exclude: readonly string[];
  /** Workspace path relative to the repository root, if the workspace lies inside the repository. */
  workspace?: string | null;
}

export interface CliLib {
  createSecretScanner(options: SecretsConfig): SecretScanner;
  createPathFilter(options: PathFilterOptions): PathFilter;
}

/**
 * The one access to code of the CLI (spec AD-07): `createSecretScanner` from the built CLI, so the rules for
 * notes with a possible credential exist only once. A test imports it from the root `dist/` and fails when the
 * signature changes (AO-05). `createPathFilter` serves "Pfad testen" in the configuration, so the test and the capture
 * of the CLI decide with the same code.
 */
export async function loadCliLib(cliRoot: string): Promise<CliLib> {
  const load = async (name: string): Promise<Record<string, unknown>> => {
    const file = path.join(cliRoot, 'dist', 'filter', `${name}.js`);
    if (!existsSync(file)) throw new AppError('cli_version_mismatch', `Nicht gefunden: ${file}`);
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
  };
  const scanner = await load('secret-scanner');
  const filter = await load('path-filter');
  if (typeof scanner['createSecretScanner'] !== 'function') throw new AppError('cli_version_mismatch', 'createSecretScanner fehlt im gebauten CLI.');
  if (typeof filter['createPathFilter'] !== 'function') throw new AppError('cli_version_mismatch', 'createPathFilter fehlt im gebauten CLI.');
  return { createSecretScanner: scanner['createSecretScanner'] as CliLib['createSecretScanner'], createPathFilter: filter['createPathFilter'] as CliLib['createPathFilter'] };
}
