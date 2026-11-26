import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConfigFile, ConfigFinding, ConfigView } from '../../../shared/config';
import { describeRun } from '../../../shared/run-texts';
import { Banner, Button, Dialog, LoadingSkeleton } from '../../components';
import { useLoad, usePageEnv } from '../env';
import type { ConfigGroupId } from '../../store/appStore';
import { diffChanges, setPath } from './draft';
import { ConfigClaude, ConfigContext, ConfigCostGuard, ConfigInfo, ConfigLimits, ConfigPathFilter, ConfigScheduleRef, ConfigSecrets, type GroupProps } from './groups';

export type GroupId = ConfigGroupId;

export const GROUPS: { id: GroupId; label: string; mark?: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'cost', label: 'Kostenschutz' },
  { id: 'schedule', label: 'Zeitplan' },
  { id: 'filter', label: 'Dateifilter' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'context', label: 'Kontext' },
  { id: 'limits', label: 'Limits', mark: 'erweitert' },
  { id: 'info', label: 'Info', mark: 'nur lesen' },
];

const COMPONENT: Record<GroupId, (props: GroupProps) => ReactNode> = {
  claude: ConfigClaude,
  cost: ConfigCostGuard,
  schedule: ConfigScheduleRef,
  filter: ConfigPathFilter,
  secrets: ConfigSecrets,
  context: ConfigContext,
  limits: ConfigLimits,
  info: ConfigInfo,
};

