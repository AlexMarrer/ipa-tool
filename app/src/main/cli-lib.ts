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

export interface CliLib {
  createSecretScanner(options: SecretsConfig): SecretScanner;
}

/**
 * The one access to code of the CLI (spec AD-07): `createSecretScanner` from the built CLI, so the rules for
 * notes with a possible credential exist only once. A test imports it from the root `dist/` and fails when the
 * signature changes (AO-05). `createPathFilter` follows with the package that needs it.
 */
export async function loadCliLib(cliRoot: string): Promise<CliLib> {
  const file = path.join(cliRoot, 'dist', 'filter', 'secret-scanner.js');
  if (!existsSync(file)) throw new AppError('cli_version_mismatch', `Nicht gefunden: ${file}`);
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Partial<CliLib>;
  if (typeof loaded.createSecretScanner !== 'function') {
    throw new AppError('cli_version_mismatch', 'createSecretScanner fehlt im gebauten CLI.');
  }
  return { createSecretScanner: loaded.createSecretScanner };
}
