import type { AttentionItem } from '../../../shared/views';
import { Button, Icon, StatusChip } from '../../components';
import type { DayTab } from '../../store/appStore';

export interface AttentionPanelProps {
  items: AttentionItem[];
  onGo: (tab: DayTab | 'overview') => void;
}

const LINK: Record<NonNullable<AttentionItem['link']>, { label: string; target: DayTab | 'overview' }> = {
  workLogs: { label: 'Im Tab Work-Logs öffnen', target: 'workLogs' },
  timeline: { label: 'Im Zeitstrahl anzeigen', target: 'timeline' },
  overview: { label: 'Zur Projektübersicht', target: 'overview' },
};

/** "n Dinge brauchen Aufmerksamkeit", only when something is there; notices below do not count (spec §5.7). */
export function AttentionPanel({ items, onGo }: AttentionPanelProps) {
  if (items.length === 0) return null;
  const attention = items.filter((item) => item.level === 'attention');
  const notices = items.filter((item) => item.level === 'notice');
  return (
    <details className="card attention" open={attention.length > 0 && attention.length <= 3}>
      <summary>
        <Icon name="warning" /> {attention.length === 0 ? 'Zur Kenntnis' : `${attention.length} ${attention.length === 1 ? 'Ding braucht' : 'Dinge brauchen'} Aufmerksamkeit`}
      </summary>
      <ul>
        {attention.map((item) => (
          <li key={item.id}>
            {item.status !== undefined ? <StatusChip status={item.status} /> : null}
            <span>{item.text}</span>
            {item.link !== undefined ? (
              <Button variant="ghost" onClick={() => onGo(LINK[item.link as keyof typeof LINK].target)}>
                {LINK[item.link].label}
              </Button>
            ) : null}
          </li>
        ))}
        {notices.length > 0 ? (
          <li className="muted" style={{ display: 'block' }}>
            <strong>Zur Kenntnis:</strong>
            <ul style={{ marginTop: 4 }}>
              {notices.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </details>
  );
}
