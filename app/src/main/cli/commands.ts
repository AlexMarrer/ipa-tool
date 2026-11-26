/**
 * Typed commands of the app and their mapping to CLI arguments (spec §4.1). The app calls no command that is
 * not in this union. Free text always goes as `--option=value`, the note text after `--`, so a value that starts
 * with `-` stays a value.
 */

export interface ConfigChange {
  /** Dotted path, for example `schedule.windowStart`. */
  path: string;
  /** JSON text or plain text, as the CLI reads it. */
  value: string;
}

export interface NoteFields {
  text: string;
  type?: string;
  day?: string;
  minutes?: number;
  start?: string;
  end?: string;
  timeKind?: 'measured' | 'estimated';
  delay?: number;
  reason?: string;
  alternatives?: string[];
  cause?: string;
  solution?: string;
  refs?: string[];
}

export type CommandRequest =
  | { name: 'init'; timezone?: string; workspace?: string }
  | { name: 'capture'; mode: 'full' | 'noAnalysis' | 'retry'; retrySnapshotId?: string }
  | { name: 'journal'; day?: string; noAi?: boolean }
  | ({ name: 'note' } & NoteFields)
  | { name: 'skip'; snapshotId: string; reason: string }
  | { name: 'baseline'; reason: string; force?: boolean }
  | { name: 'doctor'; live?: boolean }
  | { name: 'status' }
  | { name: 'scheduleStatus' }
  | { name: 'scheduleInstall'; update?: boolean }
  | { name: 'schedulePause' }
  | { name: 'scheduleResume' }
  | { name: 'scheduleRemove' }
  | { name: 'scheduleRun' }
  | { name: 'configCheck' }
  | { name: 'configSet'; changes: ConfigChange[]; dryRun?: boolean; confirmPaidUsage?: boolean };

export type CommandName = CommandRequest['name'];

export interface BuiltCommand {
  /** Arguments after the global options (`--repo`). */
  args: string[];
  /** `status --json` has no envelope (docs/implementation/spec.md §6.6). */
  output: 'envelope' | 'status';
  /** Schema of the envelope without `.schema.json`, `null` for `status`. */
  schema: string | null;
}

export function buildCommand(request: CommandRequest): BuiltCommand {
  switch (request.name) {
    case 'status':
      return { args: ['status', '--json'], output: 'status', schema: null };
    case 'init': {
      const args = ['init'];
      if (request.timezone !== undefined) args.push(`--timezone=${request.timezone}`);
      if (request.workspace !== undefined) args.push(`--workspace=${request.workspace}`);
      return envelope(args, 'cli-init');
    }
    case 'capture': {
      if (request.mode === 'noAnalysis') return envelope(['capture', '--no-analysis'], 'cli-capture');
      if (request.mode === 'retry') {
        if (request.retrySnapshotId === undefined) throw new RangeError('retrySnapshotId fehlt');
        return envelope(['capture', `--retry=${request.retrySnapshotId}`], 'cli-capture');
      }
      return envelope(['capture'], 'cli-capture');
    }
    case 'journal': {
      const args = ['journal'];
      if (request.day !== undefined) args.push(`--day=${request.day}`);
      if (request.noAi === true) args.push('--no-ai');
      return envelope(args, 'cli-journal');
    }
    case 'note': {
      const args = ['note'];
      const option = (flag: string, value: string | number | undefined): void => {
        if (value !== undefined) args.push(`--${flag}=${value}`);
      };
      option('type', request.type);
      option('day', request.day);
      option('minutes', request.minutes);
      option('start', request.start);
      option('end', request.end);
      if (request.timeKind === 'measured') args.push('--measured');
      if (request.timeKind === 'estimated') args.push('--estimated');
      option('delay', request.delay);
      option('reason', request.reason);
      for (const alternative of request.alternatives ?? []) option('alternative', alternative);
      option('cause', request.cause);
      option('solution', request.solution);
      for (const ref of request.refs ?? []) option('ref', ref);
      args.push('--json', '--', request.text);
      return { args, output: 'envelope', schema: 'cli-note' };
    }
    case 'skip':
      return envelope(['skip', request.snapshotId, `--reason=${request.reason}`], 'cli-skip');
    case 'baseline': {
      const args = ['baseline', `--reason=${request.reason}`];
      if (request.force === true) args.push('--force');
      return envelope(args, 'cli-baseline');
    }
    case 'doctor':
      return envelope(request.live === true ? ['doctor', '--live'] : ['doctor'], 'cli-doctor');
    case 'scheduleStatus':
      return envelope(['schedule', 'status'], 'cli-schedule');
    case 'scheduleInstall':
      return envelope(request.update === true ? ['schedule', 'install', '--update'] : ['schedule', 'install'], 'cli-schedule');
    case 'schedulePause':
      return envelope(['schedule', 'pause'], 'cli-schedule');
    case 'scheduleResume':
      return envelope(['schedule', 'resume'], 'cli-schedule');
    case 'scheduleRemove':
      return envelope(['schedule', 'remove'], 'cli-schedule');
    case 'scheduleRun':
      return envelope(['schedule', 'run'], 'cli-schedule');
    case 'configCheck':
      return envelope(['config', 'check'], 'cli-config');
    case 'configSet': {
      if (request.changes.length === 0) throw new RangeError('config set braucht mindestens eine Änderung');
      const args = ['config', 'set', ...request.changes.map((change) => `${change.path}=${change.value}`)];
      if (request.dryRun === true) args.push('--dry-run');
      if (request.confirmPaidUsage === true) args.push('--confirm-paid-usage');
      return envelope(args, 'cli-config');
    }
  }
}

