import type { ReactNode } from 'react';
import type { AttentionItem, DayView, HaltView, NoteView, RunView, SnapshotView } from '../../shared/views';
import { DayCalendar } from '../pages/day/DayHeader';
import { AttentionPanel } from '../pages/day/AttentionPanel';
import { DaySummary } from '../pages/day/DaySummary';
import { DayTimeline } from '../pages/day/DayTimeline';
import { MarkdownView } from '../markdown/MarkdownView';
import { ClaudeWarning, HaltBanner } from '../pages/overview/OverviewPage';

/**
 * Reading views in their states (spec AD-15, Annex A groups Tag, Notizen, Journal, Übersicht, Halt). Built from fixed
 * sample data, without IPC. Only part of the development and test builds, like the rest of the gallery.
 */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10, marginBottom: 28 }} aria-label={title}>
      <h3 style={{ fontSize: 14, color: 'var(--mut)' }}>{title}</h3>
      <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 820 }}>{children}</div>
    </section>
  );
}

const position = { branch: 'main', head: 'a1b2c3d4e5f6' };
const HALTS: HaltView['reason'][] = ['branch_changed', 'history_rewritten', 'head_missing'];

const snap = (id: string, overrides: Partial<SnapshotView>): SnapshotView => ({
  id,
  kind: 'work',
  capturedAt: '2026-10-14T10:00:00+02:00',
  observedPeriod: { from: '2026-10-14T09:00:00+02:00', to: '2026-10-14T10:00:00+02:00' },
  branch: 'main',
  commits: 2,
  evidence: 12,
  status: 'complete',
  attempts: { failed: 0, max: 3 },
  lastErrorCode: null,
  aiMode: 'ai',
  dayAttribution: 'day',
  withheld: { count: 0, detectors: [] },
  gaps: [],
  runId: null,
  time: '10:00',
  ...overrides,
});

const note = (id: string, overrides: Partial<NoteView>): NoteView => ({
  id,
  type: 'activity',
  text: 'Projektliste umgesetzt',
  activityDay: '2026-10-14',
  recordedAt: '2026-10-14T08:15:00+02:00',
  time: { minutes: 45, basis: 'measured', start: null, end: null },
  delay: null,
  reason: null,
  alternatives: [],
  cause: null,
  solution: null,
  refs: [],
  withheld: null,
  displayTime: '08:15',
  ...overrides,
});

const run = (runId: string, outcome: string, time: string): RunView => ({
  runId,
  command: 'capture',
  startedAt: `2026-10-14T${time}:00+02:00`,
  outcome,
  exitCode: outcome === 'unstable' ? 5 : 0,
  durationMs: 2300,
  errorCodes: [],
  snapshotCreated: null,
  time,
});

const SAMPLE_DAY: DayView = {
  day: '2026-10-14',
  weekday: 'Mittwoch',
  title: 'Mittwoch, 14. Oktober 2026',
  timezone: 'Europe/Zurich',
  isFuture: false,
  isToday: false,
  snapshots: [
    snap('S000001', { kind: 'baseline', aiMode: 'deterministic', dayAttribution: 'baseline', commits: 0, evidence: 0, time: '08:00' }),
    snap('S000002', {}),
    snap('S000003', { status: 'exhausted', aiMode: 'none', attempts: { failed: 3, max: 3 }, time: '11:30' }),
    snap('S000004', { dayAttribution: 'unclear', observedPeriod: { from: '2026-10-13T16:00:00+02:00', to: '2026-10-14T09:00:00+02:00' }, time: '09:00' }),
  ],
  notes: [
    note('N20261014T081500Z-0001', {}),
    note('N20261014T090000Z-0002', { type: 'problem', text: 'Lock blieb liegen', time: null, delay: { minutes: 20, basis: 'estimated' }, cause: 'Toter Prozess', solution: 'Lock erkannt', displayTime: '09:00' }),
    note('N20261014T100000Z-0003', { type: 'plan', text: 'Dialog planen', time: { minutes: 60, basis: 'estimated', start: null, end: null }, displayTime: '10:00' }),
  ],
  runs: [run('R20261014T111000Z-aaaa', 'ok', '11:10'), run('R20261014T112000Z-d2e8', 'unstable', '11:20')],
  drafts: [],
  summary: { snapshotCount: 4, noteCount: 3, time: { time: { measured: 45, estimated: 0 }, planned: { measured: 0, estimated: 60 }, delays: { measured: 0, estimated: 20 }, withoutTime: 1 } },
  attention: [],
  timeline: [
    { kind: 'snapshot', id: 'S000001', time: '08:00' },
    { kind: 'note', id: 'N20261014T081500Z-0001', time: '08:15' },
    { kind: 'snapshot', id: 'S000004', time: '09:00' },
    { kind: 'note', id: 'N20261014T090000Z-0002', time: '09:00' },
    { kind: 'snapshot', id: 'S000002', time: '10:00' },
    { kind: 'note', id: 'N20261014T100000Z-0003', time: '10:00' },
    { kind: 'run', id: 'R20261014T111000Z-aaaa', time: '11:10' },
    { kind: 'run', id: 'R20261014T112000Z-d2e8', time: '11:20' },
    { kind: 'snapshot', id: 'S000003', time: '11:30' },
  ],
  invalid: { noteLines: 0, runLines: 0, unreadableFiles: [] },
};

