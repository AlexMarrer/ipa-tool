import { useCallback } from 'react';
import type { IpaApi } from '../../shared/ipc';
import type { Page } from '../../shared/types';
import { Banner, Button, EmptyState, ErrorBoundary, LoadingSkeleton } from '../components';
import { PlaceholderPage } from '../pages/pages';
import type { AppStore } from '../store/appStore';
import { useStoreState } from '../store/createStore';
import { ProjectHeader } from './ProjectHeader';
import { RunPanel } from './RunPanel';
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
            <ProjectHeader project={project} runActive={run !== undefined && run.finished === null} onNewNote={actions.requestNewNote} />
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
            ) : selection.page === 'system' || selection.page === 'add-project' ? (
              <PlaceholderPage page={selection.page} />
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
              <PlaceholderPage page={selection.page} />
            )}
          </ErrorBoundary>
        </main>
        {project !== null && onProjectPage ? (
          <RunPanel
            run={run}
            timezone={project.timezone}
            onCancel={(runKey) => void api.run.cancel(runKey)}
            onDismiss={() => actions.dismissRun(project.repositoryId)}
          />
        ) : null}
      </div>
    </div>
  );
}