export interface SaveBarProps {
  errors: number;
  dirty: boolean;
  busy: boolean;
  runActive: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/** Bottom bar: errors or "Ungespeicherte Änderungen" at the left, "Verwerfen" and "Speichern" at the right (spec §8.11). */
export function SaveBar({ errors, dirty, busy, runActive, onSave, onDiscard }: SaveBarProps) {
  return (
    <div className="savebar" role="region" aria-label="Speichern">
      <span role="status" className={errors > 0 ? 'savebar__text savebar__text--err' : 'savebar__text'}>
        {errors > 0 ? `${errors} Fehler` : dirty ? 'Ungespeicherte Änderungen' : 'Keine Änderungen'}
        <span className="muted"> · Änderungen gelten ab dem nächsten Lauf.{runActive ? ' Ein Lauf ist aktiv. Die Änderung gilt erst für den nächsten Lauf.' : ''}</span>
      </span>
      <Button disabled={!dirty || busy} onClick={onDiscard}>
        Verwerfen
      </Button>
      <Button variant="primary" disabled={!dirty || errors > 0 || busy} {...(errors > 0 ? { disabledReason: 'Speichern gesperrt: Es gibt Fehler.' } : {})} onClick={onSave}>
        Speichern
      </Button>
    </div>
  );
}

export function ConflictDialog({ onReload, onKeep, inline }: { onReload: () => void; onKeep: () => void; inline?: boolean }) {
  return (
    <Dialog title="Die Datei wurde zwischenzeitlich geändert" {...(inline === true ? { inline } : {})} onClose={onKeep} footer={<><Button onClick={onKeep}>Meine Änderungen behalten</Button><Button variant="primary" onClick={onReload}>Neu laden</Button></>}>
      <p style={{ marginTop: 0 }}>
        <span className="mono">config.json</span> wurde ausserhalb der App geändert, während du Änderungen offen hattest. Mit «Neu laden» verwirfst du deine Änderungen, mit «Meine Änderungen behalten» speicherst du sie auf dem neuen Stand der Datei.
      </p>
    </Dialog>
  );
}

/** The configuration of a project in eight groups; `config.json` is written only by `ipa config set` (spec §8.11). */
export function ConfigPage({ initialGroup = 'claude' }: { initialGroup?: GroupId }) {
  const env = usePageEnv();
  const loaded = useLoad(() => env.api.config.read(env.repositoryId), [env.repositoryId]);
  const view: ConfigView | null = loaded.data;

  const [group, setGroup] = useState<GroupId>(initialGroup);
  const [draft, setDraft] = useState<ConfigFile | null>(null);
  const [base, setBase] = useState<ConfigFile | null>(null);
  const signature = useRef<string>('');
  const adoptNext = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<ConfigFinding[]>([]);
  const [saveMessage, setSaveMessage] = useState<{ level: 'info' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [generation, setGeneration] = useState(0);

  const changes = useMemo(() => (draft !== null && base !== null ? diffChanges(base, draft) : []), [draft, base]);
  const dirty = changes.length > 0;

  // The file changed on disk: adopt it quietly, or ask when the user has changes (AK-10-67).
  useEffect(() => {
    if (view === null || view.state !== 'ok' || view.config === null) return;
    if (view.signature === signature.current) return;
    const first = signature.current === '';
    if (first || !dirty || adoptNext.current) {
      adoptNext.current = false;
      signature.current = view.signature;
      setBase(view.config);
      setDraft(view.config);
      // The fields follow the value by themselves; the page is not rebuilt, so nothing the user typed elsewhere is lost.
      setFieldErrors({});
    } else {
      setConflict(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.signature]);

  // Checks the draft with `config set --dry-run` (debounced); the CLI knows the rules (AD-09).
  const counter = useRef(0);
  useEffect(() => {
    if (changes.length === 0) {
      setChecked([]);
      return;
    }
    const mine = ++counter.current;
    const timer = setTimeout(() => {
      void env.api.config.preview(env.repositoryId, changes).then((result) => {
        if (mine === counter.current) setChecked(result.ok ? result.value.findings : []);
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(changes), env.repositoryId]);

  const set = useCallback((path: string, value: unknown) => setDraft((current) => (current === null ? current : setPath(current, path, value))), []);
  const fieldError = useCallback((path: string, message: string | null) => {
    setFieldErrors((current) => {
      if (message === null) {
        if (!(path in current)) return current;
        const { [path]: _removed, ...rest } = current;
        return rest;
      }
      return current[path] === message ? current : { ...current, [path]: message };
    });
  }, []);

  const errorFindings = checked.filter((finding) => finding.severity === 'error');
  const errorCount = Object.keys(fieldErrors).length + errorFindings.length;

  const discard = (): void => {
    setDraft(base);
    setFieldErrors({});
    setChecked([]);
    setSaveMessage(null);
    setGeneration((count) => count + 1);
  };
  const save = async (): Promise<void> => {
    if (draft === null || changes.length === 0 || errorCount > 0) return;
    setBusy(true);
    setSaveMessage(null);
    const result = await env.actions.startRun(env.repositoryId, { name: 'configSet', changes });
    setBusy(false);
    if (!result.started) return setSaveMessage({ level: 'err', text: result.message });
    const { summary } = result;
    if (summary.exitCode === 0) {
      adoptNext.current = true;
      setSaveMessage({ level: 'info', text: 'Gespeichert. Die Änderung gilt ab dem nächsten Lauf.' });
      await env.actions.reload();
      return;
    }
    if (summary.errors.some((error) => error.code === 'config_changed')) return setConflict(true);
    const results = summary.result?.kind === 'config' ? summary.result.findings : [];
    if (results.length > 0) setChecked(results);
    setSaveMessage({ level: 'err', text: [describeRun(summary).text, ...summary.errors.map((error) => error.message)].join(' ') });
  };
  const reloadFromFile = async (): Promise<void> => {
    setConflict(false);
    if (view?.config == null) return;
    signature.current = view.signature;
    setBase(view.config);
    setDraft(view.config);
    setFieldErrors({});
    setChecked([]);
    setGeneration((count) => count + 1);
  };
  const keepMine = (): void => {
    // Mine on top of the new file: the user's own changes are applied to the new content, so only they are saved later.
    setConflict(false);
    if (view?.config == null) return;
    const mine = changes;
    signature.current = view.signature;
    setBase(view.config);
    setDraft(mine.reduce<ConfigFile>((current, change) => setPath(current, change.path, change.value), view.config));
  };

  if (view === null) {
    return loaded.error !== null ? <Banner level="err" title="Die Konfiguration konnte nicht geladen werden" details={`${loaded.error.code}: ${loaded.error.message}`} /> : <LoadingSkeleton loading lines={5} />;
  }
  const openFile = (): void => void env.api.shell.open(env.repositoryId, { kind: 'config' });
  if (view.state !== 'ok' || view.config === null || draft === null || base === null) {
    return (
      <div className="stack">
        <Banner
          level="err"
          title={view.state === 'missing' ? 'config.json fehlt' : view.state === 'newer' ? 'config.json stammt von einer neueren Version' : 'config.json ist nicht gültig'}
          actions={<Button onClick={openFile}>config.json öffnen</Button>}
        >
          {view.state === 'invalid' ? 'Speichern ist gesperrt, bis die Befunde behoben sind. Korrigiere die Datei von Hand; die App lädt sie danach neu.' : 'Die Konfiguration lässt sich nicht lesen. Prüfe die Datei im Arbeitsbereich.'}
        </Banner>
        {view.findings.length > 0 ? (
          <ul className="stack" aria-label="Befunde von config check" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
            {view.findings.map((finding, index) => (
              <li key={index}>
                <Banner level={finding.severity === 'error' ? 'err' : 'warn'}>
                  {finding.path !== '' && finding.path !== '/' ? <span className="mono">{finding.path}: </span> : null}
                  {finding.message}
                </Banner>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const Body = COMPONENT[group] as (props: GroupProps) => ReactNode;
  const props: GroupProps = { env, view, draft, set, findings: checked, fieldError, timezone: draft.timezone };
  return (
    <div className="config-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>Konfiguration</h2>
        <Button onClick={openFile}>config.json öffnen</Button>
      </div>
      <div className="config-layout">
        <nav className="config-nav" aria-label="Gruppen der Konfiguration">
          {GROUPS.map((entry) => (
            <button key={entry.id} type="button" aria-current={entry.id === group ? 'true' : undefined} onClick={() => setGroup(entry.id)}>
              {entry.label}
              {entry.mark !== undefined ? <span className="config-nav__mark">{entry.mark}</span> : null}
            </button>
          ))}
        </nav>
        <div className="config-body" key={`${group}-${generation}`}>
          <Body {...props} />
          {group !== 'cost' && group !== 'info' ? (
            <div className="stack" style={{ marginTop: 12 }}>
              {errorFindings
                .filter((finding) => !isFieldHandled(group, finding))
                .map((finding, index) => (
                  <Banner key={index} level="err">
                    {finding.message}
                  </Banner>
                ))}
            </div>
          ) : null}
        </div>
      </div>
      {saveMessage !== null ? (
        <Banner level={saveMessage.level} {...(saveMessage.level === 'info' ? {} : { title: 'Nicht gespeichert' })}>
          {saveMessage.text}
        </Banner>
      ) : null}
      <SaveBar errors={errorCount} dirty={dirty} busy={busy} runActive={(env.locks?.own.length ?? 0) > 0 || env.locks?.foreign != null} onSave={() => void save()} onDiscard={discard} />
      {conflict ? <ConflictDialog onReload={() => void reloadFromFile()} onKeep={keepMine} /> : null}
    </div>
  );
}

/** Findings that a group shows next to its own fields; the rest appears below the group. */
function isFieldHandled(group: GroupId, finding: ConfigFinding): boolean {
  const path = finding.path.split('/').filter(Boolean).join('.');
  const prefixes: Record<GroupId, string[]> = { claude: ['claude'], cost: [], schedule: [], filter: [], secrets: ['secrets.extraPatterns'], context: [], limits: ['limits'], info: [] };
  return prefixes[group].some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}
