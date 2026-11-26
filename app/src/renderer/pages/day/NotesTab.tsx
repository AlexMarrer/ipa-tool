import { useEffect, useRef, useState } from 'react';
import type { DayView, NoteType, NoteView, ReferenceIndex } from '../../../shared/views';
import { Banner, Chip, ContentLabel, EmptyState, Icon, RefChip, type IconName } from '../../components';
import { BASIS_LABEL, NOTE_TYPES, NOTE_TYPE_LABEL, noteFigure, noteTitle, timeDetail } from '../format';
import { jumpToReference, usePageEnv } from '../env';

const ICON: Record<NoteType, IconName> = { general: 'info', activity: 'clock', problem: 'warning', decision: 'branch', insight: 'bulb', plan: 'calendar' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function NoteDetails({ note, references, onReference }: { note: NoteView; references: ReferenceIndex | null; onReference: (id: string) => void }) {
  return (
    <dl className="kv" style={{ padding: '4px 4px 12px 40px' }}>
      <Field label="Typ">{NOTE_TYPE_LABEL[note.type]}</Field>
      <Field label="Tag">{note.activityDay}</Field>
      <Field label="Zeit">{timeDetail(note)}</Field>
      {note.time !== null ? <Field label="Basis">{BASIS_LABEL[note.time.basis]}</Field> : null}
      <Field label="Verzögerung">
        {note.delay === null ? 'nicht angegeben' : `${note.delay.minutes} Minuten, ${BASIS_LABEL[note.delay.basis]} (nie zur Zeit addiert)`}
      </Field>
      {note.reason !== null ? <Field label="Grund">{note.reason}</Field> : null}
      {note.alternatives.length > 0 ? <Field label="Geprüfte Alternativen">{note.alternatives.join(', ')}</Field> : null}
      {note.cause !== null ? <Field label="Ursache">{note.cause}</Field> : null}
      {note.solution !== null ? <Field label="Lösung">{note.solution}</Field> : null}
      <Field label="Verweise">
        {note.refs.length === 0 ? (
          'keine'
        ) : (
          <span className="row" style={{ gap: 6 }}>
            {note.refs.map((ref) => (
              <RefChip key={ref} id={ref} kind="snapshot" onOpen={() => onReference(ref)} />
            ))}
          </span>
        )}
      </Field>
      <Field label="Notiz-ID">
        <span className="mono">{note.id}</span>
      </Field>
      <Field label="Etikett">
        <span className="row" style={{ gap: 6 }}>
          <ContentLabel kind="note" />
          {note.withheld !== null ? (
            <Chip tone="warn" icon="warning">
              zurückgehalten (Detektor {note.withheld.detectors.join(', ')})
            </Chip>
          ) : null}
        </span>
      </Field>
    </dl>
  );
}

export interface NotesTabProps {
  view: DayView;
  references: ReferenceIndex | null;
}

/** Notes of the day with filter, expandable fields and the notes marked as withheld (spec §8.6). Read only. */
export function NotesTab({ view, references }: NotesTabProps) {
  const env = usePageEnv();
  const [filter, setFilter] = useState<NoteType | 'all'>('all');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(env.focus?.noteId != null ? [env.focus.noteId] : []));
  const focusRef = useRef<HTMLLIElement | null>(null);
  const focusId = env.focus?.noteId ?? null;

  useEffect(() => {
    if (focusId === null) return;
    setFilter('all');
    setOpen((previous) => new Set(previous).add(focusId));
  }, [focusId]);
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'center' });
  }, [focusId, view.notes.length]);

  const counts = new Map<NoteType, number>();
  for (const note of view.notes) counts.set(note.type, (counts.get(note.type) ?? 0) + 1);
  const notes = filter === 'all' ? view.notes : view.notes.filter((note) => note.type === filter);

  if (view.notes.length === 0) {
    return (
      <div className="stack">
        {view.invalid.noteLines > 0 ? <Banner level="warn">{view.invalid.noteLines} beschädigte Zeile(n) in notes/{view.day}.jsonl.</Banner> : null}
        <EmptyState
          title="Keine Notizen an diesem Tag"
          text="Notizen halten Tätigkeiten, Probleme und Entscheidungen fest. Notizen fliessen in die Analyse und das Journal ein. Notizen mit möglichem Zugangsdatum werden zurückgehalten."
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Notizen sind in V1 nicht änderbar.{counts.has('plan') ? ' Planung zählt nicht zur Zeit, sie wird getrennt als Geplant gezeigt.' : ''}
      </p>
      {view.invalid.noteLines > 0 ? <Banner level="warn">{view.invalid.noteLines} beschädigte Zeile(n) in notes/{view.day}.jsonl werden übersprungen.</Banner> : null}
      <div className="note-filter" role="group" aria-label="Notizen filtern">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Alle {view.notes.length}
        </button>
        {NOTE_TYPES.map((type) => (
          <button key={type} type="button" aria-pressed={filter === type} onClick={() => setFilter(type)}>
            {NOTE_TYPE_LABEL[type]} {counts.get(type) ?? 0}
          </button>
        ))}
      </div>
      <ul className="timeline" aria-label="Notizen">
        {notes.map((note) => {
          const expanded = open.has(note.id);
          return (
            <li key={note.id} ref={note.id === focusId ? focusRef : undefined} className={['note-row', note.id === focusId ? 'note-row--hit' : ''].filter(Boolean).join(' ')}>
              <button
                type="button"
                className="tl-row"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((previous) => {
                    const next = new Set(previous);
                    if (!next.delete(note.id)) next.add(note.id);
                    return next;
                  })
                }
              >
                <span className="tl-time">{note.displayTime ?? '–'}</span>
                <Icon name={ICON[note.type]} title={NOTE_TYPE_LABEL[note.type]} />
                <span>
                  {noteTitle(note.text)}{' '}
                  <Chip>{NOTE_TYPE_LABEL[note.type]}</Chip>{' '}
                  {note.withheld !== null ? <Chip tone="warn" icon="warning">zurückgehalten</Chip> : null}
                </span>
                <span className="tl-meta">{noteFigure(note)}</span>
              </button>
              {expanded ? (
                <NoteDetails
                  note={note}
                  references={references}
                  onReference={(ref) => {
                    const target = /^(S\d{6}):/.exec(ref);
                    if (target?.[1] !== undefined) jumpToReference(env, references, { kind: 'evidence', id: ref, snapshotId: target[1] });
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
