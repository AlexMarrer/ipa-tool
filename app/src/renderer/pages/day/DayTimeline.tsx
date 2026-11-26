import { useState } from 'react';
import type { DayView, NoteView, RunView, SnapshotView } from '../../../shared/views';
import { RUN_OUTCOME, type RunOutcome } from '../../../shared/messages';
import { Chip, EmptyState, Icon, OutcomeChip, StatusChip, type IconName } from '../../components';
import { NOTE_TYPE_LABEL, formatStamp, noteFigure, noteTitle, shortRunId } from '../format';

const NOTE_ICON: Record<NoteView['type'], IconName> = { general: 'info', activity: 'clock', problem: 'warning', decision: 'branch', insight: 'bulb', plan: 'calendar' };

const QUIET_TEXT: Record<string, string> = {
  ok: 'Erfassung ohne Auffälligkeit',
  unchanged: 'Keine neue Arbeit',
  outside_window: 'Ausserhalb des Zeitfensters',
};

export interface DayTimelineProps {
  view: DayView;
}

function SnapshotDetails({ snapshot, timezone }: { snapshot: SnapshotView; timezone: string }) {
  return (
    <div className="tl-detail">
      <span>
        Zeitraum {formatStamp(snapshot.observedPeriod.from, timezone)} – {formatStamp(snapshot.observedPeriod.to, timezone)}
        {snapshot.branch !== null ? <> · Branch <span className="mono">{snapshot.branch}</span></> : null}
      </span>
      {snapshot.dayAttribution === 'unclear' ? <span>Überspannt mehrere Tage und zählt an keinem Tag als ausgeführte Arbeit.</span> : null}
      {snapshot.withheld.count > 0 ? (
        <span>
          {snapshot.withheld.count} Einheit(en) zurückgehalten{snapshot.withheld.detectors.length > 0 ? ` (Detektor ${snapshot.withheld.detectors.join(', ')})` : ''}.
        </span>
      ) : null}
    </div>
  );
}

function NoteDetails({ note }: { note: NoteView }) {
  const lines: string[] = [];
  if (note.reason !== null) lines.push(`Grund ${note.reason}`);
  if (note.alternatives.length > 0) lines.push(`Geprüfte Alternative ${note.alternatives.join(', ')}`);
  if (note.cause !== null) lines.push(`Ursache ${note.cause}`);
  if (note.solution !== null) lines.push(`Lösung ${note.solution}`);
  if (note.withheld !== null) lines.push(`Zurückgehalten (Detektor ${note.withheld.detectors.join(', ')})`);
  return (
    <div className="tl-detail">
      {note.text.includes('\n') ? <span style={{ whiteSpace: 'pre-wrap' }}>{note.text}</span> : null}
      {lines.length === 0 && !note.text.includes('\n') ? <span>Keine weiteren Angaben.</span> : lines.map((line) => <span key={line}>{line}</span>)}
    </div>
  );
}

function RunDetails({ run }: { run: RunView }) {
  return (
    <div className="tl-detail">
      <span>
        Lauf <span className="mono" title={run.runId}>{shortRunId(run.runId)}</span> · <span className="mono">{run.command}</span>
      </span>
      {run.exitCode === 5 ? <span>Später erneut versuchen.</span> : null}
      {run.errorCodes.length > 0 ? <span>Fehlercodes: {run.errorCodes.join(', ')}</span> : null}
    </div>
  );
}

/** Rows of the day by time: snapshots, notes and runs; quiet runs are hidden behind a link (spec §8.3). */
export function DayTimeline({ view }: DayTimelineProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showQuiet, setShowQuiet] = useState(false);
  const snapshots = new Map(view.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const notes = new Map(view.notes.map((note) => [note.id, note]));
  const runs = new Map(view.runs.map((run) => [run.runId, run]));
  const quiet = (run: RunView): boolean => run.outcome in QUIET_TEXT;
  const quietCount = view.runs.filter(quiet).length;

  const toggle = (id: string): void =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const visible = view.timeline.filter((entry) => entry.kind !== 'run' || showQuiet || !quiet(runs.get(entry.id) as RunView));
  if (view.timeline.length === 0) {
    return <EmptyState title="Keine Einträge" text="An diesem Tag gibt es noch keine Aufnahme, keine Notiz und keinen Lauf." />;
  }

  return (
    <div>
      <ul className="timeline" aria-label="Zeitstrahl">
        {visible.map((entry) => {
          const id = `${entry.kind}:${entry.id}`;
          const expanded = open.has(id);
          let title = '';
          let figure = '';
          let icon: IconName = 'info';
          let iconTitle = '';
          let chips: React.ReactNode = null;
          let details: React.ReactNode = null;
          let quietRow = false;
          if (entry.kind === 'snapshot') {
            const snapshot = snapshots.get(entry.id) as SnapshotView;
            title = `Snapshot ${snapshot.id}${snapshot.dayAttribution === 'unclear' ? ' · Tageszuordnung unklar' : ''}`;
            figure = `Commits ${snapshot.commits} · Belege ${snapshot.evidence}`;
            icon = 'bookmark';
            iconTitle = 'Snapshot';
            chips =
              snapshot.kind === 'baseline' ? (
                <StatusChip status="baseline" />
              ) : snapshot.status !== 'complete' ? (
                <StatusChip status={snapshot.status} />
              ) : null;
            details = <SnapshotDetails snapshot={snapshot} timezone={view.timezone} />;
          } else if (entry.kind === 'note') {
            const note = notes.get(entry.id) as NoteView;
            title = noteTitle(note.text);
            figure = noteFigure(note);
            icon = NOTE_ICON[note.type];
            iconTitle = NOTE_TYPE_LABEL[note.type];
            chips = note.withheld !== null ? <Chip tone="warn" icon="warning">zurückgehalten</Chip> : null;
            details = <NoteDetails note={note} />;
          } else {
            const run = runs.get(entry.id) as RunView;
            quietRow = quiet(run);
            title = QUIET_TEXT[run.outcome] ?? (RUN_OUTCOME[run.outcome as RunOutcome]?.label ?? run.outcome);
            figure = `Exit-Code ${run.exitCode}`;
            icon = 'refresh';
            iconTitle = 'Lauf';
            chips = quietRow ? null : <OutcomeChip outcome={(run.outcome in RUN_OUTCOME ? run.outcome : 'error') as RunOutcome} />;
            details = <RunDetails run={run} />;
          }
          return (
            <li key={id}>
              <button type="button" className={quietRow ? 'tl-row tl-row--quiet' : 'tl-row'} aria-expanded={expanded} onClick={() => toggle(id)}>
                <span className="tl-time">{entry.time ?? '–'}</span>
                <Icon name={icon} title={iconTitle} />
                <span>
                  {title} {chips}
                </span>
                <span className="tl-meta">{figure}</span>
              </button>
              {expanded ? details : null}
            </li>
          );
        })}
      </ul>
      {quietCount > 0 ? (
        <button type="button" className="btn btn--ghost" onClick={() => setShowQuiet((value) => !value)}>
          {showQuiet ? 'Unauffällige Läufe ausblenden' : `${quietCount} unauffällige ${quietCount === 1 ? 'Lauf' : 'Läufe'} einblenden`}
        </button>
      ) : null}
    </div>
  );
}
