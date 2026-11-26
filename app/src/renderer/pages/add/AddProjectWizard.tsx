import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IpaApi } from '../../../shared/ipc';
import type { InitOutcome, ProjectCheck } from '../../../shared/project';
import { Banner, Button, Chip, Field } from '../../components';
import type { AppActions } from '../../store/appStore';
import { formatStamp } from '../format';

export const DEFAULT_TIMEZONE = 'Europe/Zurich';
const STEPS = ['Ordner wählen', 'Einstellungen', 'Bestätigen', 'Ergebnis'] as const;

/** Names of all IANA zones the runtime knows; the default is always part of the list. */
export function allTimeZones(): string[] {
  const names = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return names.includes(DEFAULT_TIMEZONE) ? names : [DEFAULT_TIMEZONE, ...names];
}

type Mark = 'ok' | 'error' | 'open';
function Row({ label, value, mark }: { label: string; value: ReactNode; mark: Mark }) {
  return (
    <li className="check-row">
      <span className="check-row__label">{label}</span>
      <span className="check-row__value">{value}</span>
      <Chip tone={mark === 'ok' ? 'neutral' : mark === 'error' ? 'err' : 'warn'} icon={mark === 'ok' ? 'check' : 'warning'}>
        {mark === 'ok' ? 'In Ordnung' : mark === 'error' ? 'Fehler' : 'Offen'}
      </Chip>
    </li>
  );
}

const short = (head: string | null): string => (head === null ? 'nicht gefunden' : head.slice(0, 7));

/** What step 1 shows: the checklist and, for each failure, the text with the way out (spec §8.12). */
export function ProjectChecklist({ check, projectName, onSwitch, onRecheck, onOpenDataRoot }: { check: ProjectCheck; projectName?: (id: string) => string; onSwitch?: (id: string) => void; onRecheck?: () => void; onOpenDataRoot?: () => void }) {
  const repo = check.repository;
  const claude = check.claude;
  return (
    <div className="stack">
      <p className="mono" style={{ margin: 0 }}>
        {check.repoPath}
      </p>
      <ul className="check-list" aria-label="Prüfung des Ordners">
        <Row label="Datenwurzel" mark={check.dataRoot.writable ? 'ok' : 'error'} value={check.dataRoot.writable ? <>Beschreibbar · <span className="mono">{check.dataRoot.path}</span></> : (check.dataRoot.detail ?? 'Nicht beschreibbar')} />
        <Row label="Git-Repository" mark={repo.isMainFolder ? 'ok' : 'error'} value={repo.isMainFolder ? <>Ja · Branch <span className="mono">{repo.branch ?? 'unbekannt'}</span> · HEAD <span className="mono">{short(repo.head)}</span></> : 'Nein'} />
        <Row label="Schon eingerichtet" mark={check.existing === null ? 'ok' : 'error'} value={check.existing === null ? 'Nein' : <>Ja, als <span className="mono">{check.existing.repositoryId}</span></>} />
        <Row label="Git-Version" mark={check.gitVersion !== null ? 'ok' : 'error'} value={check.gitVersion !== null ? `git ${check.gitVersion}` : 'Git wurde nicht gefunden'} />
        <Row
          label="Claude"
          mark={claude === null ? 'open' : claude.ok ? 'ok' : 'open'}
          value={claude === null ? 'Wird nach dem Einrichten geprüft (init prüft Claude ohne Modellaufruf)' : claude.ok ? `Bereit${claude.version !== null ? ` · Claude Code ${claude.version}` : ''}${claude.authMethod !== null ? ` · Anmeldung über ${claude.authMethod}` : ''}` : `Nicht bereit · letzte Prüfung ${formatStamp(claude.checkedAt, 'Europe/Zurich')}`}
        />
      </ul>
      {!repo.isMainFolder ? (
        <Banner level="err" title="Dieser Ordner ist kein Git-Repository">
          Wähle den Hauptordner des Repositorys, also den Ordner, der <span className="mono">.git</span> enthält.
          {repo.insideRepository ? ' Dieser Ordner liegt in einem Repository, ist aber nicht dessen Hauptordner.' : ''}
        </Banner>
      ) : null}
      {check.existing !== null ? (
        <Banner
          level="err"
          title="Dieses Repository ist bereits eingerichtet"
          actions={onSwitch !== undefined ? <Button onClick={() => onSwitch((check.existing as { repositoryId: string }).repositoryId)}>Zu {projectName?.(check.existing.repositoryId) ?? check.existing.repositoryId} wechseln</Button> : undefined}
        >
          Ein Repository lässt sich nur einmal hinzufügen. Wechsle zum bestehenden Projekt.
        </Banner>
      ) : null}
      {!check.dataRoot.writable ? (
        <Banner
          level="err"
          title="Das Tool kann in der Datenwurzel nichts speichern"
          actions={
            <>
              <Button onClick={onRecheck}>Erneut prüfen</Button> <Button onClick={onOpenDataRoot}>Ordner öffnen</Button>
            </>
          }
        >
          Prüfe die Schreibrechte dieses Ordners und starte die Prüfung danach neu. Mit <span className="mono">--data-dir</span>, <span className="mono">IPA_ASSISTANT_HOME</span> oder <span className="mono">--workspace</span> lässt sich im CLI ein anderer Ort wählen.
        </Banner>
      ) : null}
      {check.gitVersion === null ? <Banner level="err" title="Git wurde nicht gefunden">Das Tool braucht Git, um Zustandsänderungen und Commit-Nachrichten zu lesen. Installiere Git und prüfe erneut.</Banner> : null}
    </div>
  );
}

