import type { IpaApi } from '../../shared/ipc';
import type { Project } from '../../shared/types';
import type { AppActions, DialogRequest } from '../store/appStore';
import { BaselineDialog, RetryDialog, SkipDialog } from './ActionDialogs';
import { DoctorDialog } from './DoctorDialog';
import { NoteDialog } from './NoteDialog';

export interface DialogHostProps {
  api: IpaApi;
  actions: AppActions;
  project: Project;
  dialog: DialogRequest | null;
  /** Day on screen, preselected in the note dialog. */
  day: string | null;
}

/** The one dialog above the page, chosen by the store. Dialogs are rendered only while open, so every opening starts clean. */
export function DialogHost({ api, actions, project, dialog, day }: DialogHostProps) {
  if (dialog === null) return null;
  const repositoryId = project.repositoryId;
  const onClose = actions.closeDialog;
  switch (dialog.kind) {
    case 'note':
      return <NoteDialog api={api} actions={actions} repositoryId={repositoryId} timezone={project.timezone ?? 'UTC'} day={dialog.day ?? day} onClose={onClose} />;
    case 'baseline':
      return <BaselineDialog api={api} actions={actions} repositoryId={repositoryId} projectName={project.repositoryId} force={dialog.force} onClose={onClose} />;
    case 'skip':
      return <SkipDialog api={api} actions={actions} repositoryId={repositoryId} snapshot={dialog.snapshot} timezone={dialog.timezone} onClose={onClose} />;
    case 'retry':
      return <RetryDialog actions={actions} repositoryId={repositoryId} snapshot={dialog.snapshot} onClose={onClose} />;
    case 'doctor':
      return <DoctorDialog outcome={dialog.outcome} onClose={onClose} onAgain={() => void actions.check(repositoryId)} />;
  }
}
