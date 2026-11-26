import { useEffect, useState } from 'react';
import { EXIT_CODE_MESSAGES } from '../../shared/messages';
import { describeRun, runningTitle } from '../../shared/run-texts';
import type { RunSummary } from '../../shared/run';
import { Button, Chip, ConfirmDialog, Icon } from '../components';
import { formatDuration, shortRunId } from '../pages/format';
import { fallbackSummary, type RunView } from '../store/appStore';
import { formatClock } from './format';

export type RunTarget = { tab: 'workLogs'; snapshotId: string | null } | { tab: 'journal'; day: string | null };

export interface RunPanelProps {
  run: RunView | undefined;
  /** A run of the scheduled task or the console holds the lock (spec §3.7). */
  foreign?: { command: string; startedAt: string } | null;
  timezone: string | null;
  onCancel: (runKey: string) => void;
  onDismiss: () => void;
  onGoTo?: (target: RunTarget) => void;
  /** Gallery: starts with the live output open. */
  defaultLive?: boolean;
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
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The snapshot of the run, as soon as a live line names it. */
function snapshotOf(run: RunView, summary: RunSummary | null): string | null {
  if (summary?.result?.kind === 'capture' && summary.result.snapshot !== null) return summary.result.snapshot.id;
  for (const line of run.lines) {
    const found = /^Snapshot (S\d{6}) gespeichert/.exec(line.text);
    if (found?.[1] !== undefined) return found[1];
  }
  return null;
}

function targetOf(summary: RunSummary): RunTarget | null {
  if (summary.exitCode !== 6 || summary.result === null) return null;
  if (summary.result.kind === 'journal') return { tab: 'journal', day: summary.result.day };
  if (summary.result.kind === 'capture') return { tab: 'workLogs', snapshotId: summary.result.analysis?.failed[0]?.snapshotId ?? summary.result.snapshot?.id ?? null };
  return null;
}

/** Fixed frame at the bottom: collapsible, shows the active or the last run and a foreign run (spec §8.7). */
export function RunPanel({ run, foreign = null, timezone, onCancel, onDismiss, onGoTo, defaultLive = false }: RunPanelProps) {
  const [open, setOpen] = useState(true);
  const [live, setLive] = useState(defaultLive);
  const [confirming, setConfirming] = useState(false);
  const running = run !== undefined && run.finished === null;
  const elapsed = useElapsed(run?.startedAt ?? null, running);
  const summary = run?.finished == null ? null : (run.finished.summary ?? fallbackSummary(run.finished));
  const text = summary !== null ? describeRun(summary) : null;
  const snapshot = run === undefined ? null : snapshotOf(run, summary);
  const target = summary !== null ? targetOf(summary) : null;
  const started = run === undefined ? null : formatClock(run.startedAt, timezone);
  const duration = run !== undefined && run.endedAt !== null ? formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) : null;
  const exitText = run?.finished?.exitCode != null ? `Exit-Code ${run.finished.exitCode}: ${EXIT_CODE_MESSAGES[run.finished.exitCode]?.title ?? 'unbekannt'}` : null;

  const title = run === undefined ? (foreign !== null ? 'Ein anderer Lauf ist aktiv' : 'Läufe') : running ? runningTitle(run.label) : (text?.title ?? 'Lauf beendet');

  return (
    <section className="runpanel" aria-label="Laufanzeige">
      <button type="button" className="runpanel__head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {running ? <Icon name="refresh" className="spin" /> : <Icon name="clock" />}
        <span className="runpanel__title">{title}</span>
        {running ? <Chip tone="accent">Läuft</Chip> : text !== null ? <Chip tone={text.tone === 'err' ? 'err' : text.tone === 'warn' ? 'warn' : 'neutral'}>{text.chip}</Chip> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-up'} />
      </button>
      {open ? (
        <div className="runpanel__body">
          {run === undefined ? (
            foreign !== null ? (
              <span>
                Ein anderer Lauf ist aktiv ({foreign.command}, seit {formatClock(foreign.startedAt, timezone)}). Aktionen, die Claude aufrufen oder schreiben, sind gesperrt, bis er endet.
              </span>
            ) : (
              <span>Kein Lauf aktiv.</span>
            )
          ) : (
            <>
              {running ? (
                <div className="runpanel__meta">
                  Gestartet {started} · Laufzeit {elapsed}
                  {snapshot !== null ? <> · Snapshot <span className="mono">{snapshot}</span></> : null}
                </div>
              ) : (
                <>
                  {text !== null ? <p className="runpanel__text">{text.text}</p> : null}
                  {text?.extra.map((line, index) => (
                    <p key={index} className="runpanel__text muted">
                      {line}
                    </p>
                  ))}
                  <div className="runpanel__meta">
                    {duration !== null && !run.finished?.cancelled ? <>Dauer {duration}</> : null}
                    {snapshot !== null ? <> · Snapshot <span className="mono">{snapshot}</span></> : null}
                    {summary?.runId != null ? (
                      <>
                        {' '}
                        · Lauf <span className="mono" title={summary.runId}>{shortRunId(summary.runId)}</span>
                      </>
                    ) : null}
                    {exitText !== null ? <> · {exitText}</> : null}
                  </div>
                </>
              )}
              <div>
                <button type="button" className="runpanel__toggle" aria-expanded={live} onClick={() => setLive((value) => !value)}>
                  <Icon name={live ? 'chevron-down' : 'chevron-up'} /> {running ? 'Live-Ausgabe' : 'Ausgabe'}
                </button>
                {live ? (
                  <div>
                    <ol className="runpanel__lines" aria-live={running ? 'polite' : 'off'}>
                      {run.lines.map((line, index) => (
                        <li key={index} className={line.muted === true || (running && index === run.lines.length - 1) ? 'muted' : undefined}>
                          <time dateTime={line.at}>{formatClock(line.at, timezone)}</time>
                          <span>{line.text}</span>
                        </li>
                      ))}
                      {run.lines.length === 0 ? <li className="muted">Noch keine Zeilen.</li> : null}
                    </ol>
                    {!running && summary !== null && summary.output !== '' ? <pre className="runpanel__output">{summary.output}</pre> : null}
                  </div>
                ) : null}
              </div>
              <div className="row">
                {running && run.cancellable ? (
                  <Button variant="danger" onClick={() => setConfirming(true)}>
                    Abbrechen
                  </Button>
                ) : null}
                {!running && target !== null && onGoTo !== undefined ? (
                  <Button variant="primary" onClick={() => onGoTo(target)}>
                    {target.tab === 'journal' ? 'Zum Journal' : 'Zu den Work-Logs'}
                  </Button>
                ) : null}
                {!running ? (
                  <Button variant="ghost" onClick={onDismiss}>
                    Schliessen
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      {confirming && run !== undefined ? (
        <ConfirmDialog
          title="Lauf wirklich abbrechen?"
          confirmLabel="Lauf abbrechen"
          cancelLabel="Weiterlaufen lassen"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onCancel(run.runKey);
          }}
        >
          <p>Bereits gespeicherte Snapshots bleiben erhalten.</p>
          <p>Ein abgebrochener Claude-Aufruf zählt als gescheiterter Versuch.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
