import { useEffect, useMemo, useState } from 'react';
import type { IpaApi } from '../../../shared/ipc';
import type { LockState, RunSummary } from '../../../shared/run';
import { describeRun } from '../../../shared/run-texts';
import type { Project, VersionInfo } from '../../../shared/types';
import type { SystemStatus, UsageRange, UsageRow } from '../../../shared/project';
import { Banner, Button, Chip, ConfirmDialog, LoadingSkeleton, Table, Tooltip, type Column } from '../../components';
import type { AppActions } from '../../store/appStore';
import { lockReason } from '../../store/locks';
import { formatDuration, formatStamp } from '../format';

export type SystemArea = 'claude' | 'git' | 'cost' | 'usage' | 'data' | 'version';
const AREAS: { id: SystemArea; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'git', label: 'Git' },
  { id: 'cost', label: 'Kostenschutz' },
  { id: 'usage', label: 'Verbrauch' },
  { id: 'data', label: 'Daten' },
  { id: 'version', label: 'Version' },
];

const PURPOSE: Record<UsageRow['purpose'], string> = { analysis: 'Analyse', journal: 'Journal', doctor: 'Doctor' };
const OUTCOME: Record<UsageRow['outcome'], { label: string; tone: 'neutral' | 'warn' | 'err' }> = {
  success: { label: 'Erfolg', tone: 'neutral' },
  claude_error: { label: 'Fehler von Claude', tone: 'err' },
  invalid_response: { label: 'Antwort ungültig', tone: 'warn' },
};
const usd = (value: number | null): string => (value === null ? '–' : `${value.toFixed(2)} USD`);

/** Rows grouped by local day, newest day first (spec §8.13). Sums of calls and of known values, never of durations as work time. */
export function groupByDay(rows: readonly UsageRow[]): { day: string; rows: UsageRow[]; calls: number; usd: number | null }[] {
  const days = new Map<string, UsageRow[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => {
      const known = entries.flatMap((entry) => (entry.costUsd === null ? [] : [entry.costUsd]));
      return { day, rows: entries, calls: entries.length, usd: known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) };
    });
}

export function UsageTable({ rows }: { rows: UsageRow[] }) {
  const columns: Column<UsageRow>[] = [
    { key: 'time', header: 'Zeit', render: (row) => row.time },
    { key: 'project', header: 'Projekt', render: (row) => <span className="mono" title={row.repositoryId}>{row.repositoryId.length > 18 ? `${row.repositoryId.slice(0, 15)}…` : row.repositoryId}</span> },
    { key: 'purpose', header: 'Zweck', render: (row) => PURPOSE[row.purpose] },
    { key: 'duration', header: 'Dauer', render: (row) => formatDuration(row.durationMs) },
    { key: 'model', header: 'Modell', render: (row) => (row.models.length === 0 ? '–' : row.models.join(', ')) },
    { key: 'outcome', header: 'Ergebnis', render: (row) => <Chip tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</Chip> },
    { key: 'cost', header: 'Richtwert', render: (row) => usd(row.costUsd) },
  ];
  const days = groupByDay(rows);
  if (days.length === 0) return <p className="muted">Keine Claude-Aufrufe in diesem Zeitraum.</p>;
  return (
    <div className="stack">
      {days.map((entry) => (
        <section key={entry.day} aria-label={`Tag ${entry.day}`} className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: 0 }}>
            {entry.day.slice(8, 10)}.{entry.day.slice(5, 7)}.{entry.day.slice(0, 4)} · {entry.calls} {entry.calls === 1 ? 'Aufruf' : 'Aufrufe'} · Richtwert {usd(entry.usd)}
          </h4>
          <Table caption={`Aufrufe am ${entry.day}`} columns={columns} rows={entry.rows} rowKey={(row) => `${row.repositoryId}:${row.runId}:${row.startedAt}`} />
        </section>
      ))}
    </div>
  );
}

export function LiveTestDialog({ onClose, onConfirm, inline }: { onClose: () => void; onConfirm: () => void; inline?: boolean }) {
  return (
    <ConfirmDialog
      title="Live-Test starten?"
      confirmLabel="Live-Test starten"
      confirmAi
      onClose={onClose}
      onConfirm={onConfirm}
      {...(inline === true ? { inline } : {})}
      secondStep={{ title: 'Live-Test wirklich starten?', acknowledgeLabel: 'Ich weiss, dass dabei zwei Modellaufrufe stattfinden.', confirmLabel: 'Live-Test starten', children: <p style={{ marginTop: 0 }}>Der Test sendet nur einen kurzen Fixtext an das Modell, keine Daten aus deinen Projekten.</p> }}
    >
      <p style={{ marginTop: 0 }}>
        Das ruft das Modell auf: zwei kurze Testaufrufe. Bei einer Anmeldung über Abo wird nichts abgerechnet. Über kostenpflichtige Wege kann ein Aufruf Kosten verursachen. Der Test sendet nur einen kurzen Fixtext, keine Daten aus deinen Projekten.
      </p>
    </ConfirmDialog>
  );
}

