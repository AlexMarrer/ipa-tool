import { describeRun } from '../../shared/run-texts';
import { Banner, Button, Chip, Dialog } from '../components';
import type { StartResult } from '../store/appStore';

export interface DoctorDialogProps {
  /** `null` while the check runs. */
  outcome: StartResult | null;
  onClose: () => void;
  onAgain: () => void;
  inline?: boolean;
}

/** Result of `doctor`: versions, sign-in method and, if something is missing, the list with the remedy (spec AK-10-49). No model call. */
export function DoctorDialog({ outcome, onClose, onAgain, inline }: DoctorDialogProps) {
  const summary = outcome !== null && outcome.started ? outcome.summary : null;
  const result = summary?.result?.kind === 'doctor' ? summary.result : null;
  const text = summary !== null ? describeRun(summary) : null;

  return (
    <Dialog
      title="Voraussetzungen prüfen"
      wide
      {...(inline === true ? { inline } : {})}
      onClose={onClose}
      onConfirm={onClose}
      footer={
        <>
          <Button disabled={outcome === null} onClick={onAgain}>
            Erneut prüfen
          </Button>
          <Button variant="primary" onClick={onClose}>
            Schliessen
          </Button>
        </>
      }
    >
      {outcome === null ? (
        <p role="status">Die Voraussetzungen werden geprüft. Dabei wird Claude nicht aufgerufen.</p>
      ) : !outcome.started ? (
        <Banner level="info" title="Nicht gestartet">
          {outcome.message}
        </Banner>
      ) : (
        <div className="stack">
          {text !== null ? (
            <div className="row">
              <Chip tone={text.tone === 'err' ? 'err' : text.tone === 'warn' ? 'warn' : 'neutral'}>{text.chip}</Chip>
              <span>{text.text}</span>
            </div>
          ) : null}
          {result !== null ? (
            <>
              <dl className="kv">
                <dt>Git</dt>
                <dd>{result.git.found ? `Version ${result.git.version ?? 'unbekannt'}` : 'nicht gefunden'}</dd>
                <dt>Claude</dt>
                <dd>{result.claude.found ? `Version ${result.claude.version ?? 'unbekannt'}` : 'nicht gefunden'}</dd>
                <dt>Anmeldung</dt>
                <dd>
                  {result.claude.loggedIn === null ? 'nicht geprüft' : result.claude.loggedIn ? 'angemeldet' : 'nicht angemeldet'}
                  {result.claude.authMethod !== null ? `, Art: ${result.claude.authMethod}` : ''}
                </dd>
                <dt>Kostenschutz</dt>
                <dd>
                  {result.billing.detected
                    ? `${result.billing.blocked ? 'Bezahlte Nutzung erkannt und gesperrt' : 'Bezahlte Nutzung erkannt, erlaubt'} (${result.billing.sources.join(', ')})`
                    : 'Keine bezahlte Nutzung erkannt'}
                </dd>
              </dl>
              {result.findings.length > 0 ? (
                <Banner level="warn" title="Das fehlt noch">
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {result.findings.map((finding, position) => (
                      <li key={position}>{finding}</li>
                    ))}
                  </ul>
                </Banner>
              ) : null}
            </>
          ) : text !== null && text.extra.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {text.extra.map((line, position) => (
                <li key={position}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
