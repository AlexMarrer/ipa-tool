import type { ReactNode } from 'react';
import type { IpaApi } from '../../shared/ipc';
import type { ProjectCheck, UsageRow } from '../../shared/project';
import { Banner } from '../components';
import { AddProjectWizard, ProjectChecklist } from '../pages/add/AddProjectWizard';
import { LiveTestDialog, UsageTable } from '../pages/system/SystemPage';
import { createAppStore } from '../store/appStore';

/**
 * The wizard and the page System in their states (spec AD-15, Annex A groups Hinzufuegen and System). Built from fixed
 * sample data and an API that answers nothing, so the gallery never sets up a project or calls Claude.
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
const stubApi = { project: { chooseFolder: () => never(), check: () => never(), init: () => never() }, system: { openDataRoot: () => never() }, shell: { copy: () => never() } } as unknown as IpaApi;
const noop = (): void => undefined;

const base: ProjectCheck = {
  repoPath: 'C:/repos/mein-projekt',
  dataRoot: { path: 'C:/Users/ich/AppData/Local/ipa-assistant', writable: true, exists: true, detail: null },
  repository: { isMainFolder: true, insideRepository: false, branch: 'main', head: '3c7d9a4e5f60718293a4b5c6d7e8f90123456789' },
  existing: null,
  gitVersion: '2.47.1',
  claude: { ok: true, version: '2.1.4', authMethod: 'claude.ai', checkedAt: '2026-10-14T05:52:00Z' },
};

const usage = (id: string, overrides: Partial<UsageRow> = {}): UsageRow => ({
  repositoryId: 'mein-projekt-3fa9c1',
  runId: `R20261014T10000${id}Z-ab0${id}`,
  day: '2026-10-14',
  time: `1${id}:42`,
  startedAt: `2026-10-14T1${id}:42:00+02:00`,
  purpose: 'analysis',
  durationMs: 109_000,
  models: ['claude-sonnet-5-5'],
  outcome: 'success',
  costUsd: null,
  ...overrides,
});

export function WizardStates() {
  const actions = createAppStore(stubApi).actions;
  return (
    <>
      <Block title="Projekt hinzufügen: Schritt 1">
        <AddProjectWizard api={stubApi} actions={actions} />
        <ProjectChecklist check={base} />
        <ProjectChecklist check={{ ...base, claude: null }} />
        <ProjectChecklist check={{ ...base, repository: { ...base.repository, isMainFolder: false, branch: null, head: null } }} />
        <ProjectChecklist check={{ ...base, existing: { repositoryId: 'mein-projekt-3fa9c1' } }} onSwitch={noop} />
        <ProjectChecklist check={{ ...base, dataRoot: { ...base.dataRoot, writable: false, detail: 'Nicht beschreibbar (EACCES).' } }} onRecheck={noop} onOpenDataRoot={noop} />
      </Block>
      <Block title="System: Verbrauch und Live-Test">
        <UsageTable rows={[usage('1'), usage('2', { purpose: 'journal', costUsd: 0.12 }), usage('3', { outcome: 'claude_error' })]} />
        <UsageTable rows={[]} />
        <LiveTestDialog inline onClose={noop} onConfirm={noop} />
        <Banner level="info" title="Kein kostenpflichtiger Weg erkannt">
          Claude wird nur über das Abo genutzt. Geprüft werden die Umgebungsvariablen und die Anmeldeart. Werte werden nie angezeigt, nur Namen.
        </Banner>
        <Banner level="warn" title="Kostenpflichtiger Weg erkannt">
          Erkannte Umgebungsvariablen (nur Namen, nie Werte): ANTHROPIC_API_KEY
        </Banner>
      </Block>
    </>
  );
}
