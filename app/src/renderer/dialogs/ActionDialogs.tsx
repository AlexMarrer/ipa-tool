import { useEffect, useState } from 'react';
import { clockOfTimestamp } from '../../shared/dates';
import type { IpaApi } from '../../shared/ipc';
import { ANALYSIS_STATUS, ATTEMPT_ERROR_TEXT } from '../../shared/messages';
import { describeRun, detectorLabel } from '../../shared/run-texts';
import type { HaltView, SnapshotView } from '../../shared/views';
import { Banner, Dialog, StatusChip } from '../components';
import type { AppActions } from '../store/appStore';
import { DialogFooter, DoneFooter, ResultNotice, useAction, usageError } from './common';
import { ReasonField, useReason } from './ReasonField';

interface Base {
  api: IpaApi;
  actions: AppActions;
  repositoryId: string;
  onClose: () => void;
  /** Renders in place without scrim, for the state gallery. */
  inline?: boolean;
}

const short = (head: string | null): string => (head === null ? 'nicht gefunden' : head.slice(0, 7));

function StateCard({ title, value }: { title: string; value: { branch: string | null; head: string | null } | null }) {
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      {value === null ? (
        <span className="muted">kein Halt aktiv</span>
      ) : (
        <span>
          Branch <span className="mono">{value.branch ?? 'unbekannt'}</span>
          <br />
          HEAD <span className="mono">{short(value.head)}</span>
        </span>
      )}
    </section>
  );
}

/** "Neuen Ausgangspunkt setzen" (spec §8.9). Without an active halt it is reached only through "Trotzdem setzen" (`--force`). */
export function BaselineDialog({ api, actions, repositoryId, projectName, force, onClose, inline, halt: known }: Base & { projectName: string; force: boolean; /** Gallery: the halt to show, without loading it. */ halt?: HaltView | null }) {
  const reason = useReason(api, repositoryId);
  const action = useAction(actions, repositoryId);
  const [halt, setHalt] = useState<HaltView | null | undefined>(known);

  useEffect(() => {
    if (known !== undefined) return;
    let live = true;
    void api.overview.load(repositoryId).then((result) => {
      if (live) setHalt(result.ok ? result.value.halt : null);
    });
    return () => {
      live = false;
    };
  }, [api, repositoryId, known]);

  const done = action.state.phase === 'done' && action.state.summary.exitCode === 0;
  const blocked = halt === undefined ? 'Der Stand wird gelesen.' : reason.blocked;
  const confirm = (): void => {
    if (blocked === null && !action.busy) void action.start({ name: 'baseline', reason: reason.value, ...(force || halt === null ? { force: true } : {}) });
  };

  return (
    <Dialog
      title="Neuen Ausgangspunkt setzen"
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={done ? onClose : confirm}
      footer={done ? <DoneFooter onClose={onClose} /> : <DialogFooter blocked={blocked} confirmLabel="Ausgangspunkt setzen" busy={action.busy} onConfirm={confirm} onClose={onClose} />}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {projectName}
      </p>
      {done && action.state.phase === 'done' ? (
        <Banner level="info" title="Erledigt">
          {describeRun(action.state.summary).text}
        </Banner>
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>Das Tool nimmt ab dem jetzigen Stand des Repositorys neu auf. Das Repository selbst wird nicht verändert.</p>
          <div className="grid-cards">
            <StateCard title="Bisheriger Ausgangspunkt" value={halt?.expected ?? null} />
            <StateCard title="Neuer Ausgangspunkt" value={halt?.observed ?? null} />
          </div>
          <ReasonField reason={reason} serverError={usageError(action.state)} />
          <Banner level="warn" title="Lücke">
            Zwischen den beiden Ständen entsteht eine Lücke.{' '}
            {halt?.expected.head != null ? (
              <>
                Änderungen ab <span className="mono">{short(halt.expected.head)}</span> bis zum neuen Ausgangspunkt werden nicht analysiert.
              </>
            ) : (
              'Änderungen bis zum neuen Ausgangspunkt werden nicht analysiert.'
            )}{' '}
            Die Lücke bleibt im Journal sichtbar, mit deinem Grund.
          </Banner>
          {halt === null ? <Banner level="info">Es ist kein Halt aktiv. Der Ausgangspunkt wird trotzdem neu gesetzt.</Banner> : null}
          <ResultNotice state={action.state} />
        </div>
      )}
    </Dialog>
  );
}

/** Period of a snapshot as `12:00–14:00` in the zone of the project. */
export function periodText(snapshot: SnapshotView, timezone: string): string {
  const to = clockOfTimestamp(snapshot.observedPeriod.to, timezone)?.slice(0, 5) ?? '';
  const from = snapshot.observedPeriod.from === null ? null : (clockOfTimestamp(snapshot.observedPeriod.from, timezone)?.slice(0, 5) ?? null);
  return from === null ? `bis ${to}` : `${from}–${to}`;
}

