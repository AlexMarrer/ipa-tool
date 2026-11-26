import { useEffect, useRef, useState } from 'react';
import { formatLongDay } from '../../../shared/dates';
import type { DayView, DraftView, ReferenceIndex } from '../../../shared/views';
import { describeRun } from '../../../shared/run-texts';
import { Banner, Button, ConfirmDialog, ContentLabel, EmptyState, LoadingSkeleton } from '../../components';
import type { StartResult } from '../../store/appStore';
import { MarkdownView } from '../../markdown/MarkdownView';
import { slug } from '../../markdown/plugins';
import { actionReason, jumpToReference, useLoad, usePageEnv } from '../env';
import { shortRunId } from '../format';
import { JournalFinals } from './JournalFinals';

export interface JournalTabProps {
  view: DayView;
  references: ReferenceIndex | null;
}

/** After exit code 6: no new draft, the earlier one stays reachable; retry with AI or write without (spec §8.5). */
export function JournalFailure({ previous, messages, actions }: { previous: DraftView | undefined; messages: string[]; actions: React.ReactNode }) {
  return (
    <Banner level="warn" title="KI-Schritt nicht abgeschlossen" actions={actions}>
      Exit-Code 6. Es wurde kein neuer Entwurf geschrieben.{' '}
      {previous !== undefined ? <>Der Entwurf von {previous.time} ({previous.mode === 'ai' ? 'KI-Entwurf' : 'ohne KI'}) bleibt unverändert erreichbar.</> : 'Es gibt noch keinen früheren Entwurf.'}
      {messages.map((message, position) => (
        <div key={position} className="muted">
          {message}
        </div>
      ))}
    </Banner>
  );
}

const draftLabel = (draft: DraftView): string => `${draft.time} · Lauf ${shortRunId(draft.runId)} · ${draft.mode === 'ai' ? 'KI-Entwurf' : 'ohne KI'}`;

