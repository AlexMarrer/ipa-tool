import type { RunHistoryEntry, SchedulePlan, ScheduleView } from '../../../shared/config';
import { SCHEDULE_STATE_TEXT, formatRunStamp, staleMessage } from '../../../shared/schedule-texts';
import type { ConfigPreview } from '../../../shared/config';
import { RUN_OUTCOME, type RunOutcome } from '../../../shared/messages';
import { Banner, Chip, ConfirmDialog, OutcomeChip, Table, Tooltip, type Column } from '../../components';
import { formatDuration, shortRunId } from '../format';

const WINDOW_END_TIP = 'Ob die Aufgabenplanung einen Lauf genau am Fensterende auslöst, ist nicht geprüft. Die Vorschau zählt ihn vorsichtig mit.';

/** Chip with state and sentence, next and last run, the task id small (spec §8.10). */
export function ScheduleStatusCard({ status, timezone }: { status: ScheduleView; timezone: string }) {
  if (status.problem !== null) {
    return (
      <Banner level={status.problem.kind === 'unsupported' ? 'info' : 'err'} title={status.problem.kind === 'unsupported' ? 'Der Zeitplan wird nur unter Windows verwaltet' : 'Der Zeitplan konnte nicht gelesen werden'}>
        {status.problem.message}
      </Banner>
    );
  }
  const state = status.state === null ? null : SCHEDULE_STATE_TEXT[status.state];
  return (
    <section className="card" aria-label="Zustand der Aufgabe">
      <div className="row">
        {state !== null ? <Chip tone={state.tone}>{state.label}</Chip> : <Chip>Unbekannt</Chip>}
        <span>{state?.text}</span>
      </div>
      {status.state === 'stale' ? <p className="schedule-stale">{staleMessage(status.differences)}</p> : null}
      {status.state === 'error' && status.detail !== null ? <p className="mono muted">{status.detail}</p> : null}
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Nächster Lauf</dt>
        <dd>{status.state === 'paused' || status.state === 'not_installed' ? '–' : formatRunStamp(status.nextRun, timezone)}</dd>
        <dt>Letzter Lauf</dt>
        <dd>{formatRunStamp(status.lastRun, timezone)}</dd>
      </dl>
      {status.taskName !== null ? (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          Aufgaben-ID <span className="mono">{status.taskName}</span>
        </p>
      ) : null}
    </section>
  );
}

/** Start times of a work day and the limit of Claude calls, from `config set --dry-run`; the app calculates nothing itself. */
export function SchedulePreview({ preview, locallyInvalid, loading }: { preview: ConfigPreview | null; locallyInvalid: boolean; loading: boolean }) {
  const plan: SchedulePlan | null = locallyInvalid ? null : (preview?.schedulePlan ?? null);
  const warnings = locallyInvalid ? [] : (preview?.findings.filter((finding) => finding.severity === 'warning') ?? []);
  const errors = locallyInvalid ? [] : (preview?.findings.filter((finding) => finding.severity === 'error') ?? []);
  return (
    <section className="card" aria-label="Vorschau eines Arbeitstags" aria-busy={loading}>
      <h3>Vorschau eines Arbeitstags</h3>
      {plan === null || plan.runTimes.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {loading && !locallyInvalid ? 'Vorschau wird berechnet …' : 'Keine Startzeiten, solange die Angaben ungültig sind.'}
        </p>
      ) : (
        <>
          <ul className="chip-list" aria-label="Startzeiten">
            {plan.runTimes.map((time) => (
              <li key={time}>
                {plan.includesWindowEndRun && time === plan.runTimes[plan.runTimes.length - 1] ? (
                  <Tooltip text={WINDOW_END_TIP}>
                    <span>
                      <Chip tone="accent">{time}</Chip>
                    </span>
                  </Tooltip>
                ) : (
                  <Chip>{time}</Chip>
                )}
              </li>
            ))}
          </ul>
          <p style={{ margin: '8px 0 2px' }}>
            <strong>Höchstens {plan.maxClaudeCallsPerDay} Claude-Aufrufe pro Arbeitstag</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {plan.runsPerDay} Läufe × {plan.maxAnalysesPerRun} Analysen pro Lauf. Ohne neue Arbeit ruft ein Lauf Claude gar nicht auf.
          </p>
        </>
      )}
      {errors.map((finding, index) => (
        <Banner key={`e${index}`} level="err">
          {finding.message}
        </Banner>
      ))}
      {warnings.map((finding, index) => (
        <Banner key={`w${index}`} level="warn">
          {finding.message}
        </Banner>
      ))}
      {preview?.failure != null ? <Banner level="err">{preview.failure}</Banner> : null}
    </section>
  );
}

