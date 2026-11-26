import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigChange, ConfigPreview, ScheduleConfig } from '../../../shared/config';
import type { RunInput, RunSummary } from '../../../shared/run';
import { describeRun } from '../../../shared/run-texts';
import { SCHEDULE_NOTES } from '../../../shared/schedule-texts';
import { Banner, Button, LoadingSkeleton } from '../../components';
import { actionReason, useLoad, usePageEnv } from '../env';
import { diffChanges, scheduleErrors, toScheduleConfig, same } from '../config/draft';
import { ScheduleForm, type ScheduleDraft } from './ScheduleForm';
import { OutsideWindowDialog, ScheduleDeleteDialog, SchedulePreview, ScheduleRunsTable, ScheduleStatusCard } from './ScheduleParts';
import { describeSchedule } from '../../../shared/run-texts';

const SCHEDULE_PATHS = ['schedule.workdays', 'schedule.windowStart', 'schedule.windowEnd', 'schedule.intervalMinutes', 'schedule.extraRunTimes'];

const draftOf = (schedule: ScheduleConfig): ScheduleDraft => ({
  workdays: [...schedule.workdays],
  windowStart: schedule.windowStart,
  windowEnd: schedule.windowEnd,
  intervalMinutes: String(schedule.intervalMinutes),
  extraRunTimes: [...schedule.extraRunTimes],
});

type Notice = { level: 'info' | 'warn' | 'err'; title: string; text: string; extra: string[] };

function noticeOf(summary: RunSummary): Notice {
  if (summary.exitCode === 0) {
    const result = summary.result;
    const text = result?.kind === 'schedule' ? describeSchedule(result) : describeRun(summary).text;
    return { level: 'info', title: result?.kind === 'schedule' && !result.changed ? 'Schon so' : 'Erledigt', text, extra: summary.warnings };
  }
  const text = describeRun(summary);
  return { level: text.tone === 'err' ? 'err' : 'warn', title: text.title, text: text.text, extra: text.extra };
}

