import { todayIn } from '../../../shared/dates';
import { Banner, ErrorBoundary, LoadingSkeleton, Tabs } from '../../components';
import type { DayTab } from '../../store/appStore';
import { useLoad, usePageEnv } from '../env';
import { AttentionPanel } from './AttentionPanel';
import { DayHeader } from './DayHeader';
import { DaySummary } from './DaySummary';
import { DayTimeline } from './DayTimeline';
import { JournalTab } from './JournalTab';
import { NotesTab } from './NotesTab';
import { WorkLogsTab } from './WorkLogsTab';

export interface DayPageProps {
  /** `null` means today in the time zone of the project. */
  day: string | null;
  tab: DayTab;
}

/** The day: header with calendar, summary, attention panel and the tabs timeline, work logs, notes, journal (spec §8.3). */
export function DayPage({ day, tab }: DayPageProps) {
  const env = usePageEnv();
  const today = todayIn(env.timezone ?? 'UTC');
  const current = day ?? today;
  const view = useLoad(() => env.api.day.load(env.repositoryId, current), [env.repositoryId, current]);
  const index = useLoad(() => env.api.day.index(env.repositoryId), [env.repositoryId]);
  const references = useLoad(() => env.api.notes.references(env.repositoryId), [env.repositoryId]);

  if (view.data === null) {
    return view.error !== null ? (
      <Banner level="err" title="Der Tag konnte nicht geladen werden" details={`${view.error.code}: ${view.error.message}`} />
    ) : (
      <LoadingSkeleton loading={view.loading} lines={5} />
    );
  }
  const data = view.data;
  const tabs = [
    { id: 'timeline', label: 'Zeitstrahl' },
    { id: 'workLogs', label: 'Work-Logs', count: data.snapshots.length },
    { id: 'notes', label: 'Notizen', count: data.notes.length },
    { id: 'journal', label: 'Journal', count: data.drafts.length },
  ];

  return (
    <div className="stack">
      <DayHeader day={current} today={index.data?.today ?? today} timezone={data.timezone} index={index.data} onChange={env.actions.setDay} />
      {data.isFuture ? (
        <Banner level="info" title="Dieser Tag liegt in der Zukunft">
          Für einen Tag in der Zukunft sind nur Planungsnotizen möglich.
        </Banner>
      ) : null}
      <DaySummary summary={data.summary} />
      <AttentionPanel
        items={data.attention}
        onGo={(target) => (target === 'overview' ? env.actions.selectPage('overview') : env.actions.setDayTab(target))}
      />
      <Tabs label="Ansicht des Tages" tabs={tabs} selected={tab} onSelect={(id) => env.actions.setDayTab(id as DayTab)}>
        <ErrorBoundary area="Dieser Tab" key={`${current}:${tab}`}>
          {tab === 'timeline' ? <DayTimeline view={data} /> : null}
          {tab === 'workLogs' ? <WorkLogsTab view={data} references={references.data} /> : null}
          {tab === 'notes' ? <NotesTab view={data} references={references.data} /> : null}
          {tab === 'journal' ? <JournalTab view={data} references={references.data} /> : null}
        </ErrorBoundary>
      </Tabs>
    </div>
  );
}