/** Appends `--json`; all commands except `note` (which places it before `--`) end with it. */
function envelope(args: string[], schema: string): BuiltCommand {
  return { args: [...args, '--json'], output: 'envelope', schema };
}

/** spec §3.7 */
export interface CommandClass {
  /** `write` holds the workspace lock in the CLI, `journal` is serialized by the app only. */
  kind: 'write' | 'journal' | 'doctor' | 'short';
  /** The command can call Claude (spec §12.2). */
  ai: boolean;
  /** A running command of this kind can be cancelled (spec §3.6). */
  cancellable: boolean;
}

export function classify(request: CommandRequest): CommandClass {
  switch (request.name) {
    case 'capture':
      return { kind: 'write', ai: request.mode !== 'noAnalysis', cancellable: true };
    case 'baseline':
    case 'skip':
      return { kind: 'write', ai: false, cancellable: true };
    case 'journal':
      return { kind: 'journal', ai: request.noAi !== true, cancellable: true };
    case 'doctor':
      return request.live === true
        ? { kind: 'write', ai: true, cancellable: true }
        : { kind: 'doctor', ai: false, cancellable: false };
    case 'scheduleRun':
      return { kind: 'short', ai: true, cancellable: false };
    case 'init':
    case 'note':
    case 'status':
    case 'scheduleStatus':
    case 'scheduleInstall':
    case 'schedulePause':
    case 'scheduleResume':
    case 'scheduleRemove':
    case 'configCheck':
    case 'configSet':
      return { kind: 'short', ai: false, cancellable: false };
  }
}

/** spec §12.1: the only commands the app may start without a user action. None of them calls a model. */
export function isAutoAllowed(request: CommandRequest): boolean {
  switch (request.name) {
    case 'status':
    case 'scheduleStatus':
    case 'configCheck':
      return true;
    case 'configSet':
      return request.dryRun === true;
    default:
      return false;
  }
}

/** Label for the invocation log and the run panel. Contains command and flag names, never values (I-12). */
export function describeCommand(request: CommandRequest): string {
  switch (request.name) {
    case 'capture':
      return request.mode === 'noAnalysis' ? 'capture --no-analysis' : request.mode === 'retry' ? 'capture --retry' : 'capture';
    case 'journal':
      return request.noAi === true ? 'journal --no-ai' : 'journal';
    case 'doctor':
      return request.live === true ? 'doctor --live' : 'doctor';
    case 'baseline':
      return request.force === true ? 'baseline --force' : 'baseline';
    case 'configSet':
      return request.dryRun === true ? 'config set --dry-run' : 'config set';
    case 'configCheck':
      return 'config check';
    case 'scheduleStatus':
      return 'schedule status';
    case 'scheduleInstall':
      return request.update === true ? 'schedule install --update' : 'schedule install';
    case 'schedulePause':
      return 'schedule pause';
    case 'scheduleResume':
      return 'schedule resume';
    case 'scheduleRemove':
      return 'schedule remove';
    case 'scheduleRun':
      return 'schedule run';
    case 'init':
    case 'note':
    case 'skip':
    case 'status':
      return request.name;
  }
}
