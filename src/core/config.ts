/**
 * `config.json` (spec.md §7).
 */
import path from 'node:path';
import { EXIT, IpaError } from './errors.js';
import { readJsonValidated, writeJsonAtomic } from './json.js';
import { formatIssues, type SchemaIssue } from './schemas.js';
import { canonicalTimeZone } from './time.js';

export const CONFIG_FILE = 'config.json';
export const DEFAULT_TIMEZONE = 'Europe/Zurich';

export const SECRET_DETECTORS = [
  'private_key',
  'aws_access_key',
  'github_token',
  'slack_token',
  'anthropic_or_openai_key',
  'jwt',
  'url_credentials',
  'assignment',
  'custom',
] as const;
export type SecretDetector = (typeof SECRET_DETECTORS)[number];

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Config {
  schemaVersion: 1;
  repositoryId: string;
  repository: { path: string };
  timezone: string;
  paths: { include: string[]; exclude: string[] };
  secrets: { extraPatterns: string[]; disabledDetectors: SecretDetector[] };
  limits: {
    maxFileBytes: number;
    maxSnapshotBytes: number;
    maxAnalysisInputBytes: number;
    maxJournalInputBytes: number;
    maxContextFileBytes: number;
    stabilityRetries: number;
    stabilityDelayMs: number;
    maxRunSeconds: number;
  };
  context: { files: string[] };
  testReports: { path: string; label: string }[];
  claude: {
    command: string[];
    model: string | null;
    timeoutSeconds: number;
    maxTurns: number;
    maxAttemptsPerSnapshot: number;
    maxAnalysesPerRun: number;
  };
  schedule: {
    workdays: Weekday[];
    windowStart: string;
    windowEnd: string;
    intervalMinutes: number;
    extraRunTimes: string[];
  };
}

/** Defaults of spec.md §7.1; the exclusions are suggestions that the user may change freely. */
export function createDefaultConfig(args: { repositoryId: string; repoPath: string; timezone: string }): Config {
  return {
    schemaVersion: 1,
    repositoryId: args.repositoryId,
    repository: { path: args.repoPath },
    timezone: args.timezone,
    paths: {
      include: ['**'],
      exclude: [
        '.env',
        '.env.*',
        '*.pem',
        '*.key',
        '*.p12',
        '*.pfx',
        '*.jks',
        '*.keystore',
        'id_rsa',
        'id_rsa.*',
        'id_ed25519',
        'id_ed25519.*',
        '.npmrc',
        '.pypirc',
        '.netrc',
        '**/secrets/**',
        '**/credentials/**',
        '**/node_modules/**',
        '**/vendor/**',
        '**/.venv/**',
        '**/__pycache__/**',
        '**/dist/**',
        '**/target/**',
        '**/coverage/**',
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
    },
    schedule: {
      workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      windowStart: '08:00',
      windowEnd: '18:00',
      intervalMinutes: 120,
      extraRunTimes: ['17:45'],
    },
  };
}

/** Rules of spec.md §7.2 that the schema cannot express. */
export function checkConfigRules(config: Config): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (canonicalTimeZone(config.timezone) === null) {
    issues.push({ path: '/timezone', message: `unbekannte Zeitzone "${config.timezone}" (erwartet wird ein IANA-Name wie Europe/Zurich)` });
  }
  config.secrets.extraPatterns.forEach((pattern, index) => {
    try {
      new RegExp(pattern);
    } catch {
      issues.push({ path: `/secrets/extraPatterns/${index}`, message: 'ungültiger regulärer Ausdruck' });
    }
  });
  if (config.schedule.windowStart >= config.schedule.windowEnd) {
    issues.push({ path: '/schedule/windowStart', message: 'muss vor windowEnd liegen' });
  }
  return issues;
}

export function configPath(workspaceDir: string): string {
  return path.join(workspaceDir, CONFIG_FILE);
}

/** Every problem ends with exit code 2 and the JSON path of the field. */
export async function loadConfig(workspaceDir: string): Promise<Config> {
  const file = configPath(workspaceDir);
  const config = await readJsonValidated<Config>(file, 'config');
  const issues = checkConfigRules(config);
  if (issues.length > 0) {
    throw new IpaError('config_invalid', EXIT.usage, `Ungültige Datei ${file}: ${formatIssues(issues)}`);
  }
  return config;
}

export async function writeConfig(workspaceDir: string, config: Config): Promise<void> {
  await writeJsonAtomic(configPath(workspaceDir), config, 'config');
}
