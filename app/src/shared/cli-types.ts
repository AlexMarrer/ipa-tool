/** Shapes of CLI output the app reads (spec.md §6.6, §6.7 of the CLI). Validated against the CLI schemas. */

export interface CliErrorEntry {
  code: string;
  message: string;
}

export interface CliEnvelope {
  schemaVersion: 1;
  command: string;
  runId: string | null;
  ok: boolean;
  exitCode: number;
  outcome: string;
  errors: CliErrorEntry[];
  warnings: string[];
  result: Record<string, unknown> | null;
}

export interface StatusHalt {
  [key: string]: unknown;
}

/** `ipa status --json` (spec.md §6.6). */
export interface StatusReport {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
  dataRoot: string;
  timezone: string;
  workspaceMode: 'default' | 'explicit';
  baselineSnapshotId: string | null;
  lastSnapshotId: string | null;
  lastAnalysedSnapshotId: string | null;
  lastSuccessfulRun: string | null;
  lastRun: { command: string; outcome: string; exitCode: number; startedAt: string; errors: { code: string }[] } | null;
  snapshots: { total: number; baseline: number; work: number };
  halt: StatusHalt | null;
  notesToday: number;
  claude: { checkedAt: string; ok: boolean; cliVersion: string | null } | null;
  analyses: {
    pending: number;
    failed: number;
    blocked: number;
    exhausted: number;
    complete: number;
    skipped: number;
    notRequired: number;
    openIds: string[];
  };
  withheld: { units: number; notes: number };
}
