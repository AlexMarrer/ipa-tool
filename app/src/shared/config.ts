/**
 * Configuration and schedule as the renderer sees them (app spec §8.10, §8.11). The shape of `config.json` follows
 * `schemas/config.schema.json`, which is the single source for rules; the app adds only the texts and defaults below.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };
export const WEEKDAY_NAME: Record<Weekday, string> = { mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag', sat: 'Samstag', sun: 'Sonntag' };

export interface ScheduleConfig {
  workdays: Weekday[];
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  extraRunTimes: string[];
}

export interface LimitsConfig {
  maxFileBytes: number;
  maxSnapshotBytes: number;
  maxAnalysisInputBytes: number;
  maxJournalInputBytes: number;
  maxContextFileBytes: number;
  stabilityRetries: number;
  stabilityDelayMs: number;
  maxRunSeconds: number;
}

export interface ClaudeConfig {
  command: string[];
  model: string | null;
  timeoutSeconds: number;
  maxTurns: number;
  maxAttemptsPerSnapshot: number;
  maxAnalysesPerRun: number;
  allowPaidUsage?: boolean;
}

export interface ConfigFile {
  schemaVersion: 1;
  repositoryId: string;
  repository: { path: string };
  timezone: string;
  paths: { include: string[]; exclude: string[] };
  secrets: { extraPatterns: string[]; disabledDetectors: string[] };
  limits: LimitsConfig;
  context: { files: string[] };
  testReports: { path: string; label: string }[];
  claude: ClaudeConfig;
  schedule: ScheduleConfig;
}

/** Defaults of `spec.md §7.1`; shown next to the fields and used by "Auf Standard zurücksetzen". */
export const LIMIT_DEFAULTS: LimitsConfig = {
  maxFileBytes: 262_144,
  maxSnapshotBytes: 10_485_760,
  maxAnalysisInputBytes: 524_288,
  maxJournalInputBytes: 524_288,
  maxContextFileBytes: 131_072,
  stabilityRetries: 3,
  stabilityDelayMs: 2_000,
  maxRunSeconds: 1_800,
};
export const CLAUDE_DEFAULTS = { timeoutSeconds: 600, maxTurns: 5, maxAttemptsPerSnapshot: 3, maxAnalysesPerRun: 5 } as const;
export const SCHEDULE_DEFAULTS: ScheduleConfig = { workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], windowStart: '08:00', windowEnd: '18:00', intervalMinutes: 120, extraRunTimes: ['17:45'] };

/** Models of the list in the Claude group (spec §8.11); `null` means "Standard von Claude Code" and sends no `--model`. */
export const KNOWN_MODELS: readonly { id: string; label: string; large: boolean }[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', large: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', large: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', large: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', large: false },
];

export const DETECTOR_INFO: readonly { id: string; label: string; text: string }[] = [
  { id: 'private_key', label: 'Privater Schlüssel', text: 'Blöcke «BEGIN … PRIVATE KEY».' },
  { id: 'aws_access_key', label: 'AWS-Zugangsschlüssel', text: 'Schlüssel-IDs, die mit AKIA beginnen.' },
  { id: 'github_token', label: 'GitHub-Token', text: 'Tokens von GitHub (ghp_, github_pat_ und ähnliche).' },
  { id: 'slack_token', label: 'Slack-Token', text: 'Tokens, die mit xox beginnen.' },
  { id: 'anthropic_or_openai_key', label: 'API-Schlüssel (Anthropic oder OpenAI)', text: 'Schlüssel, die mit sk- beginnen.' },
  { id: 'jwt', label: 'JSON-Web-Token', text: 'Drei durch Punkte getrennte Teile, die mit eyJ beginnen.' },
  { id: 'url_credentials', label: 'Zugangsdaten in einer Adresse', text: 'Benutzer und Passwort in einer URL (https://benutzer:passwort@host).' },
  { id: 'assignment', label: 'Zuweisung eines Geheimwerts', text: 'Zeilen wie api_key = "…" oder password: ….' },
  { id: 'custom', label: 'Eigene Muster', text: 'Die eigenen Muster unten. Ohne diesen Detektor greifen sie nicht.' },
];

