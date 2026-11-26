import { useEffect, useMemo, useState } from 'react';
import { formatLongDay, todayIn, weekdayOf } from '../../shared/dates';
import type { IpaApi } from '../../shared/ipc';
import { MAX_NOTE_TEXT, type RunResultView } from '../../shared/run';
import { detectorLabel } from '../../shared/run-texts';
import type { DayIndex, EvidenceGroup, NoteType } from '../../shared/views';
import { Banner, Button, Dialog, Field, Icon } from '../components';
import { DayCalendar } from '../pages/day/DayHeader';
import { NOTE_ICON } from '../pages/day/NotesTab';
import { BASIS_LABEL, NOTE_TYPES, NOTE_TYPE_LABEL } from '../pages/format';
import type { AppActions } from '../store/appStore';
import { ResultNotice, useAction, usageError } from './common';
import { changeTimeMode, changeType, checkForm, emptyForm, type NoteForm } from './noteForm';

export interface NoteDialogProps {
  api: IpaApi;
  actions: AppActions;
  repositoryId: string;
  timezone: string;
  /** Day to preselect, for example the day on screen; `null` means today. */
  day: string | null;
  onClose: () => void;
  /** Renders in place without scrim, for the state gallery. */
  inline?: boolean;
  /** Gallery: starts with this form and the extra fields open. */
  preset?: { form?: Partial<import('./noteForm').NoteForm>; more?: boolean; evidence?: boolean; index?: DayIndex; groups?: EvidenceGroup[] };
}

/** "Mittwoch, 14.10.2026 · heute" (spec §8.8). */
export function dayLabel(day: string, today: string): string {
  const [year, month, date] = day.split('-');
  const base = `${weekdayOf(day)}, ${date}.${month}.${year}`;
  if (day === today) return `${base} · heute`;
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return days > 0 ? `${base} · in ${days} ${days === 1 ? 'Tag' : 'Tagen'}` : base;
}

const TYPE_HINT: Record<NoteType, string> = {
  general: 'Allgemeine Notiz',
  activity: 'Etwas, das du getan hast',
  problem: 'Ein Problem, mit Ursache und Lösung',
  decision: 'Eine Entscheidung, mit Grund und Alternativen',
  insight: 'Eine Erkenntnis',
  plan: 'Etwas, das du vorhast',
};

/** What the saved panel says: type, day and time, never the text (spec §8.8, I-12). */
export function savedLine(result: Extract<RunResultView, { kind: 'note' }>): string {
  const [, month, date] = result.activityDay.split('-');
  const parts: string[] = [NOTE_TYPE_LABEL[result.type], `${weekdayOf(result.activityDay)}, ${date}.${month}.`];
  if (result.time === null) parts.push('ohne Zeit');
  else {
    parts.push(result.time.start !== null && result.time.end !== null ? `${result.time.start} bis ${result.time.end}` : `${result.time.minutes} min`);
    parts.push(BASIS_LABEL[result.time.basis]);
  }
  if (result.delay !== null) parts.push(`Verzögerung ${result.delay.minutes} min, ${BASIS_LABEL[result.delay.basis]}`);
  return parts.join(' · ');
}

