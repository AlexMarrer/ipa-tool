import { access } from 'node:fs/promises';
import type { StatusReport } from '../../shared/cli-types';
import type { Project, ProjectStatus } from '../../shared/types';
import type { RegistryEntry } from './registry';

const FAILED_RUN_OUTCOMES = new Set(['analysis_failed', 'unstable', 'usage_error']);

export interface DerivedStatus {
  status: ProjectStatus;
  hint: string;
}

/** spec §5.1: the first matching rule wins. */
export function deriveStatus(report: StatusReport): DerivedStatus {
  if (report.halt !== null) return { status: 'halt', hint: 'Halt' };
  if (report.lastRun?.outcome === 'error') return { status: 'error', hint: 'Fehler: letzter Lauf' };

  const open = report.analyses.pending + report.analyses.failed + report.analyses.blocked + report.analyses.exhausted;
  const withheld = report.withheld.units + report.withheld.notes;
  const claudeNotReady = report.claude !== null && !report.claude.ok;
  const lastRunProblem = report.lastRun !== null && FAILED_RUN_OUTCOMES.has(report.lastRun.outcome);
  if (open > 0) return { status: 'warning', hint: open === 1 ? '1 offene Analyse' : `${open} offene Analysen` };
  if (withheld > 0) return { status: 'warning', hint: 'Zurückgehaltene Inhalte' };
  if (claudeNotReady) return { status: 'warning', hint: 'Claude nicht bereit' };
  if (lastRunProblem) return { status: 'warning', hint: 'Letzter Lauf mit Problem' };
  return { status: 'ok', hint: '' };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export type StatusRunner = (entry: RegistryEntry) => Promise<{ report: StatusReport | null; failed: boolean }>;

/**
 * Builds the project row from a registry entry (spec §5.1, AK-10-09). A missing repository or workspace is an
 * error project without starting a process; a failing `status --json` is an error project as well.
 */
export async function buildProject(
  entry: RegistryEntry,
  runStatus: StatusRunner,
  fileExists: (file: string) => Promise<boolean> = exists,
): Promise<Project> {
  const base = {
    repositoryId: entry.repositoryId,
    repoPath: entry.repoPath,
    workspacePath: entry.workspacePath,
    workspaceMode: entry.workspaceMode,
  };
  if (!(await fileExists(entry.repoPath))) return { ...base, timezone: null, status: 'error', hint: 'Fehler: Repository fehlt', claudeReady: null };
  if (!(await fileExists(entry.workspacePath))) return { ...base, timezone: null, status: 'error', hint: 'Fehler: Arbeitsbereich fehlt', claudeReady: null };

  const { report, failed } = await runStatus(entry);
  if (report === null) return { ...base, timezone: null, status: 'error', hint: failed ? 'Fehler: nicht lesbar' : 'Fehler', claudeReady: null };
  const derived = deriveStatus(report);
  return { ...base, timezone: report.timezone, ...derived, claudeReady: report.claude === null ? null : report.claude.ok };
}
