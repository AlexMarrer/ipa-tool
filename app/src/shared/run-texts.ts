import { APP_ERROR_MESSAGES, EXIT_CODE_MESSAGES, type AppErrorCode } from './messages';
import type { RunResultView, RunSummary } from './run';

/** Klartext of a finished run (app spec §8.7, §9.1). Every exit code has a text with the next step; unknown ones are never guessed. */
export interface RunText {
  title: string;
  /** Short chip text. */
  chip: string;
  tone: 'neutral' | 'warn' | 'err';
  /** One or two sentences. */
  text: string;
  /** Further lines: the result in words, warnings. */
  extra: string[];
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function successText(result: RunResultView | null): { text: string; tone: RunText['tone']; chip: string } {
  if (result === null) return { text: 'Der Befehl wurde ausgeführt.', tone: 'neutral', chip: 'Erfolg' };
  switch (result.kind) {
    case 'capture': {
      if (result.outsideWindow) return { text: 'Ausserhalb des Zeitfensters, nichts aufgenommen.', tone: 'neutral', chip: 'Erfolg' };
      if (result.retry !== null) {
        const done = result.analysis?.completed.find((entry) => entry.snapshotId === result.retry?.snapshotId);
        return {
          text: done !== undefined ? `Die Analyse von ${result.retry.snapshotId} ist abgeschlossen (Versuch ${result.retry.afterAttempt + 1}).` : `Der Versuch für ${result.retry.snapshotId} ist beendet.`,
          tone: 'neutral',
          chip: 'Erfolg',
        };
      }
      if (result.capture === 'unchanged') {
        // Open analyses may still have been completed in this run; deterministic ones (no Claude) are not worth naming.
        const analysed = (result.analysis?.completed ?? []).filter((entry) => entry.mode === 'ai').map((entry) => entry.snapshotId);
        const text = analysed.length > 0 ? `Keine neue Arbeit. Die Analyse von ${analysed.join(', ')} wurde abgeschlossen.` : 'Keine neue Arbeit.';
        return { text, tone: 'neutral', chip: 'Keine neue Arbeit' };
      }
      if (result.snapshot !== null) {
        const id = result.snapshot.id;
        if (result.analysis === null) return { text: `Snapshot ${id} gespeichert. Analyse nicht ausgeführt (Nur aufnehmen).`, tone: 'neutral', chip: 'Erfolg' };
        const own = result.analysis.completed.some((entry) => entry.snapshotId === id);
        return { text: own ? `Snapshot ${id} gespeichert und analysiert. Die Analyse ist abgeschlossen.` : `Snapshot ${id} gespeichert.`, tone: 'neutral', chip: 'Erfolg' };
      }
      return { text: 'Der Lauf ist beendet.', tone: 'neutral', chip: 'Erfolg' };
    }
    case 'journal':
      if (result.mode === null) return { text: `Für ${result.day} gab es nichts zu schreiben.`, tone: 'neutral', chip: 'Erfolg' };
      return { text: `Journal-Entwurf für ${result.day} gespeichert (${result.mode === 'ai' ? 'KI-Entwurf' : 'ohne KI'}).`, tone: 'neutral', chip: 'Erfolg' };
    case 'note':
      return { text: 'Notiz gespeichert.', tone: 'neutral', chip: 'Erfolg' };
    case 'skip':
      return { text: `${result.snapshotId} übersprungen.`, tone: 'neutral', chip: 'Erfolg' };
    case 'baseline':
      return { text: `Neuer Ausgangspunkt ${result.snapshotId} gesetzt.`, tone: 'neutral', chip: 'Erfolg' };
    case 'doctor':
      return { text: 'Die Voraussetzungen sind erfüllt.', tone: 'neutral', chip: 'Erfolg' };
  }
}

/** Title of a running command in plain words (spec §8.7); unknown labels fall back to "Lauf läuft". */
export function runningTitle(label: string): string {
  switch (label) {
    case 'capture':
      return 'Erfasse Snapshot und analysiere …';
    case 'capture --no-analysis':
      return 'Erfasse Snapshot …';
    case 'capture --retry':
      return 'Versuche die Analyse erneut …';
    case 'journal':
      return 'Erzeuge Journal-Entwurf …';
    case 'journal --no-ai':
      return 'Erzeuge Journal-Entwurf ohne KI …';
    default:
      return 'Lauf läuft';
  }
}

/** Texts of a run result. Messages of the CLI (`errors[].message`) are German and free of repository contents (I-12). */
export function describeRun(summary: RunSummary): RunText {
  const extra = [...summary.warnings];
  if (summary.cancelled) {
    return { title: 'Lauf abgebrochen', chip: 'Abgebrochen', tone: 'neutral', text: 'Der nächste Lauf setzt sauber fort.', extra };
  }
  if (summary.failure !== null) {
    const known = summary.failure.code in APP_ERROR_MESSAGES ? APP_ERROR_MESSAGES[summary.failure.code as AppErrorCode] : summary.failure.message;
    return { title: 'Der Befehl konnte nicht ausgeführt werden', chip: 'Fehler', tone: 'err', text: known, extra };
  }
  const code = summary.exitCode;
  if (code === null) return { title: 'Lauf beendet', chip: 'Unbekannt', tone: 'warn', text: 'Der Prozess endete ohne Exit-Code.', extra };

  if (code === 0) {
    const ok = successText(summary.result);
    const title = summary.result?.kind === 'capture' && summary.result.capture === 'unchanged' ? 'Keine neue Arbeit' : 'Lauf beendet';
    return { title, chip: ok.chip, tone: ok.tone, text: ok.text, extra };
  }

  const known = EXIT_CODE_MESSAGES[code];
  const messages = summary.errors.map((error) => error.message).filter((message) => message !== '');

  if (code === 3) {
    const since = summary.lock !== null ? [`Aktiv seit ${summary.lock.startedAt}`] : [];
    return { title: 'Ein anderer Lauf ist aktiv', chip: 'Nicht gestartet', tone: 'neutral', text: known?.text ?? '', extra: [...since, ...extra] };
  }
  if (code === 6) {
    const result = summary.result;
    if (result?.kind === 'journal') {
      return { title: 'KI-Schritt nicht abgeschlossen', chip: 'KI-Schritt nicht abgeschlossen', tone: 'warn', text: 'Es wurde kein neuer Entwurf geschrieben. Ein früherer Entwurf bleibt unverändert erreichbar. Du kannst es erneut versuchen oder das Journal ohne KI erzeugen.', extra: [...messages, ...extra] };
    }
    const failed = result?.kind === 'capture' ? result.analysis?.failed[0] : undefined;
    const lead = result?.kind === 'capture' && result.snapshot !== null ? `Snapshot ${result.snapshot.id} ist gespeichert. ` : '';
    return {
      title: 'KI-Schritt nicht abgeschlossen',
      chip: 'KI-Schritt nicht abgeschlossen',
      tone: 'warn',
      text: `${lead}Die Analyse wurde nicht abgeschlossen${failed !== undefined ? ` (${failed.snapshotId})` : ''}. Sie wird beim nächsten Lauf erneut versucht, oder du startest sie selbst unter Work-Logs.`,
      extra: [...messages, ...extra],
    };
  }
  if (code === 4) return { title: known?.title ?? 'Zuordnung angehalten', chip: 'Angehalten', tone: 'err', text: known?.text ?? '', extra: [...messages, ...extra] };
  if (code === 5) return { title: known?.title ?? 'Arbeitsstand unruhig', chip: 'Arbeitsstand unruhig', tone: 'warn', text: known?.text ?? '', extra: [...messages, ...extra] };
  if (code === 7) return { title: known?.title ?? 'Voraussetzungen nicht erfüllt', chip: 'Voraussetzungen fehlen', tone: 'warn', text: known?.text ?? '', extra: [...messages, ...extra] };
  if (known !== undefined) {
    return { title: known.title, chip: code === 2 ? 'Bedienungsfehler' : 'Fehler', tone: known.level === 'err' ? 'err' : 'warn', text: known.text, extra: [...messages, ...extra] };
  }
  // An exit code the app does not know is shown with the message of the CLI and never explained by guessing.
  return { title: 'Unbekannter Exit-Code', chip: 'Fehler', tone: 'warn', text: `Das CLI endete mit dem Exit-Code ${code}. Die Meldung des CLI steht in den Details.`, extra: [...messages, ...extra] };
}

/** One-line summary for a result: "Snapshot S000002 gespeichert, Commits 2, Belege 12, Analyse abgeschlossen". */
export function describeCapture(result: Extract<RunResultView, { kind: 'capture' }>): string {
  if (result.snapshot === null) return result.capture === 'unchanged' ? 'Keine neue Arbeit' : 'Kein Snapshot gespeichert';
  const parts = [`Snapshot ${result.snapshot.id} gespeichert`, `Commits ${result.snapshot.commits}`, `Belege ${result.snapshot.evidence}`];
  if (result.analysis === null) parts.push('Analyse nicht ausgeführt (Nur aufnehmen)');
  else if (result.analysis.completed.some((entry) => entry.snapshotId === result.snapshot?.id)) parts.push('Analyse abgeschlossen');
  return parts.join(', ');
}

/** Detector names of the secret scanner in plain German (spec §8.8, §8.9). The value that hit is never known here. */
export const DETECTOR_LABEL: Record<string, string> = {
  private_key: 'privater Schlüssel',
  aws_access_key: 'AWS-Zugangsschlüssel',
  github_token: 'GitHub-Token',
  slack_token: 'Slack-Token',
  anthropic_or_openai_key: 'API-Schlüssel',
  jwt: 'JSON-Web-Token',
  url_credentials: 'Zugangsdaten in einer Adresse',
  assignment: 'Zuweisung eines Geheimwerts',
  custom: 'eigenes Geheimnismuster',
};

/** With article, for "Er enthält …". */
export const DETECTOR_PHRASE: Record<string, string> = {
  private_key: 'einen privaten Schlüssel',
  aws_access_key: 'einen AWS-Zugangsschlüssel',
  github_token: 'ein GitHub-Token',
  slack_token: 'ein Slack-Token',
  anthropic_or_openai_key: 'einen API-Schlüssel',
  jwt: 'ein JSON-Web-Token',
  url_credentials: 'Zugangsdaten in einer Adresse',
  assignment: 'die Zuweisung eines Geheimwerts',
  custom: 'ein eigenes Geheimnismuster',
};

export const detectorLabel = (name: string): string => DETECTOR_LABEL[name] ?? name;
export const detectorPhrase = (name: string): string => DETECTOR_PHRASE[name] ?? 'einen möglichen Geheimwert';
