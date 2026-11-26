import { useEffect, useState } from 'react';
import { formatLongDay } from '../../../shared/dates';
import type { DayView, DraftView, ReferenceIndex } from '../../../shared/views';
import { Banner, Button, ContentLabel, EmptyState, LoadingSkeleton } from '../../components';
import { MarkdownView } from '../../markdown/MarkdownView';
import { slug } from '../../markdown/plugins';
import { jumpToReference, useLoad, usePageEnv } from '../env';
import { shortRunId } from '../format';

export interface JournalTabProps {
  view: DayView;
  references: ReferenceIndex | null;
}

const draftLabel = (draft: DraftView): string => `${draft.time} · Lauf ${shortRunId(draft.runId)} · ${draft.mode === 'ai' ? 'KI-Entwurf' : 'ohne KI'}`;

/** Reads journal drafts of the day (spec §8.5). Drafts are never edited, and the app never writes to journal/final. */
export function JournalTab({ view, references }: JournalTabProps) {
  const env = usePageEnv();
  const drafts = view.drafts;
  const newest = drafts.at(-1)?.file ?? null;
  const [selected, setSelected] = useState<string | null>(newest);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // The newest draft is preselected; a draft chosen by hand stays while it exists.
    setSelected((current) => (current !== null && drafts.some((draft) => draft.file === current) ? current : newest));
    setMessage(null);
  }, [view.day, newest, drafts]);

  const journal = useLoad(() => (selected === null ? Promise.resolve({ ok: true as const, value: null }) : env.api.journal.read(env.repositoryId, selected)), [selected, env.repositoryId]);

  if (drafts.length === 0) {
    return (
      <EmptyState
        title="Noch kein Journal für diesen Tag"
        text="Der Entwurf fasst Snapshots, Notizen und Läufe des Tages zusammen. Die Endfassung entsteht von Hand unter journal/final/."
      />
    );
  }
  const current = drafts.find((draft) => draft.file === selected) ?? drafts[drafts.length - 1];

  const ref = selected === null ? null : ({ kind: 'journalDraft', file: selected } as const);
  const report = (result: { ok: boolean; value?: { opened: boolean } }): void => setMessage(result.ok && result.value?.opened === true ? 'Erledigt.' : 'Die Datei wurde nicht gefunden.');

  return (
    <div className="stack">
      <div className="row">
        <label htmlFor="draft-picker">Entwürfe</label>
        <select id="draft-picker" className="input" value={selected ?? ''} onChange={(event) => setSelected(event.target.value)}>
          {[...drafts].reverse().map((draft) => (
            <option key={draft.file} value={draft.file}>
              {draftLabel(draft)}
            </option>
          ))}
        </select>
        {current !== undefined ? <ContentLabel kind={current.mode === 'ai' ? 'ai' : 'noAi'} /> : null}
      </div>
      <header>
        <h3 style={{ fontSize: 17 }}>Journal · {formatLongDay(view.day)}</h3>
        {current !== undefined ? (
          <p className="muted" style={{ margin: '2px 0 0' }}>
            Entwurf von {current.time}, Lauf <span className="mono" title={current.runId}>{shortRunId(current.runId)}</span>
          </p>
        ) : null}
      </header>
      <div className="row">
        <Button disabled={ref === null} onClick={() => ref !== null && void env.api.shell.open(env.repositoryId, ref).then(report)}>
          Datei öffnen
        </Button>
        <Button disabled={ref === null} onClick={() => ref !== null && void env.api.shell.reveal(env.repositoryId, ref).then(report)}>
          Ordner zeigen
        </Button>
        <Button disabled={journal.data === null} onClick={() => journal.data !== null && void env.api.shell.copy(journal.data.markdown).then(() => setMessage('Text kopiert.'))}>
          Text kopieren
        </Button>
        <Button disabled={ref === null} onClick={() => ref !== null && void env.api.shell.copyPath(env.repositoryId, ref).then((result) => setMessage(result.ok && result.value.opened ? 'Pfad kopiert.' : 'Die Datei wurde nicht gefunden.'))}>
          Pfad kopieren
        </Button>
        <span role="status" className="muted">
          {message}
        </span>
      </div>
      <Banner level="info">
        Endfassung von Hand nach <span className="mono">journal/final/</span> übernehmen. Die App schreibt nie dorthin.
        <div style={{ marginTop: 6 }}>
          <Button onClick={() => void env.api.shell.open(env.repositoryId, { kind: 'journalFinalFolder' }).then((result) => setMessage(result.ok && result.value.opened ? 'Ordner geöffnet.' : 'Der Ordner journal/final existiert noch nicht.'))}>
            Ordner öffnen
          </Button>
        </div>
      </Banner>
      {journal.data === null ? (
        journal.error !== null ? <Banner level="err" title="Der Entwurf konnte nicht geladen werden" details={journal.error.message} /> : <LoadingSkeleton loading={journal.loading} lines={5} />
      ) : journal.data.state !== 'ok' ? (
        <Banner level="err" title="Datei nicht lesbar">
          Die Datei des Entwurfs fehlt oder lässt sich nicht lesen.
        </Banner>
      ) : (
        <div className="journal-layout">
          <MarkdownView
            markdown={journal.data.markdown}
            docKind={journal.data.draft.mode === 'ai' ? 'journalAi' : 'journalNoAi'}
            references={references}
            onReference={(target) => jumpToReference(env, references, target)}
            onCopy={(text) => void env.api.shell.copy(text)}
            onOpenExternal={(url) => void env.api.shell.openExternal(url)}
          />
          <nav className="outline" aria-label="Gliederung">
            <strong>Gliederung</strong>
            {journal.data.headings.map((title) => (
              <button key={title} type="button" onClick={() => document.getElementById(slug(title))?.scrollIntoView?.({ block: 'start' })}>
                {title}
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
