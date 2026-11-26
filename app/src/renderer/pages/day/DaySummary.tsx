import type { DayView } from '../../../shared/views';
import { Icon, Tooltip } from '../../components';

/**
 * One calm line: snapshots, notes, measured and estimated time apart (spec §8.3, §5.6). There is no total anywhere;
 * delay, planned time and notes without time are explained in the tooltip.
 */
export function DaySummary({ summary }: { summary: DayView['summary'] }) {
  const { time } = summary;
  const parts: string[] = [];
  if (time.delays.measured + time.delays.estimated > 0) {
    const delays = [time.delays.measured > 0 ? `${time.delays.measured} min, gemessen` : null, time.delays.estimated > 0 ? `${time.delays.estimated} min, geschätzt` : null].filter(Boolean);
    parts.push(`Verzögerung: ${delays.join(' und ')}. Nie zur Zeit addiert.`);
  }
  if (time.planned.measured + time.planned.estimated > 0) {
    const planned = [time.planned.measured > 0 ? `${time.planned.measured} min, gemessen` : null, time.planned.estimated > 0 ? `${time.planned.estimated} min, geschätzt` : null].filter(Boolean);
    parts.push(`Geplant: ${planned.join(' und ')}. Nicht in der Zeit enthalten.`);
  }
  if (time.withoutTime > 0) parts.push(`${time.withoutTime} ${time.withoutTime === 1 ? 'Notiz' : 'Notizen'} ohne Zeitangabe`);
  const info = parts.length === 0 ? 'Keine Verzögerung, keine Planung, keine Notizen ohne Zeitangabe.' : parts.join(' ');
  return (
    <div className="day-summary" aria-label="Zusammenfassung des Tages" role="group">
      <span className="day-summary__item">
        Snapshots <strong>{summary.snapshotCount}</strong>
      </span>
      <span className="day-summary__item">
        Notizen <strong>{summary.noteCount}</strong>
      </span>
      <span className="day-summary__item">
        Zeit gemessen <strong>{time.time.measured} min</strong>
      </span>
      <span className="day-summary__item">
        Zeit geschätzt <strong>{time.time.estimated} min</strong>
      </span>
      <Tooltip text={info}>
        <button type="button" className="btn btn--ghost" aria-label="Weitere Angaben zur Zeit" style={{ minHeight: 24, padding: '0 4px' }}>
          <Icon name="info" />
        </button>
      </Tooltip>
    </div>
  );
}
