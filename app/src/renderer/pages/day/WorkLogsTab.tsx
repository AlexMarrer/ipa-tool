import { useEffect, useState } from 'react';
import type { DayView, ReferenceIndex, SnapshotView, WorkLogView } from '../../../shared/views';
import { ANALYSIS_STATUS } from '../../../shared/messages';
import { OPEN_STATUSES } from '../../../shared/views';
import { Banner, Button, ContentLabel, EmptyState, LoadingSkeleton, StatusChip } from '../../components';
import { MarkdownView } from '../../markdown/MarkdownView';
import type { DocKind, RefInfo } from '../../markdown/plugins';
import { formatStamp, shortRunId } from '../format';
import { actionReason, jumpToReference, useLoad, usePageEnv } from '../env';

function labelOf(snapshot: SnapshotView): 'ai' | 'noAi' | 'baseline' | null {
  if (snapshot.kind === 'baseline') return 'baseline';
  return snapshot.aiMode === 'ai' ? 'ai' : snapshot.aiMode === 'deterministic' ? 'noAi' : null;
}

function docKindOf(log: WorkLogView): DocKind {
  if (log.replacement) return 'workLogNone';
  return log.snapshot.aiMode === 'ai' ? 'workLogAi' : 'workLogNoAi';
}

/** The snapshot shown first: the first with an open analysis, otherwise the newest (spec §8.4). */
export function defaultSnapshot(snapshots: readonly SnapshotView[]): string | null {
  const open = snapshots.find((snapshot) => OPEN_STATUSES.includes(snapshot.status));
  return open?.id ?? snapshots.at(-1)?.id ?? null;
}

export interface WorkLogsTabProps {
  view: DayView;
  references: ReferenceIndex | null;
}

export function WorkLogsTab({ view, references }: WorkLogsTabProps) {
  const env = usePageEnv();
  const [selected, setSelected] = useState<string | null>(() => env.focus?.snapshotId ?? defaultSnapshot(view.snapshots));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSelected(env.focus?.snapshotId ?? defaultSnapshot(view.snapshots));
    setNotice(null);
    // A new day or a jump from a chip selects again; reloads of the same day keep the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.day, env.focus?.snapshotId]);

  const log = useLoad(() => (selected === null ? Promise.resolve({ ok: true as const, value: null }) : env.api.snapshot.workLog(env.repositoryId, selected)), [selected, env.repositoryId]);

  if (view.snapshots.length === 0) {
    return <EmptyState title="Keine Work-Logs an diesem Tag" text="Ein Work-Log entsteht zu jedem Snapshot. An diesem Tag wurde nichts aufgenommen." />;
  }

  const run = async (reveal: boolean, current: WorkLogView): Promise<void> => {
    const ref = current.replacement ? ({ kind: 'workspaceFolder' } as const) : ({ kind: 'workLog', snapshotId: current.snapshot.id } as const);
    const result = reveal ? await env.api.shell.reveal(env.repositoryId, ref) : await env.api.shell.open(env.repositoryId, ref);
    setNotice(result.ok && result.value.opened ? null : 'Die Datei wurde nicht gefunden.');
  };

  return (
    <div className="wl-split">
      <nav className="listcol" aria-label="Snapshots des Tages">
        {view.snapshots.map((snapshot) => {
          const label = labelOf(snapshot);
          return (
            <button key={snapshot.id} type="button" className="snap-item" aria-current={snapshot.id === selected} onClick={() => setSelected(snapshot.id)}>
              <span className="row">
                <span className="mono">{snapshot.id}</span>
                <StatusChip status={snapshot.status} />
              </span>
              <span className="muted">
                {snapshot.time} · <span className="mono">{snapshot.branch ?? 'ohne Branch'}</span>
              </span>
              {label !== null ? <ContentLabel kind={label === 'baseline' ? 'baseline' : label} /> : null}
            </button>
          );
        })}
      </nav>
      <div>
        {log.data === null ? (
          log.error !== null ? <Banner level="err" title="Der Work-Log konnte nicht geladen werden" details={log.error.message} /> : <LoadingSkeleton loading={log.loading} lines={5} />
        ) : (
          <WorkLogBody
            log={log.data}
            timezone={view.timezone}
            references={references}
            notice={notice}
            highlight={env.focus?.evidence ?? null}
            onOpen={(reveal) => void run(reveal, log.data as WorkLogView)}
            onReference={(ref) => jumpToReference(env, references, ref)}
            onConfig={() => env.actions.selectPage('config')}
            retryReason={actionReason(env, 'retry')}
            skipReason={actionReason(env, 'skip')}
            onRetry={() => env.actions.openDialog({ kind: 'retry', snapshot: (log.data as WorkLogView).snapshot })}
            onSkip={() => env.actions.openDialog({ kind: 'skip', snapshot: (log.data as WorkLogView).snapshot, timezone: view.timezone })}
            onCopy={(text) => void env.api.shell.copy(text)}
            onExternal={(url) => void env.api.shell.openExternal(url)}
          />
        )}
      </div>
    </div>
  );
}

