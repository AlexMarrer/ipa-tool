import { useState } from 'react';
import { EXIT_CODE_MESSAGES } from '../../shared/messages';
import type { LockState } from '../../shared/run';
import type { Project } from '../../shared/types';
import { Banner, Button, SplitButton } from '../components';
import type { AppActions } from '../store/appStore';
import { lockReason, unavailableReason } from '../store/locks';
import { StatusDot } from './Sidebar';

export interface ProjectHeaderProps {
  project: Project;
  actions: AppActions;
  locks: LockState | undefined;
}

/**
 * Name, main action and side action (spec §8.1). "Jetzt erfassen" calls Claude and is marked as such; "Nur aufnehmen"
 * does not. Locked buttons stay visible and say why (spec §3.7).
 */
export function ProjectHeader({ project, actions, locks }: ProjectHeaderProps) {
  const halted = project.status === 'halt';
  const [notice, setNotice] = useState<string | null>(null);
  const captureReason = unavailableReason('capture', locks, project.claudeReady);
  const noAiReason = lockReason('captureNoAi', locks);
  const haltReason = lockReason('baseline', locks);

  const capture = async (mode: 'full' | 'noAnalysis'): Promise<void> => {
    setNotice(null);
    const result = await actions.startRun(project.repositoryId, { name: 'capture', mode });
    if (!result.started) setNotice(result.message);
  };

  return (
    <>
      <header className="header">
        <h1 className="header__title">
          <StatusDot status={project.status} />
          <span>{project.repositoryId}</span>
        </h1>
        <div className="header__actions">
          <Button variant="primary" icon="plus" onClick={() => actions.requestNewNote()}>
            Neue Notiz <span className="kbd">Strg+N</span>
          </Button>
          <SplitButton
            ai
            label="Jetzt erfassen"
            mainDisabled={captureReason !== null}
            menuDisabled={noAiReason !== null}
            {...(captureReason !== null ? { disabledReason: captureReason } : {})}
            onClick={() => void capture('full')}
            items={[{ id: 'no-analysis', label: 'Nur aufnehmen', disabled: noAiReason !== null, onSelect: () => void capture('noAnalysis') }]}
          />
        </div>
      </header>
      {halted || notice !== null || project.claudeReady === false ? (
        <div className="header__banners">
          {halted ? (
            <Banner
              level="err"
              title={EXIT_CODE_MESSAGES[4]?.title ?? 'Halt'}
              actions={
                <Button variant="primary" disabled={haltReason !== null} {...(haltReason !== null ? { disabledReason: haltReason } : {})} onClick={() => actions.openDialog({ kind: 'baseline', force: false })}>
                  Neuen Ausgangspunkt setzen
                </Button>
              }
            >
              {EXIT_CODE_MESSAGES[4]?.text}
            </Banner>
          ) : null}
          {project.claudeReady === false ? (
            <Banner level="warn" title="Claude ist nicht bereit" actions={<Button onClick={() => void actions.check(project.repositoryId)}>Prüfen</Button>}>
              Aufnehmen funktioniert weiter, Analysen und Journal mit KI sind gesperrt.
            </Banner>
          ) : null}
          {notice !== null ? (
            <Banner level="info" title="Nicht gestartet" actions={<Button variant="ghost" onClick={() => setNotice(null)}>Schliessen</Button>}>
              {notice}
            </Banner>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