export interface SystemPageProps {
  api: IpaApi;
  actions: AppActions;
  projects: Project[];
  selectedId: string | null;
  locks: LockState | undefined;
  /** Counts up when files changed; the page reads again. */
  dataVersion: number;
  initialArea?: SystemArea;
}

/** System: everything that holds for all projects (spec §8.13). */
export function SystemPage({ api, actions, projects, selectedId, locks, dataVersion, initialArea = 'claude' }: SystemPageProps) {
  const [area, setArea] = useState<SystemArea>(initialArea);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [versions, setVersions] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(selectedId ?? projects[0]?.repositoryId ?? null);
  const [last, setLast] = useState<RunSummary | null>(null);
  const [busy, setBusy] = useState<'check' | 'live' | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [range, setRange] = useState<UsageRange>('7');
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([api.system.status(), api.system.versions()]).then(([state, version]) => {
      if (!live) return;
      if (state.ok) setStatus(state.value);
      else setFailed(state.error.message);
      if (version.ok) setVersions(version.value);
    });
    return () => {
      live = false;
    };
  }, [api, dataVersion]);
  useEffect(() => {
    let live = true;
    void api.system.usage(range).then((result) => {
      if (live && result.ok) setUsage(result.value);
    });
    return () => {
      live = false;
    };
  }, [api, range, dataVersion]);
  useEffect(() => {
    if (contextId === null || !projects.some((project) => project.repositoryId === contextId)) setContextId(selectedId ?? projects[0]?.repositoryId ?? null);
  }, [projects, selectedId, contextId]);

  const check = status?.check ?? null;
  const doctor = last?.result?.kind === 'doctor' ? last.result : null;
  const context = projects.find((project) => project.repositoryId === contextId) ?? null;
  const lock = lockReason('capture', locks);
  const ready = (doctor?.ok ?? check?.ok) === true;
  const liveReason = context === null ? 'Erst möglich nach dem Einrichten des ersten Projekts.' : !ready ? 'Erst möglich, wenn Claude bereit ist.' : lock;

  const run = async (kind: 'check' | 'live'): Promise<void> => {
    if (context === null) return;
    setBusy(kind);
    setNote(null);
    const result = await actions.startRun(context.repositoryId, kind === 'live' ? { name: 'doctor', live: true } : { name: 'doctor' });
    setBusy(null);
    if (!result.started) return setNote(result.message);
    setLast(result.summary);
    await actions.reload();
  };

  const problem = useMemo(() => {
    if (check === null) return null;
    if (!check.claude.found) return 'Claude Code wurde nicht gefunden. Installiere Claude Code und prüfe danach erneut.';
    if (check.claude.loggedIn === false) return 'Claude ist nicht angemeldet. Aufnehmen funktioniert weiter, Analysen und Journal mit KI sind gesperrt. Melde dich in Claude Code an und prüfe danach erneut.';
    return check.ok ? null : 'Die Prüfung ist nicht bestanden. Prüfe die Voraussetzungen und starte die Prüfung erneut.';
  }, [check]);

  if (status === null) return failed !== null ? <Banner level="err" title="System konnte nicht geladen werden">{failed}</Banner> : <LoadingSkeleton loading lines={4} />;
  const zone = context?.timezone ?? 'Europe/Zurich';

  return (
    <div className="config-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>System – gilt für alle Projekte</h2>
        {projects.length > 1 ? (
          <label className="row">
            <span className="muted">Prüfen im Projekt</span>
            <select className="input" aria-label="Projekt für die Prüfung" value={contextId ?? ''} onChange={(event) => setContextId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.repositoryId} value={project.repositoryId}>
                  {project.repositoryId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="config-layout">
        <nav className="config-nav" aria-label="Bereiche des Systems">
          {AREAS.map((entry) => (
            <button key={entry.id} type="button" aria-current={entry.id === area ? 'true' : undefined} onClick={() => setArea(entry.id)}>
              {entry.label}
            </button>
          ))}
        </nav>
        <div className="config-body">
          {note !== null ? <Banner level="info" title="Nicht gestartet">{note}</Banner> : null}

          {area === 'claude' ? (
            <section className="stack" aria-label="Claude">
              {check === null && doctor === null ? (
                <Banner level="info" title="Noch nicht geprüft">{projects.length === 0 ? 'Claude wird nach dem Einrichten des ersten Projekts geprüft (init prüft Claude ohne Modellaufruf).' : 'Klicke auf Prüfen, um Version und Anmeldung zu lesen.'}</Banner>
              ) : (
                <div className="row">
                  <Chip tone={ready ? 'neutral' : 'warn'}>{ready ? 'bereit' : 'nicht bereit'}</Chip>
                  <span className="muted">
                    Letzte Prüfung {formatStamp(doctor?.checkedAt ?? check?.checkedAt ?? null, zone)}
                    {(doctor?.claude.version ?? check?.claude.version) != null ? ` · Claude Code ${doctor?.claude.version ?? check?.claude.version}` : ''}
                    {(doctor?.claude.authMethod ?? check?.claude.authMethod) != null ? ` · Anmeldung über ${doctor?.claude.authMethod ?? check?.claude.authMethod}` : ''}
                  </span>
                </div>
              )}
              {problem !== null && !ready ? <Banner level="warn" title="Claude ist nicht bereit">{problem}</Banner> : null}
              {doctor !== null && doctor.findings.length > 0 ? (
                <Banner level="warn" title="Das fehlt noch">
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{doctor.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>
                </Banner>
              ) : null}
              {last !== null && doctor === null ? <Banner level="warn" title={describeRun(last).title}>{describeRun(last).text}</Banner> : null}
              <div className="row">
                <Tooltip text="Prüft Version und Anmeldung. Es wird kein Modell aufgerufen und nichts verbraucht.">
                  <Button disabled={context === null || busy !== null} onClick={() => void run('check')}>
                    {busy === 'check' ? 'Prüft …' : 'Prüfen'}
                  </Button>
                </Tooltip>
                <Button ai disabled={liveReason !== null || busy !== null} {...(liveReason !== null ? { disabledReason: liveReason } : {})} onClick={() => setConfirmLive(true)}>
                  Live-Test
                </Button>
              </div>
              {doctor?.live != null ? <Banner level={doctor.live.ok ? 'info' : 'warn'} title="Live-Test">{doctor.live.ok ? 'Der Live-Test ist bestanden.' : 'Der Live-Test ist nicht bestanden.'}</Banner> : check?.liveCheck != null ? <p className="muted" style={{ margin: 0 }}>Letzter Live-Test: {check.liveCheck.ok ? 'bestanden' : 'nicht bestanden'} ({formatStamp(check.liveCheck.checkedAt, zone)})</p> : null}
              <p className="muted" style={{ margin: 0 }}>Ob es der zugelassene geschäftliche Zugang ist, lässt sich nicht prüfen. Das bleibt deine Verantwortung.</p>
            </section>
          ) : null}

          {area === 'git' ? (
            <section className="stack" aria-label="Git">
              {check === null && doctor === null ? <Banner level="info" title="Noch nicht geprüft">Git wird beim Prüfen gelesen.</Banner> : <p style={{ margin: 0 }}><Chip tone={(doctor?.git.found ?? check?.git.found) === true ? 'neutral' : 'err'}>{(doctor?.git.found ?? check?.git.found) === true ? 'Gefunden' : 'Nicht gefunden'}</Chip> {(doctor?.git.version ?? check?.git.version) != null ? `git ${doctor?.git.version ?? check?.git.version}` : ''}</p>}
              <p style={{ margin: 0 }}>Das Tool braucht Git, um Zustandsänderungen und Commit-Nachrichten zu lesen. Es verändert Repositorys nie.</p>
              <div>
                <Button disabled={context === null || busy !== null} onClick={() => void run('check')}>
                  Prüfen
                </Button>
              </div>
            </section>
          ) : null}

          {area === 'cost' ? (
            <section className="stack" aria-label="Kostenschutz">
              {doctor === null ? (
                <Banner level="info" title="Noch nicht geprüft">Bei Claude auf «Prüfen» klicken. Geprüft werden die Umgebungsvariablen und die Anmeldeart. Werte werden nie angezeigt, nur Namen.</Banner>
              ) : !doctor.billing.detected ? (
                <Banner level="info" title="Kein kostenpflichtiger Weg erkannt">Claude wird nur über das Abo genutzt. Geprüft werden die Umgebungsvariablen und die Anmeldeart. Werte werden nie angezeigt, nur Namen.</Banner>
              ) : (
                <Banner level="warn" title="Kostenpflichtiger Weg erkannt">
                  Erkannte Umgebungsvariablen (nur Namen, nie Werte):{' '}
                  <ul className="chip-list" aria-label="Erkannte Namen">{doctor.billing.sources.map((name) => <li key={name}><Chip tone="warn"><span className="mono">{name}</span></Chip></li>)}</ul>
                  <p style={{ margin: '6px 0' }}>Claude Code kann über diese Variablen pro Aufruf abrechnen. Solange «Kostenpflichtige Nutzung erlauben» ausgeschaltet ist, ruft das Tool Claude nicht auf.</p>
                  <p style={{ margin: '6px 0' }}><strong>Variablen entfernen.</strong> Lösche sie in den Windows-Umgebungsvariablen und starte das Tool neu. Danach unter Claude auf «Prüfen» klicken.</p>
                  <p style={{ margin: '6px 0' }}><strong>Oder bewusst erlauben.</strong> Kostenschutz, mit zweistufiger Bestätigung.</p>
                  <Button disabled={context === null} onClick={() => { if (context !== null) { actions.selectProject(context.repositoryId); actions.openConfig('cost'); } }}>
                    Kostenschutz in der Konfiguration öffnen
                  </Button>
                </Banner>
              )}
            </section>
          ) : null}

          {area === 'usage' ? (
            <section className="stack" aria-label="Verbrauch">
              <p style={{ margin: 0 }}>Claude-Aufrufe pro Tag und Projekt. Die Richtwerte in USD sind geschätzt. Bei einer Anmeldung über Abo wird nichts abgerechnet.</p>
              <div className="row" role="group" aria-label="Zeitraum">
                {([['7', '7 Tage'], ['30', '30 Tage'], ['all', 'Alle']] as const).map(([id, label]) => (
                  <button key={id} type="button" className="day-chip" aria-pressed={range === id} onClick={() => setRange(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {usage === null ? <LoadingSkeleton loading lines={3} /> : <UsageTable rows={usage} />}
              <p className="muted" style={{ margin: 0 }}>Ein Richtwert ist keine Rechnung. Bei einer Anmeldung über Abo wird nichts abgerechnet, der Richtwert zeigt dann nur den Umfang.</p>
            </section>
          ) : null}

          {area === 'data' ? (
            <section className="stack" aria-label="Daten">
              <p style={{ margin: 0 }}>Datenwurzel <span className="mono">{status.dataRoot ?? 'unbekannt'}</span></p>
              <div className="row">
                <Button onClick={() => void api.system.openDataRoot().then((result) => setNote(result.ok && result.value.opened ? null : 'Der Ordner liess sich nicht öffnen.'))}>Ordner öffnen</Button>
                <Button onClick={() => void api.system.copyDataRoot().then((result) => setNote(result.ok && result.value.copied ? 'Pfad kopiert.' : 'Der Pfad liess sich nicht kopieren.'))}>Pfad kopieren</Button>
              </div>
              <p style={{ margin: 0 }}>Hier liegen die Konfiguration, die Arbeitsbereiche, die Snapshots und die Journal-Entwürfe aller Projekte.</p>
              <Banner level="warn" title="Das Tool sichert nichts.">Wenn du die Daten behalten willst, sichere diesen Ordner selbst, zum Beispiel mit deiner üblichen Datensicherung.</Banner>
              {status.workspacesInRepository.length > 0 ? <p style={{ margin: 0 }}>Diese Projekte haben ihren Arbeitsbereich im Repository (<span className="mono">.ipa</span>) und brauchen dort ihre eigene Sicherung: {status.workspacesInRepository.join(', ')}.</p> : null}
            </section>
          ) : null}

          {area === 'version' ? (
            <section className="stack" aria-label="Version">
              <dl className="kv">
                <dt>App</dt>
                <dd>IPA Assistant {versions?.app ?? 'unbekannt'}</dd>
                <dt>CLI</dt>
                <dd>ipa {versions?.cli ?? 'unbekannt'}</dd>
                <dt>Node (mitgeliefert)</dt>
                <dd>{versions?.node ?? 'unbekannt'}</dd>
                <dt>Electron</dt>
                <dd>{versions?.electron ?? 'unbekannt'}</dd>
              </dl>
              {versions?.runtimeProblem != null ? <Banner level="err" title="Laufzeit des CLI">{versions.runtimeProblem}</Banner> : null}
              <div>
                <Button onClick={() => void api.shell.copy([`App IPA Assistant ${versions?.app ?? '?'}`, `CLI ipa ${versions?.cli ?? '?'}`, `Node ${versions?.node ?? '?'}`, `Electron ${versions?.electron ?? '?'}`].join('\n')).then(() => setNote('Angaben kopiert.'))}>Kopieren</Button>
              </div>
              <p className="muted" style={{ margin: 0 }}>Gib diese Angaben an, wenn du einen Fehler meldest.</p>
            </section>
          ) : null}
        </div>
      </div>
      {confirmLive ? (
        <LiveTestDialog
          onClose={() => setConfirmLive(false)}
          onConfirm={() => {
            setConfirmLive(false);
            void run('live');
          }}
        />
      ) : null}
    </div>
  );
}
