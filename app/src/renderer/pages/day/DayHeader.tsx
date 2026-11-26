import { useEffect, useRef, useState } from 'react';
import { formatLongDay, shiftDay } from '../../../shared/dates';
import type { DayIndex } from '../../../shared/views';
import { Button, Icon } from '../../components';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export interface DayCalendarProps {
  selected: string;
  today: string;
  index: DayIndex | null;
  onSelect: (day: string) => void;
  onClose: () => void;
}

/** Month grid with marks for "day with data" and "day with warning" (spec §8.3). Future days are selectable. */
export function DayCalendar({ selected, today, index, onSelect, onClose }: DayCalendarProps) {
  const [month, setMonth] = useState(() => ({ year: Number(selected.slice(0, 4)), month: Number(selected.slice(5, 7)) - 1 }));
  const marks = new Map((index?.days ?? []).map((entry) => [entry.day, entry]));
  const first = new Date(Date.UTC(month.year, month.month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const move = (delta: number): void => {
    const next = new Date(Date.UTC(month.year, month.month + delta, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  return (
    <div className="popover" role="dialog" aria-label="Kalender" onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), onClose())}>
      <div className="cal-head">
        <Button variant="ghost" aria-label="Vormonat" onClick={() => move(-1)}>
          <Icon name="arrow-left" />
        </Button>
        <strong aria-live="polite">
          {MONTHS[month.month]} {month.year}
        </strong>
        <Button variant="ghost" aria-label="Folgemonat" onClick={() => move(1)}>
          <Icon name="arrow-right" />
        </Button>
      </div>
      <div className="cal-grid" role="grid" aria-label={`${MONTHS[month.month]} ${month.year}`}>
        {WEEKDAYS.map((name) => (
          <div key={name} className="cal-dow" role="columnheader">
            {name}
          </div>
        ))}
        {Array.from({ length: offset }, (_unused, empty) => (
          <div key={`leer-${empty}`} />
        ))}
        {Array.from({ length: count }, (_unused, index0) => {
          const day = `${month.year}-${pad(month.month + 1)}-${pad(index0 + 1)}`;
          const mark = marks.get(day);
          const parts = [formatLongDay(day)];
          if (day === today) parts.push('heute');
          if (mark?.warning === true) parts.push('Warnung');
          else if (mark?.hasData === true) parts.push('Daten vorhanden');
          return (
            <button
              key={day}
              type="button"
              className={['cal-day', day === today ? 'cal-day--today' : ''].filter(Boolean).join(' ')}
              aria-pressed={day === selected}
              aria-label={parts.join(', ')}
              onClick={() => onSelect(day)}
            >
              {index0 + 1}
              {mark !== undefined ? <span className={mark.warning ? 'cal-dot cal-dot--warn' : 'cal-dot'} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="cal-legend" aria-hidden="true">
        <span>
          <span className="cal-dot" style={{ position: 'static', display: 'inline-block', transform: 'none' }} /> Tag mit Daten
        </span>
        <span>
          <span className="cal-dot cal-dot--warn" style={{ position: 'static', display: 'inline-block', transform: 'none' }} /> Tag mit Warnung
        </span>
      </div>
    </div>
  );
}

export interface DayHeaderProps {
  day: string;
  today: string;
  timezone: string;
  index: DayIndex | null;
  onChange: (day: string) => void;
}

/** `‹` previous day, date with weekday, `›` next day, calendar switch, "Heute" and the zone (spec §8.3). */
export function DayHeader({ day, today, timezone, index, onChange }: DayHeaderProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    // Esc closes the popover wherever the focus is (spec §8.1), also on the calendar switch itself.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="day-head" ref={root}>
      <Button variant="ghost" aria-label="Vortag" onClick={() => onChange(shiftDay(day, -1))}>
        <Icon name="arrow-left" />
      </Button>
      <h2>{formatLongDay(day)}</h2>
      <Button variant="ghost" aria-label="Folgetag" onClick={() => onChange(shiftDay(day, 1))}>
        <Icon name="arrow-right" />
      </Button>
      <span style={{ position: 'relative' }}>
        <Button aria-label="Kalender" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
          <Icon name="calendar" />
        </Button>
        {open ? (
          <DayCalendar
            selected={day}
            today={today}
            index={index}
            onClose={() => setOpen(false)}
            onSelect={(next) => {
              setOpen(false);
              onChange(next);
            }}
          />
        ) : null}
      </span>
      <Button disabled={day === today} onClick={() => onChange(today)}>
        Heute
      </Button>
      <span className="day-head__zone">Zeitzone {timezone}</span>
    </div>
  );
}
