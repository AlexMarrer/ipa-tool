import type { RunResultView, RunSummary } from '../../shared/run';
import type { CommandRequest } from '../cli/commands';
import type { CliRunResult } from '../cli/runner';
import type { ForeignLock } from './locks';

type Json = Record<string, unknown>;

const rec = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const list = (value: unknown): Json[] => {
  if (!Array.isArray(value)) return [];
  const items: Json[] = [];
  for (const item of value as unknown[]) {
    const entry = rec(item);
    if (entry !== null) items.push(entry);
  }
  return items;
};
const HALT = new Set(['branch_changed', 'history_rewritten', 'head_missing']);
const haltReason = (value: unknown): 'branch_changed' | 'history_rewritten' | 'head_missing' | null => {
  const reason = str(rec(value)?.['reason']);
  return reason !== null && HALT.has(reason) ? (reason as 'branch_changed' | 'history_rewritten' | 'head_missing') : null;
};
const basis = (value: unknown): 'measured' | 'estimated' => (value === 'measured' ? 'measured' : 'estimated');

/**
 * Turns the answer of the CLI into the fields the renderer may see. Every field is named here; paths, contents,
 * reasons and note texts are dropped on purpose (I-12, spec §12.6).
 */
export function resultView(request: CommandRequest, result: Json | null): RunResultView | null {
  if (result === null) return null;
  switch (request.name) {
    case 'capture': {
      const snapshot = rec(result['snapshot']);
      const analysis = rec(result['analysis']);
      const retry = rec(result['retry']);
      const outside = rec(result['outsideWindow']);
      const capture = str(result['capture']);
      return {
        kind: 'capture',
        capture: capture === 'created' || capture === 'unchanged' || capture === 'halted' || capture === 'unstable' || capture === 'skipped' ? capture : null,
        snapshot: snapshot === null ? null : { id: str(snapshot['id']) ?? '', commits: num(snapshot['commits']), evidence: num(snapshot['evidence']), fileStates: num(snapshot['fileStates']) },
        outsideWindow: outside !== null,
        analysis:
          analysis === null
            ? null
            : {
                claudeCalls: num(analysis['claudeCalls']),
                completed: list(analysis['completed']).map((entry) => ({ snapshotId: str(entry['snapshotId']) ?? '', mode: entry['mode'] === 'ai' ? ('ai' as const) : ('deterministic' as const) })),
                failed: list(analysis['failed']).map((entry) => ({ snapshotId: str(entry['snapshotId']) ?? '', code: str(entry['code']) ?? 'unbekannt' })),
                open: list(analysis['open']).map((entry) => ({ snapshotId: str(entry['snapshotId']) ?? '', status: str(entry['status']) ?? 'unbekannt' })),
              },
        retry: retry === null ? null : { snapshotId: str(retry['snapshotId']) ?? '', afterAttempt: num(retry['afterAttempt']) },
        halt: haltReason(result['halt']),
      };
    }
    case 'journal': {
      const failure = rec(result['failure']);
      const mode = result['mode'];
      const reason = result['noAiReason'];
      return {
        kind: 'journal',
        day: str(result['day']) ?? '',
        mode: mode === 'ai' || mode === 'no_ai' ? mode : null,
        noAiReason: reason === 'requested' || reason === 'no_data' ? reason : null,
        failure: failure === null ? null : { code: str(failure['code']) ?? 'unbekannt' },
        draftWritten: str(result['draftPath']) !== null,
      };
    }
    case 'note': {
      const time = rec(result['time']);
      const delay = rec(result['delay']);
      return {
        kind: 'note',
        noteId: str(result['noteId']) ?? '',
        type: (str(result['type']) ?? 'general') as Extract<RunResultView, { kind: 'note' }>['type'],
        activityDay: str(result['activityDay']) ?? '',
        time: time === null ? null : { minutes: num(time['minutes']), basis: basis(time['basis']), start: str(time['start']), end: str(time['end']) },
        delay: delay === null ? null : { minutes: num(delay['minutes']), basis: basis(delay['basis']) },
        secretFindings: list(result['secretFindings']).map((finding) => ({ detector: str(finding['detector']) ?? 'unbekannt', field: str(finding['field']) ?? 'text' })),
      };
    }
    case 'skip':
      return { kind: 'skip', snapshotId: str(result['snapshotId']) ?? '', previousStatus: str(result['previousStatus']) ?? '' };
    case 'baseline':
      return { kind: 'baseline', snapshotId: str(result['snapshotId']) ?? '', forced: result['forced'] === true, endedHalt: haltReason(result['endedHalt']) };
    case 'doctor': {
      const git = rec(result['git']);
      const claude = rec(result['claude']);
      const billing = rec(result['billing']);
      const sources = [...(Array.isArray(billing?.['apiKeySources']) ? (billing['apiKeySources'] as unknown[]) : []), ...(Array.isArray(billing?.['providerSources']) ? (billing['providerSources'] as unknown[]) : [])];
      return {
        kind: 'doctor',
        ok: result['ok'] === true,
        checkedAt: str(result['checkedAt']) ?? '',
        git: { found: git?.['found'] === true, version: str(git?.['version']) },
        claude: { found: claude?.['found'] === true, version: str(claude?.['version']), loggedIn: typeof claude?.['loggedIn'] === 'boolean' ? claude['loggedIn'] : null, authMethod: str(claude?.['authMethod']) },
        billing: { detected: billing?.['detected'] === true, allowPaidUsage: billing?.['allowPaidUsage'] === true, blocked: billing?.['blocked'] === true, sources: sources.flatMap((source) => str(source) ?? []), unreadable: Array.isArray(billing?.['unreadableSettings']) ? (billing['unreadableSettings'] as unknown[]).flatMap((entry) => str(entry) ?? []) : [] },
        live: rec(result['liveCheck']) === null ? null : { ok: rec(result['liveCheck'])?.['ok'] === true },
        findings: Array.isArray(result['findings']) ? (result['findings'] as unknown[]).flatMap((finding) => str(finding) ?? []) : [],
      };
    }
    case 'configSet':
    case 'configCheck': {
      return {
        kind: 'config',
        valid: typeof result['valid'] === 'boolean' ? result['valid'] : null,
        findings: list(result['findings']).map((finding) => ({
          severity: finding['severity'] === 'warning' ? ('warning' as const) : ('error' as const),
          code: str(finding['code']) ?? 'unbekannt',
          path: str(finding['path']) ?? '',
          message: str(finding['message']) ?? '',
        })),
        changedPaths: list(result['changes']).flatMap((change) => str(change['path']) ?? []),
        written: result['written'] === true,
      };
    }
    case 'scheduleInstall':
    case 'schedulePause':
    case 'scheduleResume':
    case 'scheduleRemove':
    case 'scheduleRun':
    case 'scheduleStatus': {
      const state = str(result['state']);
      return {
        kind: 'schedule',
        action: str(result['action']) ?? '',
        changed: result['changed'] === true,
        state: state === 'not_installed' || state === 'active' || state === 'paused' || state === 'stale' || state === 'error' ? state : null,
        differences: Array.isArray(result['differences']) ? (result['differences'] as unknown[]).flatMap((entry) => str(entry) ?? []) : [],
        detail: str(result['detail']),
        running: result['running'] === true,
        insideWindow: typeof result['insideWindow'] === 'boolean' ? result['insideWindow'] : null,
      };
    }
    default:
      return null;
  }
}

const OUTPUT_LIMIT = 4000;

/** The summary of a finished run as the renderer sees it. */
export function summarizeRun(label: string, request: CommandRequest, run: CliRunResult, lock: ForeignLock | null): RunSummary {
  const envelope = run.envelope;
  const output = run.stderr.trim();
  return {
    command: label,
    exitCode: run.exitCode,
    outcome: envelope?.outcome ?? null,
    runId: envelope?.runId ?? null,
    errors: envelope?.errors ?? [],
    warnings: envelope?.warnings ?? [],
    output: output.length <= OUTPUT_LIMIT ? output : `…${output.slice(-OUTPUT_LIMIT)}`,
    failure: run.failure,
    cancelled: run.cancelled,
    result: resultView(request, envelope?.result ?? null),
    lock: lock === null ? null : { command: lock.command, startedAt: lock.startedAt },
  };
}
