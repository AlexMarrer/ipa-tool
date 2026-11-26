import type { HaltView, OverviewView } from '../../../shared/views';
import { ANALYSIS_STATUS, EXIT_CODE_MESSAGES, RUN_OUTCOME, type RunOutcome } from '../../../shared/messages';
import { Banner, Button, Chip, LoadingSkeleton, OutcomeChip, StatusChip } from '../../components';
import { SCHEDULE_STATE, formatDuration, formatStamp, shortRunId } from '../format';
import { actionReason, usePageEnv, useLoad } from '../env';

/** Halt texts of the design (spec §8.2). */
export const HALT_TEXT: Record<HaltView['reason'], { title: string; text: string }> = {
  branch_changed: {
    title: 'Der Branch hat gewechselt',
    text: 'Das Repository steht auf einem anderen Branch als bei der letzten Erfassung. Bis ein neuer Ausgangspunkt gesetzt ist, nimmt das Tool nichts mehr auf.',
  },
  history_rewritten: {
    title: 'Die Historie wurde umgeschrieben',
    text: 'Zum Beispiel durch Rebase, Amend oder Reset. Der zuletzt erfasste Stand gehört nicht mehr zur Historie des Branches. Das Tool nimmt nichts mehr auf, bis ein neuer Ausgangspunkt gesetzt ist. Offene Analysen laufen trotzdem.',
  },
  head_missing: {
    title: 'HEAD fehlt',
    text: 'Der zuletzt erfasste Stand (HEAD) ist im Repository nicht mehr vorhanden, etwa nach dem Aufräumen oder einem anderen Klon. Das Tool nimmt nichts mehr auf, bis ein neuer Ausgangspunkt gesetzt ist. Offene Analysen laufen trotzdem.',
  },
};

const short = (head: string | null): string => (head === null ? 'nicht gefunden' : head.slice(0, 7));

function position(label: string, value: { branch: string | null; head: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        Branch <span className="mono">{value.branch ?? 'unbekannt'}</span>, HEAD <span className="mono">{short(value.head)}</span>
      </dd>
    </div>
  );
}

/** Red banner with reason, expected and observed state, run and time (spec §8.2). The action follows with the actions package. */
export function HaltBanner({ halt, timezone, onSetBaseline, lockedReason = null }: { halt: HaltView; timezone: string; onSetBaseline?: () => void; lockedReason?: string | null }) {
  const text = HALT_TEXT[halt.reason];
  return (
    <Banner
      level="err"
      title={`Erfassung angehalten: ${text.title}`}
      {...(onSetBaseline !== undefined
        ? {
            actions: (
              <Button variant="primary" disabled={lockedReason !== null} {...(lockedReason !== null ? { disabledReason: lockedReason } : {})} onClick={onSetBaseline}>
                Neuen Ausgangspunkt setzen
              </Button>
            ),
          }
        : {})}
    >
      <p style={{ margin: '4px 0 8px' }}>{text.text}</p>
      <dl className="kv">
        {position('Erwarteter Stand', halt.expected)}
        {position('Beobachteter Stand', halt.observed)}
        <div>
          <dt>Erkannt</dt>
          <dd>
            {halt.runId !== null ? (
              <>
                von Lauf <span className="mono" title={halt.runId}>{shortRunId(halt.runId)}</span>,{' '}
              </>
            ) : null}
            {formatStamp(halt.detectedAt, timezone)} · Exit-Code 4: {EXIT_CODE_MESSAGES[4]?.title}
          </dd>
        </div>
      </dl>
    </Banner>
  );
}

/** Warning only for a problem; with a ready Claude nothing appears (spec §8.2). */
export function ClaudeWarning({ claude, timezone, onCheck, checkDisabled }: { claude: OverviewView['claude']; timezone: string; onCheck?: () => void; checkDisabled?: string | null }) {
  if (claude.ok === true) return null;
  const check =
    onCheck === undefined ? undefined : (
      <Button disabled={checkDisabled != null} {...(checkDisabled != null ? { disabledReason: checkDisabled } : {})} onClick={onCheck}>
        Prüfen
      </Button>
    );
  if (claude.ok === null) {
    return (
      <Banner level="info" title="Claude: Noch nicht geprüft" {...(check !== undefined ? { actions: check } : {})}>
        Die Bereitschaft von Claude wurde noch nicht geprüft. Aufnehmen funktioniert auch ohne.
      </Banner>
    );
  }
  return (
    <Banner level="warn" title="Claude ist nicht bereit" {...(check !== undefined ? { actions: check } : {})}>
      {claude.problem ?? 'Die Prüfung ist nicht bestanden.'} Aufnehmen funktioniert weiter, Analysen und Journal mit KI sind gesperrt.
      <div className="muted" style={{ marginTop: 4 }}>
        {claude.version !== null ? `Version ${claude.version}, ` : ''}geprüft am {formatStamp(claude.checkedAt, timezone)}
      </div>
    </Banner>
  );
}

