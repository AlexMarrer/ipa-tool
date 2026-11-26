import { useEffect, useState, type ReactNode } from 'react';
import { CLAUDE_DEFAULTS, DETECTOR_INFO, KNOWN_MODELS, LIMIT_DEFAULTS, type ConfigFile, type ConfigFinding, type ConfigView, type LimitsConfig } from '../../../shared/config';
import { describeRun } from '../../../shared/run-texts';
import { SCHEDULE_STATE_TEXT, scheduleSummary, staleMessage } from '../../../shared/schedule-texts';
import { Banner, Button, Chip, Dialog, Field, Icon } from '../../components';
import { useLoad, type PageEnv } from '../env';
import { formatStamp } from '../format';
import { findingsFor, fromBase, integerError, toBase, type LimitUnit } from './draft';

export interface GroupProps {
  env: PageEnv;
  view: ConfigView;
  draft: ConfigFile;
  /** Sets one path of the draft. */
  set: (path: string, value: unknown) => void;
  /** Findings of the last check (`config set --dry-run`) and the field errors found locally. */
  findings: ConfigFinding[];
  /** Registers or clears a field error found locally; a field with an error blocks saving. */
  fieldError: (path: string, message: string | null) => void;
  /** Whether a run is active: the save bar says the change counts from the next run. */
  timezone: string;
}

/** Findings of the CLI for a path as text under the field. */
function fieldFindings(findings: ConfigFinding[], path: string): string | undefined {
  const own = findingsFor(findings, path).filter((finding) => finding.severity === 'error');
  return own.length === 0 ? undefined : own.map((finding) => finding.message).join(' ');
}

export function Findings({ findings, prefixes }: { findings: ConfigFinding[]; prefixes: string[] }) {
  const own = prefixes.flatMap((prefix) => findingsFor(findings, prefix));
  if (own.length === 0) return null;
  return (
    <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }} aria-label="Befunde">
      {own.map((finding, index) => (
        <li key={index}>
          <Banner level={finding.severity === 'error' ? 'err' : 'warn'}>{finding.message}</Banner>
        </li>
      ))}
    </ul>
  );
}

/** A whole number with a label, unit and default; invalid text is an error at the field and blocks saving. */
function NumberField({ path, label, unit, standard, minimum, maximum, value, set, fieldError, findings }: { path: string; label: string; unit?: string; standard?: number; minimum: number; maximum?: number; value: number; set: GroupProps['set']; fieldError: GroupProps['fieldError']; findings: ConfigFinding[] }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const local = integerError(label, text, minimum, maximum);
  const error = local ?? fieldFindings(findings, path);
  return (
    <Field label={unit === undefined ? label : `${label} (${unit})`} {...(error !== undefined ? { error } : standard !== undefined ? { hint: `Standard ${standard}` } : {})}>
      {(control) => (
        <input
          {...control}
          className="input"
          inputMode="numeric"
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const problem = integerError(label, next, minimum, maximum);
            fieldError(path, problem);
            if (problem === null) set(path, Number(next.trim()));
          }}
        />
      )}
    </Field>
  );
}