function EvidencePicker({ api, repositoryId, selected, onChange, initial }: { api: IpaApi; repositoryId: string; selected: string[]; onChange: (refs: string[]) => void; initial?: EvidenceGroup[] }) {
  const [groups, setGroups] = useState<EvidenceGroup[] | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    void api.snapshot.evidenceList(repositoryId).then((result) => {
      if (!live) return;
      if (result.ok) setGroups(result.value);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [api, repositoryId]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (groups ?? [])
        .map((group) => ({
          ...group,
          items: needle === '' ? group.items : group.items.filter((item) => [item.ref, item.kindLabel, item.kind, item.path ?? ''].some((part) => part.toLowerCase().includes(needle))),
        }))
        .filter((group) => group.items.length > 0),
    [groups, needle],
  );
  const total = (groups ?? []).reduce((sum, group) => sum + group.items.length, 0);
  const toggle = (ref: string): void => onChange(selected.includes(ref) ? selected.filter((item) => item !== ref) : [...selected, ref]);

  if (failed) return <Banner level="warn">Die Belege konnten nicht gelesen werden.</Banner>;
  if (groups === null) return <span className="muted">Belege werden gelesen …</span>;
  if (total === 0) return <p className="muted">Noch keine Belege vorhanden. Belege entstehen, wenn ein Snapshot gespeichert wird.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Belege durchsuchen">{(control) => <input {...control} className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />}</Field>
      <div className="muted" role="status">
        {selected.length} {selected.length === 1 ? 'Beleg' : 'Belege'} gewählt
      </div>
      {shown.length === 0 ? (
        <div>
          <p style={{ margin: '0 0 6px' }}>Keine Belege gefunden. Für «{query.trim()}» gibt es in den gespeicherten Snapshots keinen Beleg.</p>
          <Button onClick={() => setQuery('')}>Suche zurücksetzen</Button>
        </div>
      ) : (
        <div className="evidence-list" role="group" aria-label="Belege">
          {shown.map((group) => (
            <fieldset key={group.snapshotId} className="evidence-group">
              <legend>{group.title}</legend>
              {group.items.map((item) => (
                <label key={item.ref} className="evidence-row">
                  <input type="checkbox" checked={selected.includes(item.ref)} onChange={() => toggle(item.ref)} />
                  <span className="mono">{item.ref}</span>
                  <span title={item.kind}>{item.kindLabel}</span>
                  <span className="muted mono">{item.path ?? ''}</span>
                  {item.omitted !== null ? <span className="muted">{item.omitted}</span> : null}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Neue Notiz" (spec §8.8): small by default, "Mehr Felder" for type fields, time and evidence. */
export function NoteDialog({ api, actions, repositoryId, timezone, day, onClose, inline, preset }: NoteDialogProps) {
  const today = todayIn(timezone);
  const [form, setForm] = useState<NoteForm>(() => ({ ...emptyForm(today), ...(day !== null && day <= today ? { day } : {}), ...preset?.form }));
  const [more, setMore] = useState(preset?.more === true);
  const [calendar, setCalendar] = useState(false);
  const [index, setIndex] = useState<DayIndex | null>(preset?.index ?? null);
  const [showEvidence, setShowEvidence] = useState(preset?.evidence === true);
  const action = useAction(actions, repositoryId);
  const check = checkForm(form);
  const set = (patch: Partial<NoteForm>): void => setForm((previous) => ({ ...previous, ...patch }));

  useEffect(() => {
    if (preset?.index !== undefined) return;
    let live = true;
    void api.day.index(repositoryId).then((result) => {
      if (live && result.ok) setIndex(result.value);
    });
    return () => {
      live = false;
    };
  }, [api, repositoryId]);

  const save = (): void => {
    if (check.input === null || action.busy) return;
    void action.start({ name: 'note', ...check.input });
  };
  const state = action.state;
  const saved = state.phase === 'done' && state.summary.exitCode === 0 && state.summary.result?.kind === 'note' ? state.summary.result : null;
  const futureOk = form.type === 'plan';
  const serverError = usageError(state);

  if (saved !== null) {
    return (
      <Dialog
        title="Notiz gespeichert"
        wide
        {...(inline === true ? { inline } : {})}
        onClose={onClose}
        onConfirm={onClose}
        footer={
          <>
            <Button
              onClick={() => {
                actions.openDay(saved.activityDay, 'timeline');
                onClose();
              }}
            >
              Im Zeitstrahl ansehen
            </Button>
            <Button
              onClick={() => {
                action.reset();
                setForm(emptyForm(today));
                setMore(false);
              }}
            >
              Weitere Notiz
            </Button>
            <Button variant="primary" onClick={onClose}>
              Schliessen
            </Button>
          </>
        }
      >
        <p role="status" style={{ marginTop: 0 }}>
          {savedLine(saved)}
        </p>
        {saved.secretFindings.length > 0 ? (
          <Banner level="warn" title="Mögliches Zugangsdatum erkannt">
            Detektor: {[...new Set(saved.secretFindings.map((finding) => finding.detector))].map((name) => `${detectorLabel(name)} (${name})`).join(', ')}. Der Wert wird nie angezeigt. Die Notiz wurde trotzdem gespeichert. Sie wird zurückgehalten, nie an Claude gesendet und fliesst nicht in Analyse und Journal ein.
          </Banner>
        ) : null}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Neue Notiz"
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={save}
      footer={
        <>
          <span className="dialog__hint" role={check.blocked !== null ? 'status' : undefined}>
            {check.blocked ?? 'Strg+Enter speichert'}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={check.blocked !== null || action.busy} {...(check.blocked !== null ? { disabledReason: check.blocked } : {})} onClick={save}>
            {action.busy ? 'Speichert …' : 'Speichern'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="note-tiles" role="radiogroup" aria-label="Art der Notiz">
          {NOTE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={form.type === type}
              title={TYPE_HINT[type]}
              className={form.type === type ? 'note-tile note-tile--on' : 'note-tile'}
              onClick={() => setForm((previous) => changeType(previous, type, today))}
            >
              <Icon name={NOTE_ICON[type]} />
              {NOTE_TYPE_LABEL[type]}
            </button>
          ))}
        </div>

        <Field label="Text (Pflicht)" {...(check.errors.text !== undefined ? { error: check.errors.text } : serverError !== null ? { error: serverError } : {})}>
          {(control) => <textarea {...control} data-autofocus className="textarea" rows={4} value={form.text} onChange={(event) => set({ text: event.target.value })} />}
        </Field>

        <div className="field">
          <span className="field__label">Tag</span>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <Button aria-expanded={calendar} aria-haspopup="dialog" icon="calendar" onClick={() => setCalendar((value) => !value)}>
              {dayLabel(form.day, today)}
            </Button>
            {calendar ? (
              <DayCalendar
                selected={form.day}
                today={today}
                index={index}
                disableFuture={!futureOk}
                onClose={() => setCalendar(false)}
                onSelect={(next) => {
                  setCalendar(false);
                  set({ day: next });
                }}
              />
            ) : null}
          </span>
          <span className="field__hint">Zukunftstage nur bei Planung.{form.day > today ? ` ${formatLongDay(form.day)}.` : ''}</span>
        </div>

        <div>
          <Button variant="ghost" aria-expanded={more} onClick={() => setMore((value) => !value)}>
            {more ? 'Weniger Felder' : 'Mehr Felder'}
          </Button>
        </div>

        {more ? (
          <div className="stack">
            {form.type === 'decision' ? (
              <>
                <Field label="Grund">{(control) => <textarea {...control} className="textarea" rows={2} maxLength={MAX_NOTE_TEXT} value={form.reason} onChange={(event) => set({ reason: event.target.value })} />}</Field>
                <div className="field">
                  <span className="field__label">Geprüfte Alternativen</span>
                  {form.alternatives.map((item, position) => (
                    <div key={position} className="row">
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        aria-label={`Alternative ${position + 1}`}
                        maxLength={1000}
                        value={item}
                        onChange={(event) => set({ alternatives: form.alternatives.map((entry, at) => (at === position ? event.target.value : entry)) })}
                      />
                      <Button variant="ghost" aria-label={`Alternative ${position + 1} entfernen`} onClick={() => set({ alternatives: form.alternatives.filter((_entry, at) => at !== position) })}>
                        <Icon name="close" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button variant="ghost" icon="plus" disabled={form.alternatives.length >= 20} onClick={() => set({ alternatives: [...form.alternatives, ''] })}>
                      Alternative hinzufügen
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
            {form.type === 'problem' ? (
              <>
                <Field label="Ursache">{(control) => <textarea {...control} className="textarea" rows={2} maxLength={MAX_NOTE_TEXT} value={form.cause} onChange={(event) => set({ cause: event.target.value })} />}</Field>
                <Field label="Lösung">{(control) => <textarea {...control} className="textarea" rows={2} maxLength={MAX_NOTE_TEXT} value={form.solution} onChange={(event) => set({ solution: event.target.value })} />}</Field>
              </>
            ) : null}

            <fieldset className="note-time">
              <legend>Zeit und Verzögerung (optional)</legend>
              <div className="row" role="radiogroup" aria-label="Zeitangabe">
                <label>
                  <input type="radio" name="time-mode" checked={form.timeMode === 'duration'} onChange={() => setForm((previous) => changeTimeMode(previous, 'duration'))} /> Dauer
                </label>
                <label>
                  <input type="radio" name="time-mode" checked={form.timeMode === 'range'} onChange={() => setForm((previous) => changeTimeMode(previous, 'range'))} /> Von–bis
                </label>
              </div>
              {form.timeMode === 'duration' ? (
                <Field label="Minuten" {...(check.errors.minutes !== undefined ? { error: check.errors.minutes } : {})}>
                  {(control) => <input {...control} className="input" inputMode="numeric" value={form.minutes} onChange={(event) => set({ minutes: event.target.value })} />}
                </Field>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row">
                    <Field label="Von" {...(check.errors.start !== undefined ? { error: check.errors.start } : { hint: 'HH:MM' })}>
                      {(control) => <input {...control} className="input" placeholder="09:10" value={form.start} onChange={(event) => set({ start: event.target.value })} />}
                    </Field>
                    <Field label="Bis" {...(check.errors.end !== undefined ? { error: check.errors.end } : { hint: 'HH:MM' })}>
                      {(control) => <input {...control} className="input" placeholder="09:55" value={form.end} onChange={(event) => set({ end: event.target.value })} />}
                    </Field>
                    {check.computed !== null ? <strong aria-live="polite">= {check.computed} Minuten</strong> : null}
                  </div>
                  <span className="muted">Eine Tätigkeit über Mitternacht erfasst du als zwei Notizen.</span>
                </div>
              )}
              {check.needsBasis ? (
                <div role="radiogroup" aria-label="Gemessen oder geschätzt" className="stack" style={{ gap: 4 }}>
                  <div className="row">
                    <label>
                      <input type="radio" name="basis" checked={form.basis === 'measured'} onChange={() => set({ basis: 'measured' })} /> Gemessen
                    </label>
                    <label>
                      <input type="radio" name="basis" checked={form.basis === 'estimated'} onChange={() => set({ basis: 'estimated' })} /> Geschätzt
                    </label>
                  </div>
                  <span className="field__hint">Pflicht, sobald Zeit oder Verzögerung angegeben ist. Gilt für beide.</span>
                  {check.errors.basis !== undefined ? (
                    <span className="field__error" role="alert">
                      {check.errors.basis}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <Field label="Verzögerung" {...(check.errors.delay !== undefined ? { error: check.errors.delay } : { hint: 'Minuten. Wird nie zur Zeit addiert.' })}>
                {(control) => <input {...control} className="input" inputMode="numeric" value={form.delay} onChange={(event) => set({ delay: event.target.value })} />}
              </Field>
            </fieldset>

            <div className="stack" style={{ gap: 6 }}>
              <div>
                <Button variant="ghost" aria-expanded={showEvidence} onClick={() => setShowEvidence((value) => !value)}>
                  Belege {form.refs.length > 0 ? `(${form.refs.length})` : ''}
                </Button>
              </div>
              {showEvidence ? <EvidencePicker api={api} repositoryId={repositoryId} selected={form.refs} onChange={(refs) => set({ refs })} {...(preset?.groups !== undefined ? { initial: preset.groups } : {})} /> : null}
              {check.errors.refs !== undefined ? (
                <span className="field__error" role="alert">
                  {check.errors.refs}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <ResultNotice state={state} />
      </div>
    </Dialog>
  );
}