export function canContinue(check: ProjectCheck | null): boolean {
  return check !== null && check.repository.isMainFolder && check.existing === null && check.dataRoot.writable && check.gitVersion !== null;
}

export interface WizardProps {
  api: IpaApi;
  actions: AppActions;
  projectName?: (id: string) => string;
}

/** "Projekt hinzufügen" in four steps; it sets up exactly the folder chosen in the system dialog (spec §8.12). */
export function AddProjectWizard({ api, actions, projectName }: WizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [check, setCheck] = useState<ProjectCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [search, setSearch] = useState('');
  const [workspace, setWorkspace] = useState<'default' | 'repository'>('default');
  const [outcome, setOutcome] = useState<InitOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const zones = useMemo(allTimeZones, []);
  const shown = useMemo(() => zones.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase())), [zones, search]);

  useEffect(() => {
    if (!shown.includes(timezone) && search.trim() === '') setTimezone(DEFAULT_TIMEZONE);
  }, [shown, timezone, search]);

  const recheck = async (): Promise<void> => {
    setBusy(true);
    const result = await api.project.check();
    setBusy(false);
    if (result.ok) setCheck(result.value);
    else setProblem(result.error.message);
  };
  const choose = async (): Promise<void> => {
    setProblem(null);
    const chosen = await api.project.chooseFolder();
    if (!chosen.ok) return setProblem(chosen.error.message);
    if (chosen.value.path !== null) await recheck();
  };
  const setUp = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const result = await api.project.init({ timezone, workspace });
    setBusy(false);
    if (!result.ok) return setProblem(result.error.message);
    setOutcome(result.value);
    setStep(4);
    if (result.value.exitCode === 0) await actions.reload();
  };
  const openProject = (id: string, page: 'overview' | 'schedule' = 'overview'): void => {
    actions.selectProject(id);
    actions.selectPage(page);
  };

  const ok = canContinue(check);
  const created = outcome?.result ?? null;
  return (
    <div className="wizard stack" style={{ maxWidth: 760 }}>
      <header>
        <h2 style={{ fontSize: 17, margin: 0 }}>Projekt hinzufügen</h2>
        <p className="muted" style={{ margin: '2px 0 0' }} aria-live="polite">
          Schritt {step} von 4: {STEPS[step - 1]}
        </p>
      </header>

      {step === 1 ? (
        <section className="stack" aria-label="Ordner wählen">
          <p style={{ margin: 0 }}>Wähle den Hauptordner des Git-Repositorys, das du begleiten willst. Das Tool liest nur und verändert das Repository nie.</p>
          <div>
            <Button variant="primary" icon="folder" disabled={busy} onClick={() => void choose()}>
              Ordner wählen …
            </Button>
          </div>
          {check !== null ? (
            <ProjectChecklist check={check} {...(projectName !== undefined ? { projectName } : {})} onSwitch={(id) => openProject(id)} onRecheck={() => void recheck()} onOpenDataRoot={() => void api.system.openDataRoot()} />
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="stack" aria-label="Einstellungen">
          <Field label="Zeitzone des Projekts" hint="Die Zeitzone bestimmt, welchem Tag ein Snapshot zugeordnet wird, und gilt für Zeitfenster und Zeitplan.">
            {(control) => <input {...control} className="input" type="search" placeholder="Zeitzone suchen, zum Beispiel Europe oder Zurich" value={search} onChange={(event) => setSearch(event.target.value)} />}
          </Field>
          {shown.length === 0 ? (
            <p role="status" className="muted" style={{ margin: 0 }}>
              Keine Zeitzone gefunden. Versuche einen anderen Suchbegriff.
            </p>
          ) : (
            <select className="input" size={6} aria-label="Zeitzonen" value={shown.includes(timezone) ? timezone : ''} onChange={(event) => setTimezone(event.target.value)}>
              {shown.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <p style={{ margin: 0 }}>
            Gewählt: <strong className="mono">{timezone}</strong>
          </p>
          <fieldset className="schedule-field" aria-label="Arbeitsbereich">
            <legend>Arbeitsbereich</legend>
            <label>
              <input type="radio" name="workspace" checked={workspace === 'default'} onChange={() => setWorkspace('default')} /> Standard (empfohlen): in der Datenwurzel des Tools, ausserhalb des Repositorys. Das Repository bleibt unberührt.
            </label>
            <label>
              <input type="radio" name="workspace" checked={workspace === 'repository'} onChange={() => setWorkspace('repository')} /> Im Repository (<span className="mono">.ipa</span>)
            </label>
            {workspace === 'repository' ? (
              <Banner
                level="warn"
                actions={
                  <Button
                    onClick={() =>
                      void api.shell.copy('.ipa/').then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    {copied ? 'Kopiert' : 'Kopieren'}
                  </Button>
                }
              >
                Trage <span className="mono">.ipa/</span> in <span className="mono">.gitignore</span> ein. Sonst erscheint der Arbeitsbereich im Repository als Änderung. Das Tool ändert die Datei <span className="mono">.gitignore</span> nicht selbst.
              </Banner>
            ) : null}
          </fieldset>
        </section>
      ) : null}

      {step === 3 && check !== null ? (
        <section className="stack" aria-label="Bestätigen">
          <dl className="kv">
            <dt>Ordner</dt>
            <dd className="mono">{check.repoPath}</dd>
            <dt>Branch und HEAD</dt>
            <dd>
              <span className="mono">{check.repository.branch ?? 'unbekannt'}</span> · <span className="mono">{short(check.repository.head)}</span>
            </dd>
            <dt>Zeitzone</dt>
            <dd className="mono">{timezone}</dd>
            <dt>Arbeitsbereich</dt>
            <dd>{workspace === 'default' ? <>Standard in der Datenwurzel (<span className="mono">{check.dataRoot.path}</span>)</> : <>Im Repository (<span className="mono">.ipa</span>)</>}</dd>
            <dt>Ausgangs-Snapshot</dt>
            <dd>S000001 · Ausgangslage, zählt nicht als Arbeit</dd>
          </dl>
          <p style={{ margin: 0 }}>Der Ausgangs-Snapshot gilt nie als Arbeit. Beim Einrichten hält das Tool den heutigen Stand als Snapshot S000001 (Ausgangslage) fest. Als Arbeit zählt erst, was sich danach ändert.</p>
          <p className="muted" style={{ margin: 0 }}>Das Repository selbst wird nicht verändert.</p>
        </section>
      ) : null}

      {step === 4 && outcome !== null ? (
        <section className="stack" aria-label="Ergebnis">
          {created !== null && outcome.exitCode === 0 ? (
            <>
              <Banner level="info" title="Projekt eingerichtet">
                {created.created ? 'Das Projekt ist eingerichtet und erscheint in der Seitenleiste.' : 'Das Projekt war schon vorhanden und wurde übernommen.'}
              </Banner>
              <dl className="kv">
                <dt>Repository-ID</dt>
                <dd className="mono">{created.repositoryId}</dd>
                <dt>Arbeitsbereich</dt>
                <dd className="mono">{created.workspacePath}</dd>
                <dt>Zeitzone</dt>
                <dd className="mono">{created.timezone}</dd>
                <dt>Ausgangs-Snapshot</dt>
                <dd>{created.baselineSnapshotId ?? 'keiner'} · Ausgangslage</dd>
              </dl>
              {created.claude.ok === true ? (
                <p style={{ margin: 0 }}>
                  <Chip>Bereit</Chip> {created.claude.cliVersion !== null ? `Claude Code ${created.claude.cliVersion}` : 'Claude ist bereit'}
                </p>
              ) : (
                <Banner level="warn" title="Claude ist nicht bereit" actions={<Button onClick={() => actions.selectPage('system')}>System öffnen</Button>}>
                  {created.claude.problems ?? 'Claude wurde nicht geprüft.'} Der Arbeitsbereich ist in beiden Fällen vollständig.
                </Banner>
              )}
              <section className="card" aria-label="Zeitplan">
                <h3>Zeitplan einrichten?</h3>
                <p style={{ margin: '0 0 8px' }}>Ein Zeitplan lässt das Tool regelmässig erfassen und analysieren, auch wenn die App geschlossen ist. Du kannst ihn jederzeit unter Zeitplan einrichten.</p>
                <div className="row">
                  <Button onClick={() => openProject(created.repositoryId, 'schedule')}>Zeitplan einrichten</Button>
                  <Button variant="ghost" onClick={() => openProject(created.repositoryId)}>
                    Später
                  </Button>
                </div>
              </section>
            </>
          ) : (
            <Banner level="err" title="Das Projekt wurde nicht eingerichtet">
              {outcome.errors.length > 0 ? outcome.errors.map((error) => error.message).join(' ') : (outcome.failure?.message ?? 'Das CLI hat keine Antwort geliefert.')}
              {outcome.warnings.map((warning, index) => (
                <div key={index} className="muted">
                  {warning}
                </div>
              ))}
            </Banner>
          )}
        </section>
      ) : null}

      {problem !== null ? (
        <Banner level="err" title="Das ging nicht">
          {problem}
        </Banner>
      ) : null}

      <footer className="row wizard__footer" style={{ justifyContent: 'flex-end' }}>
        {step === 4 ? (
          created !== null && outcome?.exitCode === 0 ? (
            <Button variant="primary" onClick={() => openProject(created.repositoryId)}>
              Zum Projekt
            </Button>
          ) : (
            <>
              <Button onClick={() => setStep(3)}>Zurück</Button>
              <Button onClick={() => actions.selectPage('overview')}>Schliessen</Button>
            </>
          )
        ) : (
          <>
            <span className="dialog__hint" role={step === 1 && !ok && check !== null ? 'status' : undefined}>
              {step === 1 && check !== null && !ok ? 'Weiter gesperrt: Die Prüfung ist nicht bestanden.' : step === 3 ? 'Das Repository selbst wird nicht verändert.' : ''}
            </span>
            <Button onClick={() => actions.selectPage('overview')}>Abbrechen</Button>
            {step > 1 ? <Button onClick={() => setStep((step - 1) as 1 | 2 | 3)}>Zurück</Button> : null}
            {step < 3 ? (
              <Button variant="primary" disabled={step === 1 && !ok} onClick={() => setStep((step + 1) as 2 | 3)}>
                Weiter
              </Button>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void setUp()}>
                {busy ? 'Richtet ein …' : 'Projekt einrichten'}
              </Button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
