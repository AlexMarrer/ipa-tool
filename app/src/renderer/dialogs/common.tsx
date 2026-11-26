import { useState, type ReactNode } from 'react';
import type { RunInput, RunSummary } from '../../shared/run';
import { describeRun } from '../../shared/run-texts';
import { Banner, Button } from '../components';
import type { AppActions } from '../store/appStore';

export type ActionState = { phase: 'idle' } | { phase: 'running' } | { phase: 'rejected'; message: string } | { phase: 'done'; summary: RunSummary };

/** Runs one action for a dialog and keeps its state; the dialog decides what each phase looks like. */
export function useAction(actions: AppActions, repositoryId: string) {
  const [state, setState] = useState<ActionState>({ phase: 'idle' });
  return {
    state,
    busy: state.phase === 'running',
    async start(input: RunInput): Promise<void> {
      setState({ phase: 'running' });
      const result = await actions.startRun(repositoryId, input);
      setState(result.started ? { phase: 'done', summary: result.summary } : { phase: 'rejected', message: result.message });
    },
    reset(): void {
      setState({ phase: 'idle' });
    },
  };
}

/** Message of the CLI for a field when it refused the input (exit code 2), `null` otherwise. */
export function usageError(state: ActionState): string | null {
  if (state.phase !== 'done' || state.summary.exitCode !== 2) return null;
  const messages = state.summary.errors.map((error) => error.message).filter((message) => message !== '');
  return messages.length > 0 ? messages.join(' ') : describeRun(state.summary).text;
}

/** The outcome of an action as a banner: a rejected start, or a result that is not a success and not a usage error. */
export function ResultNotice({ state }: { state: ActionState }) {
  if (state.phase === 'rejected') {
    return (
      <Banner level="info" title="Nicht gestartet">
        {state.message}
      </Banner>
    );
  }
  if (state.phase !== 'done' || state.summary.exitCode === 0 || state.summary.exitCode === 2) return null;
  const text = describeRun(state.summary);
  return (
    <Banner level={text.tone === 'err' ? 'err' : text.tone === 'warn' ? 'warn' : 'info'} title={text.title}>
      {text.text}
      {text.extra.map((line, index) => (
        <div key={index} className="muted">
          {line}
        </div>
      ))}
    </Banner>
  );
}

export interface FooterProps {
  /** Why confirming is locked, shown left of the buttons; `null` shows the shortcut. */
  blocked: string | null;
  confirmLabel: ReactNode;
  confirmAi?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Text left of the buttons instead of the shortcut. */
  hint?: string;
}

/** Footer of the action dialogs: reason of a lock or the shortcut, "Abbrechen" and the confirmation (spec §8.9). */
export function DialogFooter({ blocked, confirmLabel, confirmAi = false, busy = false, onConfirm, onClose, hint }: FooterProps) {
  return (
    <>
      <span className="dialog__hint" role={blocked !== null ? 'status' : undefined}>
        {blocked ?? hint ?? 'Strg+Enter bestätigt'}
      </span>
      <Button onClick={onClose}>Abbrechen</Button>
      <Button variant="primary" ai={confirmAi} disabled={blocked !== null || busy} {...(blocked !== null ? { disabledReason: blocked } : {})} onClick={onConfirm}>
        {busy ? 'Läuft …' : confirmLabel}
      </Button>
    </>
  );
}

/** Closing footer of a dialog that shows a result. */
export function DoneFooter({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  return (
    <>
      {children}
      <Button variant="primary" onClick={onClose}>
        Schliessen
      </Button>
    </>
  );
}