/** "Analyse überspringen" (spec §8.9): reason required, preview of the line in the journal. */
export function SkipDialog({ api, actions, repositoryId, snapshot, timezone, onClose, inline }: Base & { snapshot: SnapshotView; timezone: string }) {
  const reason = useReason(api, repositoryId);
  const action = useAction(actions, repositoryId);
  const period = periodText(snapshot, timezone);
  const status = ANALYSIS_STATUS[snapshot.status];
  const done = action.state.phase === 'done' && action.state.summary.exitCode === 0;
  const confirm = (): void => {
    if (reason.blocked === null && !action.busy) void action.start({ name: 'skip', snapshotId: snapshot.id, reason: reason.value });
  };
  const detectors = snapshot.withheld.detectors;

  return (
    <Dialog
      title="Analyse überspringen"
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={done ? onClose : confirm}
      footer={done ? <DoneFooter onClose={onClose} /> : <DialogFooter blocked={reason.blocked} confirmLabel="Überspringen" busy={action.busy} onConfirm={confirm} onClose={onClose} />}
    >
      <p className="row" style={{ marginTop: 0 }}>
        <span className="mono">{snapshot.id}</span> · {period}
        {snapshot.aiMode === 'deterministic' ? ' · ohne KI' : ''} <StatusChip status={snapshot.status} />
      </p>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        {status.label}
        {snapshot.withheld.count > 0
          ? `: Inhalt zurückgehalten (${detectors.map((name) => `Detektor ${name}, ${detectorLabel(name)}`).join('; ')}).`
          : status.hint !== null
            ? `. ${status.hint}`
            : '.'}
      </p>
      {done && action.state.phase === 'done' ? (
        <Banner level="info" title="Erledigt">
          {describeRun(action.state.summary).text}
        </Banner>
      ) : (
        <div className="stack">
          <ReasonField reason={reason} serverError={usageError(action.state)} />
          <section className="card" aria-label="So erscheint es im Journal">
            <h3>So erscheint es im Journal</h3>
            <p style={{ margin: 0 }}>
              {snapshot.id} übersprungen. Zeitraum {period} ist nicht analysiert.
              {reason.value.trim() !== '' && reason.detectors.length === 0 ? <> Grund: {reason.value.trim()}</> : ' Grund: …'}
            </p>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Der Snapshot und seine Belege bleiben unverändert. Die Lücke steht unter «Offene Analysen und Erfassungslücken».
            </p>
          </section>
          <ResultNotice state={action.state} />
        </div>
      )}
    </Dialog>
  );
}

/** "Analyse erneut versuchen" (spec §8.9): only for `exhausted`; it calls Claude, which the text says in the words of §12.7. */
export function RetryDialog({ actions, repositoryId, snapshot, onClose, inline }: Omit<Base, 'api'> & { snapshot: SnapshotView }) {
  const action = useAction(actions, repositoryId);
  const { failed, max } = snapshot.attempts;
  const lastError = snapshot.lastErrorCode === null ? null : (ATTEMPT_ERROR_TEXT[snapshot.lastErrorCode] ?? snapshot.lastErrorCode);
  const done = action.state.phase === 'done' && action.state.summary.exitCode === 0;
  const confirm = (): void => {
    if (!action.busy) void action.start({ name: 'capture', mode: 'retry', retrySnapshotId: snapshot.id });
  };

  return (
    <Dialog
      title="Analyse erneut versuchen"
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={done ? onClose : confirm}
      footer={
        done ? (
          <DoneFooter onClose={onClose} />
        ) : (
          <DialogFooter blocked={null} hint={`Versuch ${failed + 1}, von Hand ausgelöst`} confirmLabel="Erneut versuchen" confirmAi busy={action.busy} onConfirm={confirm} onClose={onClose} />
        )
      }
    >
      <p className="row" style={{ marginTop: 0 }}>
        <span className="mono">{snapshot.id}</span> <StatusChip status={snapshot.status} />
      </p>
      {done && action.state.phase === 'done' ? (
        <Banner level="info" title="Erledigt">
          {describeRun(action.state.summary).text}
        </Banner>
      ) : (
        <div className="stack">
          <div>
            <div className="attempt-bars" role="img" aria-label={`Versuche ${failed} von ${max}`}>
              {Array.from({ length: max }, (_unused, index) => (
                <span key={index} className={index < failed ? 'attempt-bar attempt-bar--used' : 'attempt-bar'} />
              ))}
            </div>
            <div className="muted">
              Versuche {failed} von {max}
              {failed >= max ? ' · alle verbraucht' : ''}
            </div>
          </div>
          {lastError !== null ? (
            <div>
              Letzte Fehlerklasse: <strong>{lastError}</strong>
            </div>
          ) : null}
          <Banner level="info" title="Das löst einen Claude-Aufruf aus.">
            Gesendet werden die Zustandsänderungen des Snapshots, die Commit-Nachrichten, Testberichte, deine Notizen aus dem Beobachtungszeitraum und die Kontextdateien. Nie gesendet werden Commit-, Staged- und Unstaged-Diffs, ausgeschlossene oder zurückgehaltene Inhalte, Pfade ausgeschlossener Dateien, E-Mail-Adressen und frühere Journal-Entwürfe.
          </Banner>
          <ResultNotice state={action.state} />
        </div>
      )}
    </Dialog>
  );
}
