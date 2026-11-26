import { useCallback } from 'react';
import type { IpaApi } from '../../shared/ipc';
import type { Page } from '../../shared/types';
import { todayIn } from '../../shared/dates';
import { Banner, Button, EmptyState, ErrorBoundary, LoadingSkeleton } from '../components';
import { DialogHost } from '../dialogs/DialogHost';
import { DayPage } from '../pages/day/DayPage';
import { PageEnvProvider } from '../pages/env';
import { OverviewPage } from '../pages/overview/OverviewPage';
import { AddProjectWizard } from '../pages/add/AddProjectWizard';
import { ConfigPage } from '../pages/config/ConfigPage';
import { SystemPage } from '../pages/system/SystemPage';
import { SchedulePage } from '../pages/schedule/SchedulePage';
import { PlaceholderPage } from '../pages/pages';
import type { AppStore } from '../store/appStore';
import { useStoreState } from '../store/createStore';
import { ProjectHeader } from './ProjectHeader';
import { RunPanel, type RunTarget } from './RunPanel';
import { SectionNav } from './SectionNav';
import { Sidebar } from './Sidebar';
import { useShortcuts } from './useShortcuts';

export interface AppShellProps {
  app: AppStore;
  api: IpaApi;
}

const PROJECT_PAGES: readonly Page[] = ['overview', 'day', 'schedule', 'config'];

export function AppShell({ app, api }: AppShellProps) {
  const state = useStoreState(app.store);
  const { actions } = app;
  const { selection, projects, registry, loading, loadError } = state;
  const project = projects.find((candidate) => candidate.repositoryId === selection.repositoryId) ?? null;
  const onProjectPage = PROJECT_PAGES.includes(selection.page);

  useShortcuts({
    onNewNote: actions.requestNewNote,
    onPreviousDay: useCallback(() => actions.shiftDay(-1), [actions]),
    onNextDay: useCallback(() => actions.shiftDay(1), [actions]),
    dayKeysActive: selection.page === 'day',
  });

  const run = project === null ? undefined : state.runs[project.repositoryId];
  const locks = project === null ? undefined : state.locks[project.repositoryId];
  const goTo = (target: RunTarget): void => {
    if (project === null) return;
    const day = selection.day ?? todayIn(project.timezone);
    if (target.tab === 'journal') actions.openDay(target.day ?? day, 'journal');
    else actions.openDay(day, 'workLogs', target.snapshotId === null ? {} : { snapshotId: target.snapshotId });
  };

  return (
    <div className="shell">
      <Sidebar
        projects={projects}
        selectedId={selection.repositoryId}
        page={selection.page}
        onSelectProject={actions.selectProject}
        onSelectPage={actions.selectPage}
      />
      <div className="content">
        {project !== null && onProjectPage ? (
          <>
            <ProjectHeader project={project} actions={actions} locks={locks} />
            <SectionNav page={selection.page} onSelect={actions.selectPage} />
          </>
        ) : null}
        {registry !== null && registry.state !== 'ok' && registry.state !== 'missing' ? (
          <div className="header__banners">
            <Banner level="err" title="Die Projektliste ist nicht lesbar" details={[registry.path, registry.detail].filter(Boolean).join('\n')}>
              Die App bleibt bedienbar, zeigt aber keine Projekte. Prüfe die Datei oder richte die Projekte mit "ipa init" neu ein.
            </Banner>
          </div>
        ) : null}
        {loadError !== null ? (
          <div className="header__banners">
            <Banner level="err" title="Die Projekte konnten nicht geladen werden" details={loadError} />
          </div>
        ) : null}
        <main className="page">
          <ErrorBoundary area="Dieser Bereich" key={`${selection.page}:${selection.repositoryId ?? ''}`}>
            {loading ? (
              <LoadingSkeleton loading />
            ) : selection.page === 'system' ? (
              <SystemPage api={api} actions={actions} projects={projects} selectedId={selection.repositoryId} locks={locks} dataVersion={state.dataVersion} />
            ) : selection.page === 'add-project' ? (
              <AddProjectWizard api={api} actions={actions} projectName={(id) => id} />
            ) : project === null ? (
              <EmptyState
                title="Noch kein Projekt"
                text="Richte ein Projekt ein, damit die App seinen Arbeitsstand anzeigen kann."
                action={
                  <Button variant="primary" icon="plus" onClick={() => actions.selectPage('add-project')}>
                    Projekt hinzufügen
                  </Button>
                }
              />
            ) : project.status === 'error' ? (
              <Banner level="err" title="Dieses Projekt ist nicht lesbar" details={`${project.repoPath}\n${project.workspacePath}`}>
                {project.hint.replace(/^Fehler: /, '')}. Prüfe, ob das Repository und der Arbeitsbereich noch am registrierten Ort liegen.
              </Banner>
            ) : (
              <PageEnvProvider
                value={{ api, repositoryId: project.repositoryId, timezone: project.timezone, dataVersion: state.dataVersion, actions, focus: state.focus, locks, claudeReady: project.claudeReady }}
              >
                {selection.page === 'overview' ? (
                  <OverviewPage />
                ) : selection.page === 'day' ? (
                  <DayPage day={selection.day} tab={state.dayTab} />
                ) : selection.page === 'schedule' ? (
                  <SchedulePage />
                ) : selection.page === 'config' ? (
                  <ConfigPage key={state.configGroup} initialGroup={state.configGroup} />
                ) : (
                  <PlaceholderPage page={selection.page} />
                )}
              </PageEnvProvider>
            )}
          </ErrorBoundary>
        </main>
        {project !== null && onProjectPage ? (
          <RunPanel
            run={run}
            foreign={locks?.foreign ?? null}
            timezone={project.timezone}
            onCancel={(runKey) => void api.run.cancel(runKey)}
            onDismiss={() => actions.dismissRun(project.repositoryId)}
            onGoTo={goTo}
          />
        ) : null}
        {project !== null ? <DialogHost api={api} actions={actions} project={project} dialog={state.dialog} day={selection.day} /> : null}
      </div>
    </div>
  );
}