const ATTENTION: AttentionItem[] = [
  { id: 'a', level: 'attention', kind: 'snapshot_open', snapshotId: 'S000003', status: 'exhausted', text: 'S000003: Versuche erschöpft. 3 von 3 Versuchen.', link: 'workLogs' },
  { id: 'b', level: 'attention', kind: 'withheld', text: '1 Notiz(en) zurückgehalten (Detektor assignment). Der Text geht nie an Claude.' },
  { id: 'c', level: 'notice', kind: 'snapshot_unclear', snapshotId: 'S000004', text: 'S000004 überspannt mehrere Tage und zählt an keinem Tag als ausgeführte Arbeit.' },
];

const WORK_LOG = `# Work-Log S000002

> KI-generierter Entwurf zur persönlichen Prüfung.

## Zusammenfassung

Die Projektliste wurde umgesetzt [S000002:E001, S000002:E002].

## Statusänderungen

- \`src/a.ts\`: unstaged → committed

## Belege

| ID | Art | Pfad |
| --- | --- | --- |
| E001 | state_delta | src/a.ts |
| E002 | commit_message | – |
`;

const JOURNAL = `# Journal-Entwurf 2026-10-14

> Automatisch erzeugter Entwurf ohne KI – persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen.

## Ausgeführte Arbeiten

- Liste gebaut – aus Work-Log übernommen (S000002) [S000002:E001]
- Lock-Problem gelöst – Notiz (Problem) [N20261014T090000Z-0002]
`;

export function PageStates() {
  return (
    <>
      <Block title="Halt-Banner">
        {HALTS.map((reason) => (
          <HaltBanner
            key={reason}
            timezone="Europe/Zurich"
            halt={{
              reason,
              detectedAt: '2026-10-14T10:05:00+02:00',
              expected: position,
              observed: { branch: reason === 'branch_changed' ? 'feature/neu' : 'main', head: reason === 'head_missing' ? null : '9f8e7d6c5b4a' },
              runId: 'R20261014T100500Z-d2e8',
            }}
          />
        ))}
      </Block>
      <Block title="Claude-Warnung">
        <ClaudeWarning claude={{ checkedAt: '2026-10-14T08:00:00+02:00', ok: false, version: '2.1.114', problem: 'Die Anmeldung fehlt.' }} timezone="Europe/Zurich" />
        <ClaudeWarning claude={{ checkedAt: null, ok: null, version: null, problem: null }} timezone="Europe/Zurich" />
      </Block>
      <Block title="Tageszusammenfassung">
        <DaySummary summary={SAMPLE_DAY.summary} />
        <DaySummary summary={{ snapshotCount: 0, noteCount: 0, time: { time: { measured: 0, estimated: 0 }, planned: { measured: 0, estimated: 0 }, delays: { measured: 0, estimated: 0 }, withoutTime: 0 } }} />
      </Block>
      <Block title="Hinweise und Lücken">
        <AttentionPanel items={ATTENTION} onGo={() => undefined} />
      </Block>
      <Block title="Zeitstrahl">
        <DayTimeline view={SAMPLE_DAY} />
      </Block>
      <Block title="Kalender">
        <div style={{ position: 'relative', minHeight: 330 }}>
          <DayCalendar
            selected="2026-10-14"
            today="2026-10-20"
            index={{ timezone: 'Europe/Zurich', today: '2026-10-20', days: [{ day: '2026-10-13', hasData: true, warning: false }, { day: '2026-10-14', hasData: true, warning: true }] }}
            onSelect={() => undefined}
            onClose={() => undefined}
          />
        </div>
      </Block>
      <Block title="Markdown: Work-Log mit KI">
        <MarkdownView markdown={WORK_LOG} docKind="workLogAi" snapshotId="S000002" onReference={() => undefined} />
      </Block>
      <Block title="Markdown: Journal ohne KI">
        <MarkdownView markdown={JOURNAL} docKind="journalNoAi" onReference={() => undefined} />
      </Block>
    </>
  );
}
