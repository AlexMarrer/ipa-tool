import type { ReactNode } from 'react';
import type { IpaApi } from '../../shared/ipc';
import type { RunResultView, RunSummary } from '../../shared/run';
import type { EvidenceGroup, HaltView, SnapshotView } from '../../shared/views';
import { Button } from '../components';
import { BaselineDialog, RetryDialog, SkipDialog } from '../dialogs/ActionDialogs';
import { DoctorDialog } from '../dialogs/DoctorDialog';
import { NoteDialog } from '../dialogs/NoteDialog';
import { RunPanel } from '../layout/RunPanel';
import { JournalFailure } from '../pages/day/JournalTab';
import { createAppStore, type AppActions, type RunView } from '../store/appStore';

/**
 * Actions in their states (spec AD-15, Annex A groups Lauf, Dialoge, Notiz-Dialog, Journal). Built from fixed sample
 * data and an API that answers nothing, so the gallery never starts a command.
 */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10, marginBottom: 28 }} aria-label={title}>
      <h3 style={{ fontSize: 14, color: 'var(--mut)' }}>{title}</h3>
      <div style={{ display: 'grid', gap: 12, width: '100%', maxWidth: 820 }}>{children}</div>
    </section>
  );
}

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
/** No call is answered; the dialogs in the gallery are shown, not used. */
const stubApi = {
  config: { scanText: () => never() },
  overview: { load: () => never() },
  day: { index: () => never() },
  snapshot: { evidenceList: () => never() },
  run: { start: () => never() },
} as unknown as IpaApi;
const stubActions: AppActions = createAppStore(stubApi).actions;
const noop = (): void => undefined;

const REPO = 'mein-projekt-3fa9c1';
const STARTED = '2026-10-14T16:20:00+02:00';

const summaryOf = (overrides: Partial<RunSummary>): RunSummary => ({
  command: 'capture',
  exitCode: 0,
  outcome: 'ok',
  runId: 'R20261014T162000Z-d2e8',
  errors: [],
  warnings: [],
  output: '',
  failure: null,
  cancelled: false,
  result: null,
  lock: null,
  ...overrides,
});

const captureResult = (overrides: Partial<Extract<RunResultView, { kind: 'capture' }>> = {}): RunResultView => ({
  kind: 'capture',
  capture: 'created',
  snapshot: { id: 'S000006', commits: 2, evidence: 12, fileStates: 4 },
  outsideWindow: false,
  analysis: { claudeCalls: 1, completed: [{ snapshotId: 'S000006', mode: 'ai' }], failed: [], open: [] },
  retry: null,
  halt: null,
  ...overrides,
});

const view = (overrides: Partial<RunView>): RunView => ({
  runKey: 'k1',
  repositoryId: REPO,
  label: 'capture',
  ai: true,
  cancellable: true,
  startedAt: new Date().toISOString(),
  lines: [],
  finished: null,
  endedAt: null,
  ...overrides,
});

const finished = (summary: RunSummary): Pick<RunView, 'finished' | 'endedAt' | 'startedAt'> => ({
  startedAt: STARTED,
  endedAt: '2026-10-14T16:22:09+02:00',
  finished: { type: 'finished', runKey: 'k1', repositoryId: REPO, exitCode: summary.exitCode, cancelled: summary.cancelled, notice: summary.exitCode === 3 ? 'lock_held' : null, failure: summary.failure, summary },
});

const LINES = [
  { at: '2026-10-14T16:20:01+02:00', text: 'Lauf gestartet (capture)' },
  { at: '2026-10-14T16:20:03+02:00', text: 'Arbeitsstand prüfen' },
  { at: '2026-10-14T16:20:04+02:00', text: 'Snapshot S000006 gespeichert, 4 Dateizustände' },
  { at: '2026-10-14T16:20:04+02:00', text: 'Geheimnisprüfung: keine Verdachtsfälle' },
  { at: '2026-10-14T16:20:05+02:00', text: 'Analyse S000006: Claude-Aufruf 1 von 3 gestartet' },
  { at: '2026-10-14T16:20:25+02:00', text: 'Analyse S000006: wartet auf Antwort von Claude …', muted: true },
];

const snap = (overrides: Partial<SnapshotView>): SnapshotView => ({
  id: 'S000003',
  kind: 'work',
  capturedAt: '2026-10-14T14:00:00+02:00',
  observedPeriod: { from: '2026-10-14T12:00:00+02:00', to: '2026-10-14T14:00:00+02:00' },
  branch: 'main',
  commits: 2,
  evidence: 12,
  status: 'pending',
  attempts: { failed: 0, max: 3 },
  lastErrorCode: null,
  aiMode: 'deterministic',
  dayAttribution: 'day',
  withheld: { count: 1, detectors: ['assignment'] },
  gaps: [],
  runId: null,
  time: '14:00',
  ...overrides,
});

const halt: HaltView = {
  reason: 'branch_changed',
  detectedAt: '2026-10-14T16:00:00+02:00',
  expected: { branch: 'main', head: 'a41c9e2f00aa' },
  observed: { branch: 'feature/login', head: 'b52d0f3a11bb' },
  runId: 'R20261014T160000Z-aa11',
};

