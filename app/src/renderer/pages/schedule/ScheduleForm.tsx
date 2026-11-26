import { useState } from 'react';
import { WEEKDAYS, WEEKDAY_LABEL, WEEKDAY_NAME, type Weekday } from '../../../shared/config';
import { Button, Field, Icon } from '../../components';
import type { ScheduleErrors } from '../config/draft';

export interface ScheduleDraft {
  workdays: Weekday[];
  windowStart: string;
  windowEnd: string;
  intervalMinutes: string;
  extraRunTimes: string[];
}

export interface ScheduleFormProps {
  draft: ScheduleDraft;
  errors: ScheduleErrors;
  timezone: string;
  onChange: (next: ScheduleDraft) => void;
}

/** Work days, time window, interval and extra runs: the `schedule` block of the configuration (spec §8.10). */
export function ScheduleForm({ draft, errors, timezone, onChange }: ScheduleFormProps) {
  const [adding, setAdding] = useState('');
  const set = (patch: Partial<ScheduleDraft>): void => onChange({ ...draft, ...patch });
  const toggle = (day: Weekday): void => set({ workdays: draft.workdays.includes(day) ? draft.workdays.filter((entry) => entry !== day) : WEEKDAYS.filter((entry) => entry === day || draft.workdays.includes(entry)) });

  return (
    <form className="stack" aria-label="Zeitplan bearbeiten" onSubmit={(event) => event.preventDefault()}>
      <fieldset className={errors.workdays !== undefined ? 'schedule-field schedule-field--err' : 'schedule-field'}>
        <legend>Arbeitstage</legend>
        <div className="row">
          {WEEKDAYS.map((day) => (
            <button key={day} type="button" className="day-chip" aria-pressed={draft.workdays.includes(day)} title={WEEKDAY_NAME[day]} onClick={() => toggle(day)}>
              {WEEKDAY_LABEL[day]}
            </button>
          ))}
        </div>
        {errors.workdays !== undefined ? (
          <span className="field__error" role="alert">
            {errors.workdays}
          </span>
        ) : null}
      </fieldset>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field label="Zeitfenster von" {...(errors.windowStart !== undefined ? { error: errors.windowStart } : { hint: 'HH:MM' })}>
          {(control) => <input {...control} className="input" placeholder="08:00" value={draft.windowStart} onChange={(event) => set({ windowStart: event.target.value })} />}
        </Field>
        <Field label="Zeitfenster bis" {...(errors.windowEnd !== undefined ? { error: errors.windowEnd } : { hint: 'HH:MM' })}>
          {(control) => <input {...control} className="input" placeholder="18:00" value={draft.windowEnd} onChange={(event) => set({ windowEnd: event.target.value })} />}
        </Field>
        <Field label="Intervall (Minuten)" {...(errors.intervalMinutes !== undefined ? { error: errors.intervalMinutes } : {})}>
          {(control) => <input {...control} className="input" inputMode="numeric" value={draft.intervalMinutes} onChange={(event) => set({ intervalMinutes: event.target.value })} />}
        </Field>
      </div>

      <div className="field">
        <span className="field__label">Zusätzliche Läufe</span>
        <ul className="chip-list" aria-label="Zusätzliche Läufe">
          {draft.extraRunTimes.map((time, index) => (
            <li key={`${time}-${index}`}>
              <span className="chip">
                {time}
                <button type="button" className="chip__remove" aria-label={`Zusatzlauf ${time} entfernen`} onClick={() => set({ extraRunTimes: draft.extraRunTimes.filter((_entry, at) => at !== index) })}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="row">
          <input className="input" aria-label="Neuer Zusatzlauf" placeholder="17:45" value={adding} onChange={(event) => setAdding(event.target.value)} />
          <Button
            icon="plus"
            disabled={adding.trim() === ''}
            onClick={() => {
              set({ extraRunTimes: [...draft.extraRunTimes, adding.trim()] });
              setAdding('');
            }}
          >
            Hinzufügen
          </Button>
        </div>
        {errors.extraRunTimes !== undefined ? (
          <span className="field__error" role="alert">
            {errors.extraRunTimes}
          </span>
        ) : null}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Alle Uhrzeiten gelten in der Zeitzone des Projekts: {timezone}
      </p>
    </form>
  );
}