/** One change of `config.json`: a dotted path and the new value, sent to `ipa config set` as JSON. */
export interface ConfigChange {
  path: string;
  value: unknown;
}

/** Paths the app may change; everything else (`repositoryId`, `repository.path`, `timezone`, `claude.command`) it never writes. */
export const EDITABLE_PATHS: readonly string[] = [
  'claude.model',
  'claude.timeoutSeconds',
  'claude.maxTurns',
  'claude.maxAttemptsPerSnapshot',
  'claude.maxAnalysesPerRun',
  'claude.allowPaidUsage',
  'schedule.workdays',
  'schedule.windowStart',
  'schedule.windowEnd',
  'schedule.intervalMinutes',
  'schedule.extraRunTimes',
  'paths.include',
  'paths.exclude',
  'secrets.disabledDetectors',
  'secrets.extraPatterns',
  'context.files',
  'testReports',
  'limits.maxFileBytes',
  'limits.maxSnapshotBytes',
  'limits.maxAnalysisInputBytes',
  'limits.maxJournalInputBytes',
  'limits.maxContextFileBytes',
  'limits.stabilityRetries',
  'limits.stabilityDelayMs',
  'limits.maxRunSeconds',
];

export interface ConfigFinding {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface SchedulePlan {
  workdays: Weekday[];
  runTimes: string[];
  skippedRunTimes: string[];
  runsPerDay: number;
  includesWindowEndRun: boolean;
  maxAnalysesPerRun: number;
  maxClaudeCallsPerDay: number;
}

/** Answer of `config set --dry-run` or `config check`. */
export interface ConfigPreview {
  valid: boolean | null;
  findings: ConfigFinding[];
  schedulePlan: SchedulePlan | null;
  /** Set when the command itself failed (not a finding), for example the runtime is missing. */
  failure: string | null;
}

export type ConfigFileState = 'ok' | 'missing' | 'invalid' | 'unreadable' | 'newer';

export interface ConfigView {
  state: ConfigFileState;
  config: ConfigFile | null;
  /** Findings of `config check`, when the file is not valid. */
  findings: ConfigFinding[];
  /** Changes whenever the file changes; the page compares it to find edits made by hand (spec §8.11). */
  signature: string;
  /** Workspace path relative to the repository root, when the workspace lies inside the repository. */
  workspaceInRepository: string | null;
  repoPath: string;
  workspacePath: string;
  /** Last check of Claude (`doctor.json`), `null` if there is none. */
  claude: { checkedAt: string; ok: boolean; found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null } | null;
}

export type ScheduleState = 'not_installed' | 'active' | 'paused' | 'stale' | 'error';

export interface ScheduleView {
  /** `null` when the platform is not Windows (`schedule_platform_unsupported`) or the command failed. */
  state: ScheduleState | null;
  taskName: string | null;
  enabled: boolean | null;
  differences: string[];
  detail: string | null;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: number | null;
  running: boolean;
  /** Whether now lies inside the time window; `false` means "Jetzt auslösen" ends without a capture. */
  insideWindow: boolean | null;
  plan: SchedulePlan | null;
  /** `unsupported` for another platform than Windows, `failed` for any other failure of the command. */
  problem: { kind: 'unsupported' | 'failed'; message: string } | null;
}

export interface RunHistoryEntry {
  runId: string;
  command: string;
  startedAt: string;
  time: string;
  day: string;
  outcome: string;
  exitCode: number;
  durationMs: number;
  snapshotCreated: string | null;
  analysesCompleted: number;
  analysesFailed: number;
}

export interface PathDecisionView {
  allowed: boolean;
  /** The rule that decided, for example `**\/node_modules/**`, `paths.include` or `.git/**`. */
  rule: string | null;
}