const EXIT_TEXT: Record<number, string> = { 0: 'Erfolg' };

/** Run history from `runs.jsonl`, newest first (spec §8.10). */
export function ScheduleRunsTable({ runs, onOpenRun }: { runs: RunHistoryEntry[]; onOpenRun?: (entry: RunHistoryEntry) => void }) {
  const columns: Column<RunHistoryEntry>[] = [
    { key: 'time', header: 'Zeit', render: (run) => `${run.day.slice(8, 10)}.${run.day.slice(5, 7)}. ${run.time}` },
    { key: 'command', header: 'Befehl', render: (run) => <span className="mono">{run.command}</span> },
    {
      key: 'outcome',
      header: 'Ergebnis',
      render: (run) => (
        <>
          <OutcomeChip outcome={(run.outcome in RUN_OUTCOME ? run.outcome : 'error') as RunOutcome} />
          <span className="sr-only"> Exit-Code {run.exitCode}{EXIT_TEXT[run.exitCode] !== undefined ? `: ${EXIT_TEXT[run.exitCode]}` : ''}</span>
        </>
      ),
    },
    { key: 'duration', header: 'Dauer', render: (run) => formatDuration(run.durationMs) },
    {
      key: 'snapshot',
      header: 'Snapshot',
      render: (run) => (run.snapshotCreated === null ? '–' : onOpenRun !== undefined ? <button type="button" className="chip chip--ref" onClick={() => onOpenRun(run)}>{run.snapshotCreated}</button> : <span className="mono">{run.snapshotCreated}</span>),
    },
    { key: 'analyses', header: 'Analysen', render: (run) => `${run.analysesCompleted} abgeschlossen · ${run.analysesFailed} gescheitert` },
    { key: 'id', header: 'Lauf', render: (run) => <span className="mono" title={run.runId}>{shortRunId(run.runId)}</span> },
  ];
  return (
    <section aria-label="Lauf-Verlauf" className="stack" style={{ gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Lauf-Verlauf</h3>
      <Table caption="Lauf-Verlauf" columns={columns} rows={runs} rowKey={(run) => run.runId} empty="Noch keine Läufe. Nach dem Einrichten erscheinen hier die geplanten und die manuellen Läufe." />
    </section>
  );
}

export function ScheduleDeleteDialog({ taskName, onClose, onConfirm, inline }: { taskName: string | null; onClose: () => void; onConfirm: () => void; inline?: boolean }) {
  return (
    <ConfirmDialog title="Zeitplan löschen?" confirmLabel="Zeitplan löschen" danger onClose={onClose} onConfirm={onConfirm} {...(inline === true ? { inline } : {})}>
      <p>
        Die Windows-Aufgabe {taskName !== null ? <span className="mono">{taskName}</span> : null} wird entfernt. Danach laufen keine geplanten Erfassungen mehr. Konfiguration, Snapshots, Notizen und der Lauf-Verlauf bleiben erhalten. Einrichten ist jederzeit wieder möglich.
      </p>
    </ConfirmDialog>
  );
}

export function OutsideWindowDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog title="Ausserhalb des Zeitfensters" confirmLabel="Trotzdem auslösen" onClose={onClose} onConfirm={onConfirm}>
      <p>Jetzt liegt ausserhalb des Zeitfensters. Der Lauf endet ohne Aufnahme (<span className="mono">outside_window</span>) und ruft Claude nicht auf.</p>
    </ConfirmDialog>
  );
}