interface BodyProps {
  log: WorkLogView;
  timezone: string;
  references: ReferenceIndex | null;
  notice: string | null;
  highlight: string | null;
  onOpen: (reveal: boolean) => void;
  onReference: (ref: RefInfo) => void;
  onConfig: () => void;
  onCopy: (text: string) => void;
  onExternal: (url: string) => void;
  /** Why "Erneut versuchen" and "Überspringen" are locked right now, or `null`. */
  retryReason: string | null;
  skipReason: string | null;
  onRetry: () => void;
  onSkip: () => void;
}

function WorkLogBody({ log, timezone, references, notice, highlight, onOpen, onReference, onConfig, onCopy, onExternal, retryReason, skipReason, onRetry, onSkip }: BodyProps) {
  const { snapshot } = log;
  const label = labelOf(snapshot);
  const origin = snapshot.gaps.some((gap) => gap.type === 'rebaseline') ? 'Ausgangspunkt gesetzt' : snapshot.runId !== null ? 'Lauf' : 'unbekannt';
  return (
    <div className="stack">
      <header className="stack" style={{ gap: 8 }}>
        <div className="row">
          <h3 style={{ fontSize: 17 }}>Work-Log {snapshot.id}</h3>
          <StatusChip status={snapshot.status} />
          {label !== null ? <ContentLabel kind={label === 'baseline' ? 'baseline' : label} /> : null}
        </div>
        <dl className="kv">
          <dt>Zeitraum</dt>
          <dd>
            {formatStamp(snapshot.observedPeriod.from, timezone)} – {formatStamp(snapshot.observedPeriod.to, timezone)}
          </dd>
          <dt>Branch</dt>
          <dd className="mono">{snapshot.branch ?? 'unbekannt'}</dd>
          <dt>Herkunft</dt>
          <dd>
            {origin}
            {origin === 'Lauf' && snapshot.runId !== null ? (
              <>
                {' '}
                <span className="mono" title={snapshot.runId}>{shortRunId(snapshot.runId)}</span>
              </>
            ) : null}
          </dd>
        </dl>
        <div className="row">
          <Button disabled={log.replacement} onClick={() => onOpen(false)}>
            Datei öffnen
          </Button>
          <Button onClick={() => onOpen(true)}>Ordner zeigen</Button>
          {snapshot.status === 'exhausted' ? (
            <Button ai disabled={retryReason !== null} {...(retryReason !== null ? { disabledReason: retryReason } : {})} onClick={onRetry}>
              Erneut versuchen
            </Button>
          ) : null}
          {OPEN_STATUSES.includes(snapshot.status) ? (
            <Button disabled={skipReason !== null} {...(skipReason !== null ? { disabledReason: skipReason } : {})} onClick={onSkip}>
              Überspringen
            </Button>
          ) : null}
        </div>
        {notice !== null ? <Banner level="warn">{notice}</Banner> : null}
        {snapshot.status === 'blocked' ? (
          <Banner
            level="warn"
            title={ANALYSIS_STATUS.blocked.label}
            actions={<Button onClick={onConfig}>Zur Konfiguration</Button>}
          >
            Eingabe zu gross. Die Analyse wurde nicht gestartet, weil die Eingabe das Limit überschreitet. Limit in der Konfiguration erhöhen, danach erneut analysieren.
          </Banner>
        ) : null}
        {snapshot.status === 'exhausted' || snapshot.status === 'failed' ? (
          <Banner level={snapshot.status === 'exhausted' ? 'err' : 'warn'} title={ANALYSIS_STATUS[snapshot.status].label}>
            {ANALYSIS_STATUS[snapshot.status].hint}
          </Banner>
        ) : null}
      </header>
      <MarkdownView
        markdown={log.markdown}
        docKind={docKindOf(log)}
        snapshotId={snapshot.id}
        references={references}
        highlight={highlight}
        onReference={onReference}
        onCopy={onCopy}
        onOpenExternal={onExternal}
      />
    </div>
  );
}
