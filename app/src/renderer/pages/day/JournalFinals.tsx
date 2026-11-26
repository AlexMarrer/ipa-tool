import { useState } from 'react';
import { Banner, Button, ConfirmDialog } from '../../components';
import { useLoad, usePageEnv } from '../env';
import { formatStamp } from '../format';

export interface JournalFinalsProps {
  day: string;
  timezone: string;
  /** Result of the last copy or removal, shown next to the actions. */
  message: string | null;
  onMessage: (text: string | null) => void;
}

/**
 * The final versions of the day in `journal/final/` (spec §8.5). They belong to the user: the CLI never writes there,
 * the app only on a click (a copy of a draft) and only moves files to the recycle bin, with a question first.
 */
export function JournalFinals({ day, timezone, message, onMessage }: JournalFinalsProps) {
  const env = usePageEnv();
  const finals = useLoad(() => env.api.journal.finals(env.repositoryId, day), [env.repositoryId, day]);
  const [removing, setRemoving] = useState<string | null>(null);
  const files = finals.data ?? [];

  const open = async (file: string): Promise<void> => {
    const result = await env.api.shell.open(env.repositoryId, { kind: 'journalFinal', file });
    onMessage(result.ok && result.value.opened ? null : 'Die Datei wurde nicht gefunden.');
  };
  const remove = async (file: string): Promise<void> => {
    setRemoving(null);
    const result = await env.api.journal.remove(env.repositoryId, 'final', file);
    onMessage(!result.ok ? result.error.message : result.value.removed ? 'Endfassung in den Papierkorb verschoben.' : (result.value.problem ?? 'Nicht verschoben.'));
    await env.actions.reload();
  };

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Endfassungen">
      <Banner level="info" title="Endfassung">
        Deine Endfassung liegt in <span className="mono">journal/final/</span>. Das CLI schreibt dort nie. Die App legt dort nur auf deinen Klick eine Kopie des Entwurfs an und überschreibt nie etwas.
        <div className="row" style={{ marginTop: 6 }}>
          <Button onClick={() => void env.api.shell.open(env.repositoryId, { kind: 'journalFinalFolder' }).then((result) => onMessage(result.ok && result.value.opened ? 'Ordner geöffnet.' : 'Der Ordner journal/final existiert noch nicht.'))}>
            Ordner öffnen
          </Button>
          {message !== null ? (
            <span role="status" className="muted">
              {message}
            </span>
          ) : null}
        </div>
      </Banner>
      {files.length > 0 ? (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }} aria-label="Endfassungen dieses Tages">
          {files.map((entry) => (
            <li key={entry.file} className="row">
              <span className="mono" style={{ flex: 1 }}>
                {entry.file}
              </span>
              <span className="muted">geändert {formatStamp(entry.modifiedAt, timezone)}</span>
              <Button onClick={() => void open(entry.file)}>Datei öffnen</Button>
              <Button aria-label={`Endfassung ${entry.file} löschen`} onClick={() => setRemoving(entry.file)}>
                Löschen
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {removing !== null ? (
        <ConfirmDialog title="Endfassung löschen?" confirmLabel="In den Papierkorb" danger onClose={() => setRemoving(null)} onConfirm={() => void remove(removing)}>
          <p>
            <span className="mono">{removing}</span> wird in den Windows-Papierkorb verschoben. Das ist deine eigene Arbeit; aus dem Papierkorb lässt sie sich zurückholen.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
