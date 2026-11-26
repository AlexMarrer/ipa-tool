import { REJECT_MESSAGES } from '../../shared/messages';
import type { LockState } from '../../shared/run';

/** Buttons that start a command; each has its own lock rule (spec §3.7), mirrored from the main process. */
export type ActionKind = 'capture' | 'captureNoAi' | 'journal' | 'journalNoAi' | 'retry' | 'skip' | 'baseline' | 'doctor' | 'note' | 'scheduleRun';

export const CAPTURE_LOCKED = 'Ein Lauf ist aktiv. Jetzt erfassen ist gesperrt, bis er endet.';
export const CLAUDE_NOT_READY = 'Claude ist nicht bereit. Prüfe die Voraussetzungen; aufnehmen funktioniert weiter mit «Nur aufnehmen».';

/**
 * Why an action is locked right now, or `null`. The main process decides again when the command starts; this only
 * keeps the buttons honest and gives them the reason as tooltip.
 */
export function lockReason(action: ActionKind, locks: LockState | undefined): string | null {
  if (locks === undefined || action === 'note') return null;
  const own = (kind: LockState['own'][number]['kind']): boolean => locks.own.some((run) => run.kind === kind);
  if (action === 'doctor') return own('doctor') ? REJECT_MESSAGES.doctor_active : null;
  if (action === 'journalNoAi') return own('journal') ? REJECT_MESSAGES.journal_run_active : null;
  if (own('write')) return action === 'capture' ? CAPTURE_LOCKED : REJECT_MESSAGES.write_run_active;
  if ((action === 'journal' || action === 'capture' || action === 'retry' || action === 'scheduleRun') && own('journal')) return REJECT_MESSAGES.journal_run_active;
  if (locks.foreign !== null) return REJECT_MESSAGES.foreign_lock;
  return null;
}

/** Whether a run of the app itself is active in the project (buttons stay locked while it runs). */
export const hasOwnRun = (locks: LockState | undefined): boolean => (locks?.own.length ?? 0) > 0;

const AI_ACTIONS: readonly ActionKind[] = ['capture', 'journal', 'retry', 'scheduleRun'];

/** Reason an action is unavailable: a lock, or Claude not being ready for the actions that call it. */
export function unavailableReason(action: ActionKind, locks: LockState | undefined, claudeReady: boolean | null): string | null {
  const locked = lockReason(action, locks);
  if (locked !== null) return locked;
  return AI_ACTIONS.includes(action) && claudeReady === false ? CLAUDE_NOT_READY : null;
}