/** Project overview (spec §8.2): figures from `status --json`, the schedule status and the last days. */
export function OverviewPage() {
  const env = usePageEnv();
  const { data, loading, error } = useLoad(() => env.api.overview.load(env.repositoryId), [env.repositoryId]);

  if (data === null) {
    return error !== null ? (
      <Banner level="err" title="Die Übersicht konnte nicht geladen werden" details={`${error.code}: ${error.message}`} />
    ) : (
      <LoadingSkeleton loading={loading} lines={4} />
    );
  }
  const tz = data.timezone;
  const statuses = (['pending', 'failed', 'blocked', 'exhausted'] as const).filter((key) => data.analyses[key] > 0);
  return (
    <div className="stack">
      {data.halt !== null ? (
        <HaltBanner halt={data.halt} timezone={tz} lockedReason={actionReason(env, 'baseline')} onSetBaseline={() => env.actions.openDialog({ kind: 'baseline', force: false })} />
      ) : null}
      <ClaudeWarning claude={data.claude} timezone={tz} checkDisabled={actionReason(env, 'doctor')} onCheck={() => void env.actions.check(env.repositoryId)} />
      {data.inconsistent ? (
        <Banner level="info" title="Analyse-Stand uneinheitlich">
          Die Ableitung der App weicht von <span className="mono">ipa status</span> ab. Angezeigt werden die Werte von <span className="mono">ipa status</span>.
        </Banner>
      ) : null}
      <div className="grid-cards">
        <section className="card" aria-label="Letzter Lauf">
          <h3>Letzter Lauf</h3>
          {data.lastRun === null ? (
            <span className="muted">Noch kein Lauf.</span>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <OutcomeChip outcome={(data.lastRun.outcome in RUN_OUTCOME ? data.lastRun.outcome : 'error') as RunOutcome} />
              <span>
                {formatStamp(data.lastRun.startedAt, tz)} · {formatDuration(data.lastRun.durationMs)} · <span className="mono">{data.lastRun.command}</span>
              </span>
            </div>
          )}
        </section>
        <section className="card" aria-label="Letzter Snapshot">
          <h3>Letzter Snapshot</h3>
          {data.lastSnapshot === null ? (
            <span className="muted">Noch keiner.</span>
          ) : (
            <span>
              <span className="mono">{data.lastSnapshot.id}</span> · {formatStamp(data.lastSnapshot.time, tz)}
            </span>
          )}
        </section>
        <section className="card" aria-label="Analyse-Stand">
          <h3>Analyse-Stand</h3>
          <span>{data.analysedUpTo === null ? 'Noch nichts analysiert' : <>Bis <span className="mono">{data.analysedUpTo}</span> analysiert</>}</span>
        </section>
        <section className="card" aria-label="Analysen nach Status">
          <h3>Analysen nach Status</h3>
          <div className="row">
            {statuses.length === 0 ? <Chip>Keine offenen Analysen</Chip> : null}
            {statuses.map((status) => (
              <span key={status} className="row" style={{ gap: 4 }}>
                <StatusChip status={status} />
                <strong>{data.analyses[status]}</strong>
              </span>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Abgeschlossen {data.analyses.complete} · Übersprungen {data.analyses.skipped} · {ANALYSIS_STATUS.not_required.label} {data.analyses.notRequired}
          </div>
        </section>
        <section className="card" aria-label="Zurückgehalten">
          <h3>Zurückgehalten</h3>
          <span>
            {data.withheld.units} Einheit(en), {data.withheld.notes} Notiz(en)
          </span>
        </section>
        <section className="card" aria-label="Notizen heute">
          <h3>Notizen heute</h3>
          <span>{data.notesToday}</span>
        </section>
        <section className="card" aria-label="Zeitplan">
          <h3>Zeitplan</h3>
          <div className="row">
            <Chip>{data.schedule === null ? 'Unbekannt' : (SCHEDULE_STATE[data.schedule.state] ?? data.schedule.state)}</Chip>
            {data.schedule?.nextRun != null ? <span className="muted">Nächster Lauf {data.schedule.nextRun}</span> : null}
            <Button variant="ghost" onClick={() => env.actions.selectPage('schedule')}>
              Zum Zeitplan
            </Button>
          </div>
        </section>
      </div>
      {data.halt === null ? (
        <details className="advanced">
          <summary>Erweitert</summary>
          <p className="muted" style={{ margin: '8px 0' }}>
            Setzt den Ausgangspunkt neu, obwohl die Erfassung nicht angehalten ist. Zwischen dem bisherigen und dem neuen Stand entsteht eine Lücke, die im Journal sichtbar bleibt.
          </p>
          <Button disabled={actionReason(env, 'baseline') !== null} {...(actionReason(env, 'baseline') !== null ? { disabledReason: actionReason(env, 'baseline') as string } : {})} onClick={() => env.actions.openDialog({ kind: 'baseline', force: true })}>
            Trotzdem setzen
          </Button>
        </details>
      ) : null}
      <section aria-label="Letzte Tage">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Letzte Tage</h3>
        {data.recentDays.length === 0 ? (
          <span className="muted">Noch keine Tage mit Daten.</span>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }}>
            {data.recentDays.map((entry) => (
              <li key={entry.day}>
                <button type="button" className="sidebar__link" style={{ width: '100%' }} onClick={() => env.actions.openDay(entry.day)}>
                  <span className={entry.warning ? 'dot dot--warning' : 'dot'} role="img" aria-label={entry.warning ? 'Warnung' : 'Daten vorhanden'} />
                  <span className="mono">{entry.day}</span>
                  {entry.warning ? <span className="muted">Warnung</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