/** Lists of text entries as chips with a field to add one; locked chips cannot be removed. */
export function ChipEditor({ label, items, onChange, locked = [], addLabel, placeholder, validate }: { label: string; items: string[]; onChange: (next: string[]) => void; locked?: { text: string; tip: string }[]; addLabel: string; placeholder?: string; validate?: (text: string) => string | null }) {
  const [adding, setAdding] = useState('');
  const problem = adding.trim() === '' ? null : (validate?.(adding) ?? null);
  const add = (): void => {
    const next = adding.trim();
    if (next === '' || problem !== null || items.includes(next)) return;
    onChange([...items, next]);
    setAdding('');
  };
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <ul className="chip-list" aria-label={label}>
        {locked.map((entry) => (
          <li key={`l-${entry.text}`}>
            <span className="chip chip--locked" title={entry.tip}>
              <Icon name="bookmark" size={12} />
              <span className="mono">{entry.text}</span>
              <span className="sr-only">: {entry.tip}</span>
            </span>
          </li>
        ))}
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <span className="chip">
              <span className="mono">{item}</span>
              <button type="button" className="chip__remove" aria-label={`${item} entfernen`} onClick={() => onChange(items.filter((_entry, at) => at !== index))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          className="input mono"
          style={{ flex: 1 }}
          aria-label={addLabel}
          placeholder={placeholder}
          value={adding}
          aria-invalid={problem !== null ? true : undefined}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button icon="plus" disabled={adding.trim() === '' || problem !== null} onClick={add}>
          {addLabel}
        </Button>
      </div>
      {problem !== null ? (
        <span className="field__error" role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Claude

export function ConfigClaude({ env, view, draft, set, findings, fieldError, timezone }: GroupProps) {
  const model = draft.claude.model;
  const known = KNOWN_MODELS.find((entry) => entry.id === model);
  const [custom, setCustom] = useState(known === undefined && model !== null ? model : '');
  // "Anderes Modell" stays chosen while its field is still empty.
  const [customChosen, setCustomChosen] = useState(known === undefined && model !== null);
  const selectValue = customChosen ? 'custom' : model === null ? '' : known !== undefined ? known.id : 'custom';
  const check = view.claude;
  const modelError = fieldFindings(findings, 'claude.model');
  return (
    <section className="stack" aria-label="Claude">
      <Field label="Modell" {...(modelError !== undefined ? { error: modelError } : {})}>
        {(control) => (
          <select
            {...control}
            className="input"
            value={selectValue}
            onChange={(event) => {
              const next = event.target.value;
              setCustomChosen(next === 'custom');
              if (next === '') set('claude.model', null);
              else if (next === 'custom') set('claude.model', custom.trim() === '' ? null : custom.trim());
              else set('claude.model', next);
            }}
          >
            <option value="">Standard von Claude Code</option>
            {KNOWN_MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
            <option value="custom">Anderes Modell</option>
          </select>
        )}
      </Field>
      {model === null ? <p className="muted" style={{ margin: 0 }}>Ohne eigene Wahl übergibt das Tool kein Modell, Claude Code nutzt seinen eigenen Standard.</p> : null}
      {known?.large === true ? <p className="muted" style={{ margin: 0 }}>Grössere Modelle verbrauchen in der Regel mehr Kontingent.</p> : null}
      {selectValue === 'custom' ? (
        <Field label="Anderes Modell" hint="Modellname für neue Modelle eingeben">
          {(control) => (
            <input
              {...control}
              className="input mono"
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                set('claude.model', event.target.value.trim() === '' ? null : event.target.value.trim());
              }}
            />
          )}
        </Field>
      ) : null}
      <div className="grid-cards">
        <NumberField path="claude.timeoutSeconds" label="Timeout pro Aufruf" unit="s" standard={CLAUDE_DEFAULTS.timeoutSeconds} minimum={1} value={draft.claude.timeoutSeconds} set={set} fieldError={fieldError} findings={findings} />
        <NumberField path="claude.maxTurns" label="Maximale Gesprächsrunden" standard={CLAUDE_DEFAULTS.maxTurns} minimum={1} value={draft.claude.maxTurns} set={set} fieldError={fieldError} findings={findings} />
        <NumberField path="claude.maxAttemptsPerSnapshot" label="Versuche pro Snapshot" standard={CLAUDE_DEFAULTS.maxAttemptsPerSnapshot} minimum={1} value={draft.claude.maxAttemptsPerSnapshot} set={set} fieldError={fieldError} findings={findings} />
        <NumberField path="claude.maxAnalysesPerRun" label="Analysen pro Lauf" standard={CLAUDE_DEFAULTS.maxAnalysesPerRun} minimum={1} value={draft.claude.maxAnalysesPerRun} set={set} fieldError={fieldError} findings={findings} />
      </div>
      <section className="card" aria-label="Prüfung von Claude">
        <div className="row">
          {check === null ? <Chip>Noch nicht geprüft</Chip> : <Chip tone={check.ok ? 'neutral' : 'warn'}>{check.ok ? 'bereit' : 'nicht bereit'}</Chip>}
          {check !== null ? (
            <span className="muted">
              Letzte Prüfung {formatStamp(check.checkedAt, timezone)}
              {check.version !== null ? ` · Claude Code ${check.version}` : ''}
              {check.authMethod !== null ? ` · Anmeldung über ${check.authMethod}` : ''}
            </span>
          ) : null}
          <Button onClick={() => void env.actions.check(env.repositoryId)}>Prüfen</Button>
        </div>
      </section>
    </section>
  );
}

// ---------------------------------------------------------------- Kostenschutz

const CONFIRM_WORD = 'erlauben';

/** Two steps before the paid use is switched on; only the second step sends `--confirm-paid-usage` (spec §8.11, AK-10-60). */
export function CostGuardConfirm({ onClose, onConfirm, busy, error, inline, initialStep = 1 }: { onClose: () => void; onConfirm: () => void; busy?: boolean; error?: string | null; inline?: boolean; initialStep?: 1 | 2 }) {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');
  const ready = understood && typed.trim().toLowerCase() === CONFIRM_WORD;
  return (
    <Dialog
      title={`Kostenpflichtige Nutzung erlauben? Schritt ${step} von 2`}
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={() => (step === 1 ? setStep(2) : ready && busy !== true ? onConfirm() : undefined)}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          {step === 1 ? (
            <Button variant="primary" onClick={() => setStep(2)}>
              Weiter
            </Button>
          ) : (
            <Button variant="danger" disabled={!ready || busy === true} {...(!ready ? { disabledReason: 'Erst möglich nach Kontrollkästchen und Eingabe.' } : {})} onClick={onConfirm}>
              Kostenpflichtige Nutzung erlauben
            </Button>
          )}
        </>
      }
    >
      {step === 1 ? (
        <p style={{ marginTop: 0 }}>Mit dieser Einstellung darf das Tool Claude auch über kostenpflichtige Wege aufrufen. Jeder Aufruf kann dann Kosten verursachen. Läufe nach Zeitplan zählen dazu.</p>
      ) : (
        <div className="stack">
          <label>
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /> Ich habe verstanden, dass dadurch Kosten entstehen können, die nicht über das Abo gedeckt sind.
          </label>
          <Field label={`Zur Bestätigung «${CONFIRM_WORD}» eintippen`}>{(control) => <input {...control} className="input" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />}</Field>
          {error != null ? <Banner level="err">{error}</Banner> : null}
        </div>
      )}
    </Dialog>
  );
}

export function ConfigCostGuard({ env, draft, set }: GroupProps) {
  const on = draft.claude.allowPaidUsage === true;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ways, setWays] = useState<{ names: string[] } | { problem: string } | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    // The only place that sends the flag: the switch is written at once, apart from the save bar.
    const result = await env.actions.startRun(env.repositoryId, { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: true }], confirmPaidUsage: true });
    setBusy(false);
    if (!result.started) return setError(result.message);
    if (result.summary.exitCode !== 0) return setError([describeRun(result.summary).text, ...result.summary.errors.map((entry) => entry.message)].join(' '));
    setConfirming(false);
    await env.actions.reload();
  };
  const detect = async (): Promise<void> => {
    const result = await env.actions.startRun(env.repositoryId, { name: 'doctor' });
    if (!result.started) return setWays({ problem: result.message });
    const doctor = result.summary.result;
    setWays(doctor?.kind === 'doctor' ? { names: doctor.billing.sources } : { problem: describeRun(result.summary).text });
  };

  return (
    <section className="stack" aria-label="Kostenschutz">
      <p style={{ margin: 0 }}>Standard ist aus: Claude wird nur über das Abo genutzt.</p>
      <section className="card card--danger" aria-label="Gefahrenbereich">
        <h3>Gefahrenbereich</h3>
        <label className="row switch">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            onChange={(event) => {
              if (event.target.checked) setConfirming(true);
              else set('claude.allowPaidUsage', false);
            }}
          />
          <span>
            Kostenpflichtige Nutzung erlauben (<span className="mono">allowPaidUsage</span>) – {on ? 'An' : 'Aus'}
          </span>
        </label>
        {on ? <Banner level="warn">Aufrufe können Kosten verursachen, auch geplante. Zum Ausschalten genügt der Schalter, ohne Bestätigung.</Banner> : null}
      </section>
      <section className="card" aria-label="Erkannte kostenpflichtige Wege">
        <h3>Erkannte kostenpflichtige Wege (nur Namen, nie Werte)</h3>
        {ways === null ? <p className="muted" style={{ margin: 0 }}>Noch nicht geprüft.</p> : 'problem' in ways ? <Banner level="warn">{ways.problem}</Banner> : ways.names.length === 0 ? <p style={{ margin: 0 }}>Kein kostenpflichtiger Weg erkannt.</p> : <ul className="chip-list" aria-label="Erkannte Namen">{ways.names.map((name) => <li key={name}><Chip tone="warn"><span className="mono">{name}</span></Chip></li>)}</ul>}
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void detect()}>Prüfen</Button>
        </div>
      </section>
      {confirming ? <CostGuardConfirm busy={busy} error={error} onClose={() => (setConfirming(false), setError(null))} onConfirm={() => void confirm()} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- Zeitplan

export function ConfigScheduleRef({ env, draft, timezone }: GroupProps) {
  const status = useLoad(() => env.api.schedule.status(env.repositoryId), [env.repositoryId]);
  const [busy, setBusy] = useState(false);
  const plan = status.data?.plan ?? null;
  const state = status.data?.state ?? null;
  const update = async (): Promise<void> => {
    setBusy(true);
    await env.actions.startRun(env.repositoryId, { name: 'scheduleInstall', update: true });
    setBusy(false);
    await env.actions.reload();
  };
  return (
    <section className="stack" aria-label="Zeitplan">
      <p style={{ margin: 0 }}>{scheduleSummary(draft.schedule, draft.timezone || timezone, plan?.maxClaudeCallsPerDay ?? null)}</p>
      {state === 'stale' ? (
        <Banner level="warn" title="Zeitplan nicht mehr aktuell" actions={<Button variant="primary" disabled={busy} onClick={() => void update()}>Aktualisieren</Button>}>
          Die Konfiguration wurde geändert, die Windows-Aufgabe läuft noch mit dem alten Plan. {staleMessage(status.data?.differences ?? [])}
        </Banner>
      ) : state !== null ? (
        <p className="muted" style={{ margin: 0 }}>Aufgabe: {SCHEDULE_STATE_TEXT[state].label}</p>
      ) : null}
      <p style={{ margin: 0 }}>Es gibt nur eine Stelle für den Zeitplan: den Bereich Zeitplan. Dort lässt er sich bearbeiten, einrichten und pausieren.</p>
      <div>
        <Button onClick={() => env.actions.selectPage('schedule')}>Zum Zeitplan</Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Dateifilter

export function ConfigPathFilter({ env, view, draft, set }: GroupProps) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<{ allowed: boolean; rule: string | null } | null>(null);
  const key = JSON.stringify([draft.paths.include, draft.paths.exclude, path]);
  useEffect(() => {
    if (path.trim() === '') {
      setResult(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void env.api.config.testPath(env.repositoryId, { include: draft.paths.include, exclude: draft.paths.exclude, path: path.trim() }).then((answer) => {
        if (live && answer.ok) setResult(answer.value);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const locked = [{ text: '.git', tip: 'Immer ausgeschlossen, nicht änderbar' }, ...(view.workspaceInRepository !== null ? [{ text: view.workspaceInRepository, tip: 'Arbeitsbereich im Repository, immer ausgeschlossen' }] : [])];
  return (
    <section className="stack" aria-label="Dateifilter">
      <ChipEditor label="Einschliessen" items={draft.paths.include} onChange={(next) => set('paths.include', next)} addLabel="+ Muster" placeholder="src/**" />
      <ChipEditor label="Ausschliessen" items={draft.paths.exclude} locked={locked} onChange={(next) => set('paths.exclude', next)} addLabel="+ Muster" placeholder="**/node_modules/**" />
      <p className="muted" style={{ margin: 0 }}>Gesperrte Chips lassen sich nicht entfernen.</p>
      <section className="card" aria-label="Pfad testen">
        <h3>Pfad testen</h3>
        <Field label="Pfad im Repository" hint="Zum Beispiel src/app.ts. Geprüft wird mit den Listen oben, auch ungespeichert.">
          {(control) => <input {...control} className="input mono" value={path} onChange={(event) => setPath(event.target.value)} />}
        </Field>
        {result !== null ? (
          <p role="status" style={{ margin: '8px 0 0' }}>
            {result.allowed ? <Chip>wird erfasst</Chip> : <Chip tone="warn">wird nicht erfasst</Chip>}{' '}
            {result.rule !== null ? (
              <>
                Regel <span className="mono">{result.rule}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </section>
  );
}

// ---------------------------------------------------------------- Secrets

export function patternError(source: string): string | null {
  try {
    new RegExp(source);
    return null;
  } catch (error) {
    return `Kein gültiger regulärer Ausdruck: ${(error as Error).message}`;
  }
}

export function ConfigSecrets({ draft, set, fieldError, findings }: GroupProps) {
  const disabled = draft.secrets.disabledDetectors;
  const [testText, setTestText] = useState('');
  const patterns = draft.secrets.extraPatterns;
  const invalid = patterns.map(patternError);
  useEffect(() => {
    const first = invalid.find((entry) => entry !== null) ?? null;
    fieldError('secrets.extraPatterns', first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(invalid)]);
  const matches = (source: string): boolean | null => {
    if (testText === '' || patternError(source) !== null) return null;
    return new RegExp(source).test(testText);
  };
  return (
    <section className="stack" aria-label="Secrets">
      <p style={{ margin: 0 }}>Treffer werden zurückgehalten, nie angezeigt und nie an Claude gesendet. Angezeigt wird nur der Name des Detektors.</p>
      <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }} aria-label="Detektoren">
        {DETECTOR_INFO.map((detector) => {
          const off = disabled.includes(detector.id);
          return (
            <li key={detector.id}>
              <label className="row switch">
                <input type="checkbox" role="switch" checked={!off} aria-label={`${detector.label} (${detector.id})`} onChange={(event) => set('secrets.disabledDetectors', event.target.checked ? disabled.filter((id) => id !== detector.id) : [...disabled, detector.id])} />
                <span>
                  <strong>{detector.label}</strong> <span className="mono muted">{detector.id}</span>
                  <br />
                  <span className="muted">{detector.text}</span>
                </span>
              </label>
              {off ? <Banner level="warn">Abgeschaltet: Treffer dieses Detektors werden nicht mehr zurückgehalten und können an Claude gehen.</Banner> : null}
            </li>
          );
        })}
      </ul>
      <section className="card" aria-label="Eigene Muster">
        <h3>Eigene Muster</h3>
        <ChipEditor label="Reguläre Ausdrücke" items={patterns} onChange={(next) => set('secrets.extraPatterns', next)} addLabel="Neues Muster (regulärer Ausdruck)" validate={patternError} />
        {invalid.map((problem, index) => (problem === null ? null : <Banner key={index} level="err">«{patterns[index]}»: {problem}</Banner>))}
        <Field label="Testtext" hint="Zeigt nur «Treffer» oder «kein Treffer». Der Text wird nirgends gespeichert.">
          {(control) => <input {...control} className="input" autoComplete="off" value={testText} onChange={(event) => setTestText(event.target.value)} />}
        </Field>
        {testText !== '' && patterns.length > 0 ? (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }} aria-label="Testergebnis">
            {patterns.map((source, index) => (
              <li key={`${source}-${index}`}>
                <span className="mono">{source}</span>: {matches(source) === null ? 'nicht prüfbar' : matches(source) ? 'Treffer' : 'kein Treffer'}
              </li>
            ))}
          </ul>
        ) : null}
        <Findings findings={findings} prefixes={['secrets.extraPatterns']} />
      </section>
    </section>
  );
}

// ---------------------------------------------------------------- Kontext

export function ConfigContext({ env, draft, set, fieldError }: GroupProps) {
  const files = draft.context.files;
  const reports = draft.testReports;
  const emptyReport = reports.some((report) => report.path.trim() === '' || report.label.trim() === '');
  useEffect(() => {
    fieldError('testReports', emptyReport ? 'Testberichte: Pfad und Bezeichnung angeben.' : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyReport]);
  const choose = async (): Promise<void> => {
    const result = await env.api.config.chooseFile(env.repositoryId);
    if (result.ok && result.value.path !== null && !files.includes(result.value.path)) set('context.files', [...files, result.value.path]);
  };
  return (
    <section className="stack" aria-label="Kontext">
      <div className="field">
        <span className="field__label">Kontextdateien</span>
        <p className="muted" style={{ margin: 0 }}>Pfade relativ zur Repository-Wurzel oder absolut. Claude erhält diese Dateien als Hintergrund.</p>
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4 }} aria-label="Kontextdateien">
          {files.map((file, index) => (
            <li key={`${file}-${index}`} className="row">
              <span className="mono" style={{ flex: 1 }}>{file}</span>
              <Button variant="ghost" aria-label={`${file} entfernen`} onClick={() => set('context.files', files.filter((_entry, at) => at !== index))}>
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button icon="folder" onClick={() => void choose()}>
            Datei wählen …
          </Button>
        </div>
      </div>
      <div className="field">
        <span className="field__label">Testberichte</span>
        {reports.map((report, index) => (
          <div key={index} className="row">
            <input className="input mono" style={{ flex: 2 }} aria-label={`Pfad des Testberichts ${index + 1}`} value={report.path} onChange={(event) => set('testReports', reports.map((entry, at) => (at === index ? { ...entry, path: event.target.value } : entry)))} />
            <input className="input" style={{ flex: 1 }} aria-label={`Bezeichnung des Testberichts ${index + 1}`} value={report.label} onChange={(event) => set('testReports', reports.map((entry, at) => (at === index ? { ...entry, label: event.target.value } : entry)))} />
            <Button variant="ghost" aria-label={`Testbericht ${index + 1} entfernen`} onClick={() => set('testReports', reports.filter((_entry, at) => at !== index))}>
              <Icon name="close" />
            </Button>
          </div>
        ))}
        {emptyReport ? <span className="field__error" role="alert">Testberichte: Pfad und Bezeichnung angeben.</span> : null}
        <div>
          <Button icon="plus" onClick={() => set('testReports', [...reports, { path: '', label: '' }])}>
            Testbericht hinzufügen
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Limits

const LIMIT_FIELDS: { key: keyof LimitsConfig; label: string; kind: 'bytes' | 'seconds' | 'ms' | 'count'; minimum: number }[] = [
  { key: 'maxFileBytes', label: 'Grösste Datei', kind: 'bytes', minimum: 1 },
  { key: 'maxSnapshotBytes', label: 'Grösster Snapshot', kind: 'bytes', minimum: 1 },
  { key: 'maxAnalysisInputBytes', label: 'Grösste Analyse-Eingabe', kind: 'bytes', minimum: 1 },
  { key: 'maxJournalInputBytes', label: 'Grösste Journal-Eingabe', kind: 'bytes', minimum: 1 },
  { key: 'maxContextFileBytes', label: 'Grösste Kontextdatei', kind: 'bytes', minimum: 1 },
  { key: 'stabilityRetries', label: 'Wiederholungen bei unruhigem Stand', kind: 'count', minimum: 0 },
  { key: 'stabilityDelayMs', label: 'Wartezeit dazwischen', kind: 'ms', minimum: 0 },
  { key: 'maxRunSeconds', label: 'Höchstdauer eines Laufs', kind: 'seconds', minimum: 1 },
];

function unitOf(kind: (typeof LIMIT_FIELDS)[number]['kind'], value: number): LimitUnit {
  if (kind === 'seconds') return 's';
  if (kind === 'ms') return 'ms';
  if (kind === 'count') return 'x';
  return value >= 1_048_576 && value % 1_048_576 === 0 ? 'MiB' : value >= 1_024 && value % 1_024 === 0 ? 'KiB' : 'B';
}

function LimitField({ field, value, set, fieldError, findings }: { field: (typeof LIMIT_FIELDS)[number]; value: number; set: GroupProps['set']; fieldError: GroupProps['fieldError']; findings: ConfigFinding[] }) {
  const path = `limits.${field.key}`;
  const standard = LIMIT_DEFAULTS[field.key];
  const [unit, setUnit] = useState<LimitUnit>(() => unitOf(field.kind, value));
  const [text, setText] = useState(() => fromBase(value, unitOf(field.kind, value)));
  // A change from outside (reset, reload) shows in the best unit again.
  useEffect(() => {
    if (toBase(text, unit) !== value) {
      const next = unitOf(field.kind, value);
      setUnit(next);
      setText(fromBase(value, next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (nextText: string, nextUnit: LimitUnit): void => {
    const base = toBase(nextText, nextUnit);
    const problem = base === null ? `${field.label}: ganze Zahl in ${nextUnit === 'x' ? 'Stück' : nextUnit}, mindestens ${field.minimum}.` : integerError(field.label, String(base), field.minimum);
    fieldError(path, problem);
    if (problem === null && base !== null) set(path, base);
  };
  const units: LimitUnit[] = field.kind === 'bytes' ? ['B', 'KiB', 'MiB'] : [field.kind === 'seconds' ? 's' : field.kind === 'ms' ? 'ms' : 'x'];
  const error = (toBase(text, unit) === null ? `${field.label}: ganze Zahl, mindestens ${field.minimum}.` : integerError(field.label, String(toBase(text, unit)), field.minimum)) ?? fieldFindings(findings, path);
  return (
    <Field label={field.label} {...(error !== undefined ? { error } : { hint: `Standard ${field.kind === 'bytes' ? formatDefault(standard) : `${standard}${field.kind === 'count' ? '' : ` ${units[0]}`}`}` })}>
      {(control) => (
        <span className="row">
          <input
            {...control}
            className="input"
            inputMode="decimal"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              commit(event.target.value, unit);
            }}
          />
          {units.length > 1 ? (
            <select
              className="input"
              aria-label={`Einheit: ${field.label}`}
              value={unit}
              onChange={(event) => {
                const next = event.target.value as LimitUnit;
                // Keep the stored value: show it in the new unit if that is exact, otherwise keep the number and change the value.
                const base = toBase(text, unit);
                const shown = base === null ? null : base / { B: 1, KiB: 1_024, MiB: 1_048_576, s: 1, ms: 1, x: 1 }[next];
                setUnit(next);
                if (shown !== null && Number.isInteger(shown * 1000)) setText(String(shown));
                else commit(text, next);
              }}
            >
              {units.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted">{units[0] === 'x' ? '' : units[0]}</span>
          )}
          <Button
            variant="ghost"
            disabled={value === standard}
            aria-label={`${field.label} auf Standard zurücksetzen`}
            onClick={() => {
              const next = unitOf(field.kind, standard);
              setUnit(next);
              setText(fromBase(standard, next));
              fieldError(path, null);
              set(path, standard);
            }}
          >
            Auf Standard zurücksetzen
          </Button>
        </span>
      )}
    </Field>
  );
}

function formatDefault(bytes: number): string {
  return bytes >= 1_048_576 && bytes % 1_048_576 === 0 ? `${bytes / 1_048_576} MiB` : bytes >= 1_024 && bytes % 1_024 === 0 ? `${bytes / 1_024} KiB` : `${bytes} B`;
}

export function ConfigLimits({ draft, set, fieldError, findings }: GroupProps) {
  return (
    <section className="stack" aria-label="Limits">
      <p style={{ margin: 0 }}>Grössen- und Wiederholungsgrenzen. Die Standardwerte sind bewusst konservativ.</p>
      {LIMIT_FIELDS.map((field) => (
        <LimitField key={field.key} field={field} value={draft.limits[field.key]} set={set} fieldError={fieldError} findings={findings} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- Info

function InfoRow({ label, value, env }: { label: string; value: string; env: PageEnv }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <dt>{label}</dt>
      <dd className="row">
        <span className="mono" style={{ flex: 1, wordBreak: 'break-all' }}>{value}</span>
        <Button
          variant="ghost"
          aria-label={`${label} kopieren`}
          onClick={() =>
            void env.api.shell.copy(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? 'Kopiert' : 'Kopieren'}
        </Button>
      </dd>
    </>
  );
}

export function ConfigInfo({ env, view, draft }: GroupProps & { children?: ReactNode }) {
  return (
    <section className="stack" aria-label="Info">
      <dl className="kv">
        <InfoRow label="Repository-ID" value={draft.repositoryId} env={env} />
        <InfoRow label="Repository" value={view.repoPath} env={env} />
        <InfoRow label="Arbeitsbereich" value={view.workspacePath} env={env} />
        <InfoRow label="Zeitzone" value={draft.timezone} env={env} />
      </dl>
      <p style={{ margin: 0 }}>Die Zeitzone lässt sich nach der Einrichtung nicht mehr ändern. Sie bestimmt, welchem Tag bestehende Daten zugeordnet sind. Das ist eine Entscheidung der App, keine Regel des Tools.</p>
    </section>
  );
}