const evidence: EvidenceGroup[] = [
  {
    snapshotId: 'S000002',
    title: 'S000002 · Analyse abgeschlossen',
    items: [
      { ref: 'S000002:E001', id: 'E001', kind: 'state_delta', kindLabel: 'Zustandsänderung', path: 'src/app.ts', omitted: null },
      { ref: 'S000002:E002', id: 'E002', kind: 'commit_message', kindLabel: 'Commit-Nachricht', path: null, omitted: null },
    ],
  },
  { snapshotId: 'S000001', title: 'S000001 · Ausgangslage', items: [{ ref: 'S000001:E001', id: 'E001', kind: 'state_delta', kindLabel: 'Zustandsänderung', path: 'README.md', omitted: null }] },
];

const index = { timezone: 'Europe/Zurich', today: '2026-10-14', days: [] };
const dialogProps = { api: stubApi, actions: stubActions, repositoryId: REPO, inline: true as const, onClose: noop };
const noteProps = { ...dialogProps, timezone: 'Europe/Zurich', day: '2026-10-14' };
const note = (preset: NonNullable<Parameters<typeof NoteDialog>[0]['preset']>) => <NoteDialog {...noteProps} preset={{ index, groups: evidence, ...preset }} />;

export function ActionStates() {
  return (
    <>
      <Block title="Laufanzeige: läuft">
        <RunPanel run={view({ startedAt: new Date().toISOString(), lines: LINES.slice(0, 3) })} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} />
        <RunPanel run={view({ startedAt: new Date().toISOString(), lines: LINES })} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} defaultLive />
        <RunPanel run={undefined} foreign={{ command: 'capture', startedAt: STARTED }} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} />
      </Block>
      <Block title="Laufanzeige: Ergebnis">
        <RunPanel run={view({ lines: LINES, ...finished(summaryOf({ result: captureResult(), output: 'Hinweis des CLI' })) })} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} />
        <RunPanel
          run={view({
            ...finished(
              summaryOf({
                exitCode: 6,
                outcome: 'analysis_failed',
                errors: [{ code: 'analysis_failed', message: 'Die Analyse von S000006 ist nicht abgeschlossen.' }],
                result: captureResult({ analysis: { claudeCalls: 1, completed: [], failed: [{ snapshotId: 'S000006', code: 'timeout' }], open: [] } }),
              }),
            ),
          })}
          timezone="Europe/Zurich"
          onCancel={noop}
          onDismiss={noop}
          onGoTo={noop}
        />
        <RunPanel run={view({ ...finished(summaryOf({ exitCode: 3, outcome: 'lock_held', lock: { command: 'capture', startedAt: '16:20' } })) })} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} />
        <RunPanel run={view({ ...finished(summaryOf({ exitCode: null, outcome: null, cancelled: true })) })} timezone="Europe/Zurich" onCancel={noop} onDismiss={noop} />
      </Block>
      <Block title="Dialoge: Ausgangspunkt, Überspringen, Erneut versuchen">
        <BaselineDialog {...dialogProps} projectName={REPO} force={false} halt={halt} />
        <SkipDialog {...dialogProps} snapshot={snap({})} timezone="Europe/Zurich" />
        <RetryDialog actions={stubActions} repositoryId={REPO} inline onClose={noop} snapshot={snap({ status: 'exhausted', attempts: { failed: 3, max: 3 }, lastErrorCode: 'timeout', withheld: { count: 0, detectors: [] }, aiMode: 'none' })} />
      </Block>
      <Block title="Notiz-Dialog">
        {note({})}
        {note({ more: true, form: { type: 'decision', text: 'Wir bleiben bei SQLite.', reason: 'Weniger Betrieb', alternatives: ['Postgres'] } })}
        {note({ more: true, form: { type: 'problem', text: 'Lock blieb liegen', cause: 'Toter Prozess', solution: 'Lock erkannt' } })}
        {note({ more: true, form: { type: 'activity', text: 'Pair-Programming', minutes: '45' } })}
        {note({ more: true, form: { type: 'activity', text: 'Pair-Programming', timeMode: 'range', start: '09:10', end: '09:55', basis: 'measured' } })}
        {note({ more: true, form: { type: 'plan', text: 'Dialog planen', day: '2026-10-19' } })}
        {note({ more: true, evidence: true, form: { text: 'Mit Belegen', refs: ['S000002:E001'] } })}
      </Block>
      <Block title="Prüfen">
        <DoctorDialog inline outcome={null} onClose={noop} onAgain={noop} />
        <DoctorDialog
          inline
          onClose={noop}
          onAgain={noop}
          outcome={{
            started: true,
            summary: summaryOf({
              command: 'doctor',
              exitCode: 7,
              outcome: 'error',
              result: {
                kind: 'doctor',
                ok: false,
                checkedAt: '2026-10-14T16:00:00Z',
                git: { found: true, version: '2.47.1' },
                claude: { found: true, version: '2.1.4', loggedIn: false, authMethod: null },
                billing: { detected: false, allowPaidUsage: false, blocked: false, sources: [] },
                findings: ['Claude ist nicht angemeldet. Melde dich mit «claude» an.'],
              },
            }),
          }}
        />
      </Block>
      <Block title="Journal: Fehler">
        <JournalFailure
          previous={{ file: 'a', runId: 'R20261014T091500Z-a001', day: '2026-10-14', generatedAt: '2026-10-14T09:15:00+02:00', mode: 'no_ai', time: '09:15' }}
          messages={['Zeitüberschreitung beim KI-Schritt']}
          actions={
            <>
              <Button ai>Erneut versuchen</Button> <Button>Ohne KI erzeugen</Button>
            </>
          }
        />
      </Block>
    </>
  );
}
