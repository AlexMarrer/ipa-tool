import { EXIT_CODE_MESSAGES } from '../../shared/messages';
import type { Project } from '../../shared/types';
import { Banner, Button, SplitButton } from '../components';
import { StatusDot } from './Sidebar';

export interface ProjectHeaderProps {
  project: Project;
  /** A run is active in this project: Jetzt erfassen is locked (spec §3.7). */
  runActive: boolean;
  onNewNote: () => void;
}

const NOT_AVAILABLE = 'Diese Aktion ist in dieser Version noch nicht verfügbar.';
const RUN_ACTIVE = 'Ein Lauf ist aktiv. Jetzt erfassen ist gesperrt, bis er endet.';

/**
 * Name, main action and side action (spec §8.1). Starting a run follows with the actions package, so the
 * run buttons are present and disabled, never silently active.
 */
export function ProjectHeader({ project, runActive, onNewNote }: ProjectHeaderProps) {
  const halted = project.status === 'halt';
  return (
    <>
      <header className="header">
        <h1 className="header__title">
          <StatusDot status={project.status} />
          <span>{project.repositoryId}</span>
        </h1>
        <div className="header__actions">
          <Button variant="primary" icon="plus" disabled disabledReason={NOT_AVAILABLE} onClick={onNewNote}>
            Neue Notiz <span className="kbd">Strg+N</span>
          </Button>
          <SplitButton
            ai
            label="Jetzt erfassen"
            disabled
            disabledReason={runActive ? RUN_ACTIVE : NOT_AVAILABLE}
            onClick={() => undefined}
            items={[{ id: 'no-analysis', label: 'Nur aufnehmen', onSelect: () => undefined, disabled: true }]}
          />
        </div>
      </header>
      {halted ? (
        <div className="header__banners">
          <Banner level="err" title={EXIT_CODE_MESSAGES[4]?.title ?? 'Halt'}>
            {EXIT_CODE_MESSAGES[4]?.text}
          </Banner>
        </div>
      ) : null}
    </>
  );
}
