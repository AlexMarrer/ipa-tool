import { useEffect, useState } from 'react';
import { EXIT_CODE_MESSAGES } from '../../shared/messages';
import { Button, Chip, ConfirmDialog, Icon } from '../components';
import type { RunView } from '../store/appStore';
import { formatClock } from './format';

export interface RunPanelProps {
  run: RunView | undefined;
  timezone: string | null;
  onCancel: (runKey: string) => void;
  onDismiss: () => void;
}

function useElapsed(startedAt: string | null, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (startedAt === null) return '';
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Frame at the bottom: collapsible, shows the active or last run (content and actions follow in the actions package). */
export function RunPanel({ run, timezone, onCancel, onDismiss }: RunPanelProps) {
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const running = run !== undefined && run.finished === null;
  const elapsed = useElapsed(run?.startedAt ?? null, running);

  return (
    <section className="runpanel" aria-label="Laufanzeige">
      <button type="button" className="runpanel__head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {running ? <Icon name="refresh" className="spin" /> : <Icon name="clock" />}
        <span className="runpanel__title">{run === undefined ? 'Läufe' : run.label}</span>
        {running ? <Chip tone="accent">läuft {elapsed}</Chip> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-up'} />
      </button>
      {open ? (
        <div className="runpanel__body">
          {run === undefined ? (
            <span>Kein Lauf aktiv.</span>
          ) : (
            <>
              <ol className="runpanel__lines" aria-live="polite">
                {run.lines.map((line, index) => (
                  <li key={index} className={line.muted === true ? 'muted' : undefined}>
                    <time dateTime={line.at}>{formatClock(line.at, timezone)}</time>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
              {run.finished !== null ? (
                <div>
                  <Chip tone={run.finished.cancelled ? 'neutral' : run.finished.exitCode === 0 || run.finished.notice !== null ? 'neutral' : 'warn'}>
                    {run.finished.cancelled
                      ? 'Lauf abgebrochen'
                      : (EXIT_CODE_MESSAGES[run.finished.exitCode ?? -1]?.title ?? 'Lauf beendet')}
                  </Chip>{' '}
                  <Button variant="ghost" onClick={onDismiss}>
                    Schliessen
                  </Button>
                </div>
              ) : run.cancellable ? (
                <div>
                  <Button variant="danger" onClick={() => setConfirming(true)}>
                    Abbrechen
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {confirming && run !== undefined ? (
        <ConfirmDialog
          title="Lauf wirklich abbrechen?"
          confirmLabel="Lauf abbrechen"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onCancel(run.runKey);
          }}
        >
          Ein abgebrochener Claude-Aufruf zählt als gescheiterter Versuch. Die Daten bleiben konsistent, der nächste Lauf übernimmt Unfertiges.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