/** The schedule of a project: state of the Windows task, form, preview and run history (spec §8.10). */
export function SchedulePage() {
  const env = usePageEnv();
  const config = useLoad(() => env.api.config.read(env.repositoryId), [env.repositoryId]);
  const status = useLoad(() => env.api.schedule.status(env.repositoryId), [env.repositoryId]);
  const runs = useLoad(() => env.api.schedule.runs(env.repositoryId), [env.repositoryId]);
  const saved = config.data?.config?.schedule ?? null;
  const timezone = config.data?.config?.timezone ?? env.timezone ?? 'UTC';

  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [preview, setPreview] = useState<ConfigPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'remove' | 'outside' | null>(null);
  const baseKey = useRef('');

  // The form follows the saved file, but never overwrites what the user is typing.
  const savedKey = saved === null ? '' : JSON.stringify(saved);
  const dirty = draft !== null && saved !== null && !same(toScheduleConfig(draft), saved);
  useEffect(() => {
    if (saved === null || savedKey === baseKey.current) return;
    if (draft === null || !dirty) setDraft(draftOf(saved));
    baseKey.current = savedKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const errors = useMemo(() => (draft === null ? null : scheduleErrors(draft)), [draft]);
  const draftConfig = draft === null || errors === null || errors.any ? null : toScheduleConfig(draft);
  const draftChanges: ConfigChange[] = useMemo(() => (draftConfig === null ? [] : SCHEDULE_PATHS.map((path) => ({ path, value: path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], { schedule: draftConfig }) }))), [draftConfig]);

  // Debounced preview from `config set --dry-run`; obvious mistakes are caught locally without a call (AK-10-54).
  const counter = useRef(0);
  useEffect(() => {
    if (draftChanges.length === 0) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const mine = ++counter.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void env.api.config.preview(env.repositoryId, draftChanges).then((result) => {
        if (mine !== counter.current) return;
        setPreview(result.ok ? result.value : { valid: null, findings: [], schedulePlan: null, failure: result.error.message });
        setPreviewing(false);
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draftChanges), env.repositoryId]);

  const go = async (input: RunInput): Promise<void> => {
    setBusy(true);
    setNotice(null);
    const result = await env.actions.startRun(env.repositoryId, input);
    setBusy(false);
    setNotice(result.started ? noticeOf(result.summary) : { level: 'info', title: 'Nicht gestartet', text: result.message, extra: [] });
    await env.actions.reload();
  };

  if (config.data === null || status.data === null) {
    const error = config.error ?? status.error;
    return error !== null ? <Banner level="err" title="Der Zeitplan konnte nicht geladen werden" details={`${error.code}: ${error.message}`} /> : <LoadingSkeleton loading lines={5} />;
  }
  if (config.data.state !== 'ok' || saved === null || draft === null || errors === null) {
    return (
      <Banner level="err" title="Die Konfiguration ist nicht lesbar">
        Der Zeitplan braucht eine gültige <span className="mono">config.json</span>. Behebe die Befunde unter Konfiguration.
        <div style={{ marginTop: 6 }}>
          <Button onClick={() => env.actions.selectPage('config')}>Zur Konfiguration</Button>
        </div>
      </Banner>
    );
  }

  const view = status.data;
  const state = view.state;
  const installed = state === 'active' || state === 'paused' || state === 'stale' || state === 'error';
  const formLocked = errors.any ? 'Gesperrt: Das Formular enthält Fehler.' : dirty ? 'Gesperrt: Speichere zuerst die Änderungen am Zeitplan.' : null;
  const runLocked = state === 'paused' || state === 'error' ? 'Gesperrt: Zeitplan fortsetzen' : actionReason(env, 'scheduleRun');
  const platform = view.problem?.kind === 'unsupported';
  const primary = (kind: 'install' | 'update' | 'resume'): 'primary' | 'secondary' =>
    (kind === 'install' && state === 'not_installed') || (kind === 'update' && state === 'stale') || (kind === 'resume' && state === 'paused') ? 'primary' : 'secondary';
  const saveSchedule = async (): Promise<void> => {
    if (draftConfig === null) return;
    const changes = diffChanges({ schedule: saved } as never, { schedule: draftConfig } as never, SCHEDULE_PATHS);
    if (changes.length === 0) return;
    await go({ name: 'configSet', changes });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ScheduleStatusCard status={view} timezone={timezone} />
      {platform ? null : (
        <>
          {notice !== null ? (
            <Banner level={notice.level} title={notice.title} actions={<Button variant="ghost" onClick={() => setNotice(null)}>Schliessen</Button>}>
              {notice.text}
              {notice.extra.map((line, index) => (
                <div key={index} className="muted">
                  {line}
                </div>
              ))}
            </Banner>
          ) : null}
          <div className="row" role="group" aria-label="Aktionen des Zeitplans">
            {state === 'not_installed' ? (
              <Button variant={primary('install')} disabled={busy || formLocked !== null} {...(formLocked !== null ? { disabledReason: formLocked } : {})} onClick={() => void go({ name: 'scheduleInstall' })}>
                Einrichten
              </Button>
            ) : null}
            {state === 'stale' || state === 'error' ? (
              <Button variant={primary('update')} disabled={busy || formLocked !== null} {...(formLocked !== null ? { disabledReason: formLocked } : {})} onClick={() => void go({ name: 'scheduleInstall', update: true })}>
                Aktualisieren
              </Button>
            ) : null}
            {state === 'active' || state === 'stale' ? (
              <Button disabled={busy} onClick={() => void go({ name: 'schedulePause' })}>
                Pausieren
              </Button>
            ) : null}
            {state === 'paused' || state === 'error' ? (
              <Button variant={primary('resume')} disabled={busy} onClick={() => void go({ name: 'scheduleResume' })}>
                Fortsetzen
              </Button>
            ) : null}
            {installed ? (
              <Button ai disabled={busy || runLocked !== null} {...(runLocked !== null ? { disabledReason: runLocked } : {})} onClick={() => (view.insideWindow === false ? setConfirming('outside') : void go({ name: 'scheduleRun' }))}>
                Jetzt auslösen
              </Button>
            ) : null}
            {installed ? (
              <Button variant="danger" disabled={busy} onClick={() => setConfirming('remove')}>
                Löschen
              </Button>
            ) : null}
          </div>
          <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 2 }}>
            {SCHEDULE_NOTES.map((note) => (
              <li key={note} className="muted">
                {note}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="schedule-grid">
        <section className="card" aria-label="Zeitplan bearbeiten">
          <h3>Zeitplan</h3>
          <ScheduleForm draft={draft} errors={errors} timezone={timezone} onChange={setDraft} />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" disabled={!dirty || errors.any || busy} {...(!dirty ? {} : errors.any ? { disabledReason: 'Gesperrt: Das Formular enthält Fehler.' } : {})} onClick={() => void saveSchedule()}>
              Zeitplan speichern
            </Button>
            <Button disabled={!dirty} onClick={() => setDraft(draftOf(saved))}>
              Verwerfen
            </Button>
            {dirty ? <span className="muted">Ungespeicherte Änderungen</span> : null}
          </div>
        </section>
        <SchedulePreview preview={preview} locallyInvalid={errors.any} loading={previewing} />
      </div>

      <ScheduleRunsTable runs={runs.data ?? []} />

      {confirming === 'remove' ? (
        <ScheduleDeleteDialog
          taskName={view.taskName}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void go({ name: 'scheduleRemove' });
          }}
        />
      ) : null}
      {confirming === 'outside' ? (
        <OutsideWindowDialog
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void go({ name: 'scheduleRun' });
          }}
        />
      ) : null}
    </div>
  );
}