/** Journal drafts of the day (spec §8.5). Drafts are never edited; on a click the app copies one to journal/final/ or moves it to the recycle bin. */
export function JournalTab({ view, references }: JournalTabProps) {
  const env = usePageEnv();
  const drafts = view.drafts;
  const newest = drafts.at(-1)?.file ?? null;
  const [selected, setSelected] = useState<string | null>(newest);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<StartResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingDraft, setRemovingDraft] = useState(false);
  /** Newest draft before a successful generation; the next different newest draft is preselected (spec AK-10-40). */
  const awaiting = useRef<{ newest: string | null } | null>(null);

  useEffect(() => {
    if (awaiting.current !== null && newest !== null && newest !== awaiting.current.newest) {
      awaiting.current = null;
      setSelected(newest);
      return;
    }
    // The newest draft is preselected; a draft chosen by hand stays while it exists.
    setSelected((current) => (current !== null && drafts.some((draft) => draft.file === current) ? current : newest));
    setMessage(null);
  }, [view.day, newest, drafts]);
  useEffect(() => {
    setOutcome(null);
    awaiting.current = null;
  }, [view.day]);

  const generate = async (noAi: boolean): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    const before = newest;
    const result = await env.actions.startRun(env.repositoryId, { name: 'journal', day: view.day, ...(noAi ? { noAi: true } : {}) });
    setBusy(false);
    setOutcome(result);
    if (result.started && result.summary.exitCode === 0 && result.summary.result?.kind === 'journal' && result.summary.result.draftWritten) awaiting.current = { newest: before };
  };
  const aiReason = busy ? 'Ein Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.' : actionReason(env, 'journal');
  const noAiReason = busy ? 'Ein Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.' : actionReason(env, 'journalNoAi');
  const buttons = (retry: boolean) => (
    <div className="row">
      <Button variant={retry ? 'secondary' : 'primary'} ai disabled={aiReason !== null} {...(aiReason !== null ? { disabledReason: aiReason } : {})} onClick={() => void generate(false)}>
        {retry ? 'Erneut versuchen' : 'Journal erzeugen'}
      </Button>
      <Button disabled={noAiReason !== null} {...(noAiReason !== null ? { disabledReason: noAiReason } : {})} onClick={() => void generate(true)}>
        Ohne KI erzeugen
      </Button>
    </div>
  );
  const previous = drafts.at(-1);
  const failed = outcome !== null && outcome.started && outcome.summary.exitCode === 6 ? outcome.summary : null;
  const notice =
    outcome === null
      ? null
      : !outcome.started
        ? ({ level: 'info', title: 'Nicht gestartet', text: outcome.message, extra: [] as string[] } as const)
        : failed !== null || outcome.summary.exitCode === 0
          ? null
          : (() => {
              const text = describeRun(outcome.summary);
              return { level: text.tone === 'err' ? 'err' : 'warn', title: text.title, text: text.text, extra: text.extra } as const;
            })();
  const result = outcome !== null && outcome.started && outcome.summary.exitCode === 0 ? outcome.summary : null;
  const status = (
    <>
      {failed !== null ? <JournalFailure previous={previous} messages={failed.errors.map((error) => error.message)} actions={buttons(true)} /> : null}
      {notice !== null ? (
        <Banner level={notice.level} title={notice.title}>
          {notice.text}
          {notice.extra.map((line, position) => (
            <div key={position} className="muted">
              {line}
            </div>
          ))}
        </Banner>
      ) : null}
      {result !== null && result.result?.kind === 'journal' && !result.result.draftWritten ? (
        <Banner level="info" title="Kein Entwurf geschrieben">
          {describeRun(result).text}
        </Banner>
      ) : null}
    </>
  );

  const journal = useLoad(() => (selected === null ? Promise.resolve({ ok: true as const, value: null }) : env.api.journal.read(env.repositoryId, selected)), [selected, env.repositoryId]);

  if (drafts.length === 0) {
    return (
      <div className="stack">
        {status}
        <EmptyState
          title="Noch kein Journal für diesen Tag"
          text="Der Entwurf fasst Snapshots, Notizen und Läufe des Tages zusammen. Die Endfassung entsteht von Hand unter journal/final/."
          action={failed === null ? buttons(false) : undefined}
        />
        <JournalFinals day={view.day} timezone={view.timezone} message={message} onMessage={setMessage} />
      </div>
    );
  }
  const current = drafts.find((draft) => draft.file === selected) ?? drafts[drafts.length - 1];

  const ref = selected === null ? null : ({ kind: 'journalDraft', file: selected } as const);
  const finalize = async (): Promise<void> => {
    if (selected === null) return;
    const result = await env.api.journal.finalize(env.repositoryId, selected);
    setMessage(result.ok ? `Endfassung angelegt: journal/final/${result.value.file}` : result.error.message);
    await env.actions.reload();
  };
  const removeDraft = async (file: string): Promise<void> => {
    setRemovingDraft(false);
    const result = await env.api.journal.remove(env.repositoryId, 'draft', file);
    setMessage(!result.ok ? result.error.message : result.value.removed ? 'Entwurf in den Papierkorb verschoben.' : (result.value.problem ?? 'Nicht verschoben.'));
    await env.actions.reload();
  };
  const report = (result: { ok: boolean; value?: { opened: boolean } }): void => setMessage(result.ok && result.value?.opened === true ? 'Erledigt.' : 'Die Datei wurde nicht gefunden.');

  return (
    <div className="stack">
      {status}
      {failed === null ? buttons(false) : null}
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
        <Button variant="primary" disabled={selected === null} onClick={() => void finalize()}>
          Als Endfassung übernehmen
        </Button>
        <Button disabled={selected === null} onClick={() => setRemovingDraft(true)}>
          Entwurf löschen
        </Button>
      </div>
      <JournalFinals day={view.day} timezone={view.timezone} message={message} onMessage={setMessage} />
      {removingDraft && current !== undefined ? (
        <ConfirmDialog title="Entwurf löschen?" confirmLabel="In den Papierkorb" danger onClose={() => setRemovingDraft(false)} onConfirm={() => void removeDraft(current.file)}>
          <p>
            Der Entwurf von {current.time} ({current.mode === 'ai' ? 'KI-Entwurf' : 'ohne KI'}) wird in den Windows-Papierkorb verschoben. Andere Entwürfe und Endfassungen bleiben unverändert.
          </p>
        </ConfirmDialog>
      ) : null}
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
