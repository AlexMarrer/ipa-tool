import type { ReactNode } from 'react';
import type { IpaApi } from '../../shared/ipc';
import { CLAUDE_DEFAULTS, LIMIT_DEFAULTS, SCHEDULE_DEFAULTS, type ConfigFile, type ConfigView, type RunHistoryEntry, type SchedulePlan, type ScheduleState, type ScheduleView } from '../../shared/config';
import { Banner } from '../components';
import { PageEnvProvider, type PageEnv } from '../pages/env';
import { ConflictDialog, SaveBar } from '../pages/config/ConfigPage';
import { ConfigClaude, ConfigContext, ConfigInfo, ConfigLimits, ConfigPathFilter, ConfigScheduleRef, ConfigSecrets, CostGuardConfirm, ConfigCostGuard, type GroupProps } from '../pages/config/groups';
import { ScheduleForm, type ScheduleDraft } from '../pages/schedule/ScheduleForm';
import { OutsideWindowDialog, ScheduleDeleteDialog, SchedulePreview, ScheduleRunsTable, ScheduleStatusCard } from '../pages/schedule/ScheduleParts';
import { scheduleErrors } from '../pages/config/draft';
import { createAppStore } from '../store/appStore';

/**
 * Schedule and configuration in their states (spec AD-15, Annex A groups Zeitplan and Konfiguration). Built from fixed
 * sample data and an API that answers nothing, so the gallery never starts a command.
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
const stubApi = {
  config: { scanText: () => never(), read: () => never(), preview: () => never(), testPath: () => never(), chooseFile: () => never() },
  schedule: { status: () => never(), runs: () => never() },
  shell: { copy: () => never() },
  run: { start: () => never() },
} as unknown as IpaApi;
const noop = (): void => undefined;
const REPO = 'mein-projekt-3fa9c1';
const TIMEZONE = 'Europe/Zurich';

const plan: SchedulePlan = { workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], runTimes: ['08:00', '10:00', '12:00', '14:00', '16:00', '17:45', '18:00'], skippedRunTimes: [], runsPerDay: 7, includesWindowEndRun: true, maxAnalysesPerRun: 5, maxClaudeCallsPerDay: 35 };
const view = (state: ScheduleState, overrides: Partial<ScheduleView> = {}): ScheduleView => ({
  state,
  taskName: `ipa-assistant-${REPO}`,
  enabled: state !== 'paused',
  differences: [],
  detail: null,
  nextRun: state === 'active' || state === 'stale' ? '2026-10-14T10:00:00+02:00' : null,
  lastRun: '2026-10-14T08:00:00+02:00',
  lastResult: 0,
  running: false,
  insideWindow: true,
  plan,
  problem: null,
  ...overrides,
});

const draft: ScheduleDraft = { workdays: ['mon', 'tue', 'wed', 'thu', 'fri'], windowStart: '08:00', windowEnd: '18:00', intervalMinutes: '120', extraRunTimes: ['17:45'] };
const invalid: ScheduleDraft = { workdays: [], windowStart: '8.00', windowEnd: '07:00', intervalMinutes: '0', extraRunTimes: ['25:30'] };
const preview = (findings: { severity: 'error' | 'warning'; message: string }[] = []) => ({ valid: true, failure: null, schedulePlan: plan, findings: findings.map((entry, index) => ({ ...entry, code: `c${index}`, path: '/schedule' })) });

const config: ConfigFile = {
  schemaVersion: 1,
  repositoryId: REPO,
  repository: { path: 'C:/repos/mein-projekt' },
  timezone: TIMEZONE,
  paths: { include: ['**'], exclude: ['**/node_modules/**', '*.log'] },
  secrets: { extraPatterns: ['PROJ-[0-9]+'], disabledDetectors: ['jwt'] },
  limits: { ...LIMIT_DEFAULTS },
  context: { files: ['docs/aufgabe.md'] },
  testReports: [{ path: 'reports/junit.xml', label: 'Unit-Tests' }],
  claude: { command: ['claude'], model: 'claude-opus-5-5', ...CLAUDE_DEFAULTS },
  schedule: { ...SCHEDULE_DEFAULTS },
};
const configView: ConfigView = {
  state: 'ok',
  config,
  findings: [],
  signature: '1:1',
  workspaceInRepository: '.ipa',
  repoPath: 'C:/repos/mein-projekt',
  workspacePath: 'C:/daten/workspaces/mein-projekt-3fa9c1',
  claude: { checkedAt: '2026-10-14T05:52:00Z', ok: true, found: true, version: '2.1.4', loggedIn: true, authMethod: 'claude.ai' },
};
const env: PageEnv = { api: stubApi, repositoryId: REPO, timezone: TIMEZONE, dataVersion: 0, actions: createAppStore(stubApi).actions, focus: null, locks: undefined, claudeReady: null };
const groupProps: GroupProps = { env, view: configView, draft: config, set: noop, findings: [], fieldError: noop, timezone: TIMEZONE };

const runs: RunHistoryEntry[] = [
  { runId: 'R20261014T080000Z-ab01', command: 'capture', startedAt: '2026-10-14T08:00:00+02:00', time: '08:00', day: '2026-10-14', outcome: 'ok', exitCode: 0, durationMs: 109_000, snapshotCreated: 'S000006', analysesCompleted: 1, analysesFailed: 0 },
  { runId: 'R20261014T060000Z-ab02', command: 'capture', startedAt: '2026-10-14T06:00:00+02:00', time: '06:00', day: '2026-10-14', outcome: 'unchanged', exitCode: 0, durationMs: 4_000, snapshotCreated: null, analysesCompleted: 0, analysesFailed: 0 },
];

export function ConfigStates() {
  return (
    <PageEnvProvider value={env}>
      <Block title="Zeitplan: Zustände">
        {(['not_installed', 'active', 'paused', 'stale', 'error'] as const).map((state) => (
          <ScheduleStatusCard key={state} timezone={TIMEZONE} status={view(state, state === 'stale' ? { differences: ['triggers', 'execution_time_limit'] } : state === 'error' ? { detail: 'Zugriff verweigert (schtasks)' } : {})} />
        ))}
        <ScheduleStatusCard timezone={TIMEZONE} status={view('active', { state: null, problem: { kind: 'unsupported', message: 'Dieser Befehl braucht Windows.' } })} />
      </Block>
      <Block title="Zeitplan: Formular und Vorschau">
        <ScheduleForm draft={draft} errors={scheduleErrors(draft)} timezone={TIMEZONE} onChange={noop} />
        <ScheduleForm draft={invalid} errors={scheduleErrors(invalid)} timezone={TIMEZONE} onChange={noop} />
        <SchedulePreview preview={preview()} locallyInvalid={false} loading={false} />
        <SchedulePreview
          preview={preview([
            { severity: 'warning', message: 'Zusatzlauf 19:30 liegt ausserhalb des Zeitfensters 08:00–18:00.' },
            { severity: 'warning', message: 'Das Intervall (660 Min) ist länger als das Zeitfenster (600 Min). Es gibt nur den Lauf zu Beginn.' },
            { severity: 'warning', message: 'Der Timeout pro Claude-Aufruf beträgt 900 s und damit mehr als 10 Minuten. Ein Lauf kann entsprechend lange dauern.' },
          ])}
          locallyInvalid={false}
          loading={false}
        />
        <SchedulePreview preview={null} locallyInvalid loading={false} />
      </Block>
      <Block title="Zeitplan: Dialoge und Verlauf">
        <ScheduleDeleteDialog inline taskName={`ipa-assistant-${REPO}`} onClose={noop} onConfirm={noop} />
        <OutsideWindowDialog onClose={noop} onConfirm={noop} />
        <ScheduleRunsTable runs={runs} />
        <ScheduleRunsTable runs={[]} />
      </Block>
      <Block title="Konfiguration: Gruppen">
        <ConfigClaude {...groupProps} />
        <ConfigCostGuard {...groupProps} />
        <ConfigScheduleRef {...groupProps} />
        <ConfigPathFilter {...groupProps} />
        <ConfigSecrets {...groupProps} />
        <ConfigContext {...groupProps} />
        <ConfigLimits {...groupProps} />
        <ConfigInfo {...groupProps} />
      </Block>
      <Block title="Konfiguration: Speichern-Leiste und Dialoge">
        <SaveBar errors={0} dirty={false} busy={false} runActive={false} onSave={noop} onDiscard={noop} />
        <SaveBar errors={0} dirty busy={false} runActive={false} onSave={noop} onDiscard={noop} />
        <SaveBar errors={2} dirty busy={false} runActive onSave={noop} onDiscard={noop} />
        <Banner level="err" title="config.json ist nicht gültig">
          Speichern ist gesperrt, bis die Befunde behoben sind.
        </Banner>
        <CostGuardConfirm inline onClose={noop} onConfirm={noop} />
        <CostGuardConfirm inline initialStep={2} onClose={noop} onConfirm={noop} />
        <ConflictDialog inline onReload={noop} onKeep={noop} />
      </Block>
    </PageEnvProvider>
  );
}
