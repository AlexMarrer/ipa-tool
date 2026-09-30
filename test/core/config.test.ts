import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkConfigRules, createDefaultConfig, loadConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';
import { createTempDir } from '../helpers/workspace.js';

/** Defaults of spec.md §7.1, copied verbatim. */
const SPEC_DEFAULTS = {
  schemaVersion: 1,
  repositoryId: 'mein-projekt-3fa9c1',
  repository: { path: 'C:/GIT/mein-projekt' },
  timezone: 'Europe/Zurich',
  paths: {
    include: ['**'],
    exclude: [
      '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore',
      'id_rsa', 'id_rsa.*', 'id_ed25519', 'id_ed25519.*', '.npmrc', '.pypirc', '.netrc',
      '**/secrets/**', '**/credentials/**',
      '**/node_modules/**', '**/vendor/**', '**/.venv/**', '**/__pycache__/**',
      '**/dist/**', '**/target/**', '**/coverage/**',
    ],
  },
  secrets: { extraPatterns: [], disabledDetectors: [] },
  limits: {
    maxFileBytes: 262144,
    maxSnapshotBytes: 10485760,
    maxAnalysisInputBytes: 524288,
    maxJournalInputBytes: 524288,
    maxContextFileBytes: 131072,
    stabilityRetries: 3,
    stabilityDelayMs: 2000,
    maxRunSeconds: 1800,
  },
  context: { files: [] },
  testReports: [],
  claude: {
    command: ['claude'],
    model: null,
    timeoutSeconds: 600,
    maxTurns: 5,
    maxAttemptsPerSnapshot: 3,
    maxAnalysesPerRun: 5,
    allowPaidUsage: false,
  },
  schedule: {
    workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    windowStart: '08:00',
    windowEnd: '18:00',
    intervalMinutes: 120,
    extraRunTimes: ['17:45'],
  },
};

describe('Konfiguration (spec.md §7)', () => {
  it('schreibt genau die Standardwerte aus §7.1', () => {
    expect(createDefaultConfig({ repositoryId: 'mein-projekt-3fa9c1', repoPath: 'C:/GIT/mein-projekt', timezone: 'Europe/Zurich' })).toEqual(
      SPEC_DEFAULTS,
    );
  });

  it('prüft Zeitzone, reguläre Ausdrücke und Zeitfenster', () => {
    const config = createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Mars/Base' });
    config.secrets.extraPatterns = ['gültig\\d+', '(ungültig'];
    config.schedule.windowStart = '18:00';
    config.schedule.windowEnd = '08:00';
    expect(checkConfigRules(config).map((issue) => issue.path)).toEqual(['/timezone', '/secrets/extraPatterns/1', '/schedule/windowStart']);
  });

  it('lädt eine gültige Konfiguration und meldet ungültige mit Exit-Code 2 und JSON-Pfad', async () => {
    const dir = await createTempDir('config');
    const config = createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' });
    await writeFile(`${dir}/config.json`, JSON.stringify(config));
    await expect(loadConfig(dir)).resolves.toEqual(config);

    await writeFile(`${dir}/config.json`, JSON.stringify({ ...config, timezone: 'Nirgendwo/Stadt' }));
    const error = await loadConfig(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ code: 'config_invalid', exitCode: 2 });
    expect((error as IpaError).message).toContain('/timezone');
  });

  it('lädt eine ältere Konfiguration ohne claude.allowPaidUsage und verlangt sonst einen Boolean', async () => {
    const dir = await createTempDir('config');
    const config = createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' });
    const { allowPaidUsage: _default, ...legacyClaude } = config.claude;
    await writeFile(`${dir}/config.json`, JSON.stringify({ ...config, claude: legacyClaude }));
    expect((await loadConfig(dir)).claude.allowPaidUsage).toBeUndefined();

    await writeFile(`${dir}/config.json`, JSON.stringify({ ...config, claude: { ...config.claude, allowPaidUsage: 'ja' } }));
    const error = await loadConfig(dir).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'schema_invalid', exitCode: 2 });
    expect((error as IpaError).message).toContain('/claude/allowPaidUsage');
  });
});
