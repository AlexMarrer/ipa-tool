import { PROJECT_STATUS_LABEL } from '../../shared/messages';
import { THEME_CHOICES, type Page, type Project, type ThemeChoice } from '../../shared/types';
import { Button } from '../components';
import { Icon } from '../theme/icons/Icon';

export interface SidebarProps {
  projects: Project[];
  selectedId: string | null;
  page: Page;
  onSelectProject: (repositoryId: string) => void;
  onSelectPage: (page: Page) => void;
  theme?: ThemeChoice;
  onTheme?: (theme: ThemeChoice) => void;
}

const THEME_LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' };

/** Look of the app: follow Windows (default), light or dark (spec §10.1). One of three, always visible. */
export function ThemeSwitch({ theme, onTheme }: { theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void }) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Darstellung">
      {THEME_CHOICES.map((choice) => (
        <button key={choice} type="button" role="radio" aria-checked={theme === choice} title={choice === 'system' ? 'Wie die Windows-Einstellung' : THEME_LABEL[choice]} onClick={() => onTheme(choice)}>
          {THEME_LABEL[choice]}
        </button>
      ))}
    </div>
  );
}

/** Status dot with a text alternative; the hint line repeats the state in words (spec §5.1). */
export function StatusDot({ status }: { status: Project['status'] }) {
  return <span className={`dot dot--${status}`} role="img" aria-label={PROJECT_STATUS_LABEL[status]} />;
}

export function Sidebar({ projects, selectedId, page, onSelectProject, onSelectPage, theme = 'system', onTheme }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Seitenleiste">
      <h2 className="sidebar__heading">Projekte</h2>
      {projects.length === 0 ? (
        <>
          <p className="sidebar__note">Noch kein Projekt</p>
          <Button variant="primary" icon="plus" onClick={() => onSelectPage('add-project')}>
            Projekt hinzufügen
          </Button>
        </>
      ) : (
        <nav aria-label="Projekte">
          <ul className="sidebar__list">
            {projects.map((project) => (
              <li key={project.repositoryId}>
                <button
                  type="button"
                  className="project-row"
                  aria-current={project.repositoryId === selectedId && page !== 'system' && page !== 'add-project' ? 'true' : undefined}
                  onClick={() => onSelectProject(project.repositoryId)}
                >
                  <StatusDot status={project.status} />
                  <span className="project-row__name">{project.repositoryId}</span>
                  {project.hint !== '' ? <span className="project-row__hint">{project.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="sidebar__spacer" />
      <div className="sidebar__foot">
        {projects.length > 0 ? (
          <button type="button" className="sidebar__link" aria-current={page === 'add-project' ? 'page' : undefined} onClick={() => onSelectPage('add-project')}>
            <Icon name="plus" /> Projekt hinzufügen
          </button>
        ) : null}
        <button type="button" className="sidebar__link" aria-current={page === 'system' ? 'page' : undefined} onClick={() => onSelectPage('system')}>
          <Icon name="settings" /> System
        </button>
        {onTheme !== undefined ? <ThemeSwitch theme={theme} onTheme={onTheme} /> : null}
      </div>
    </aside>
  );
}
