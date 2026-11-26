import type { LiveLine } from '../../shared/types';

/**
 * Derives the live output of a run from file events in the workspace (spec §3.5, AD-06). The CLI prints no
 * progress, so this is an addition: titles, run time and the end come from the process, not from here.
 *
 * Lines are built from file names and counters only, never from file contents, notes, reasons or answers (I-12).
 */

const SNAPSHOT_ID = /^S\d{6}$/;
const IDLE_AFTER_MS = 15_000;

export const ATTEMPT_ERROR_TEXT: Record<string, string> = {
  not_found: 'Claude wurde nicht gefunden',
  not_executable: 'Claude lässt sich nicht starten',
  timeout: 'Zeitüberschreitung beim KI-Schritt',
  nonzero_exit: 'Claude wurde mit einem Fehler beendet',
  invalid_envelope: 'Die Antwort von Claude war nicht auswertbar',
  missing_structured_output: 'Die Antwort von Claude war nicht auswertbar',
  error_result: 'Claude meldete einen Fehler',
  schema_invalid: 'Die Antwort von Claude hat die Prüfung nicht bestanden',
  evidence_invalid: 'Die Antwort von Claude hat die Prüfung nicht bestanden',
  rule_violation: 'Die Antwort von Claude hat die Prüfung nicht bestanden',
  interrupted: 'Der Versuch wurde abgebrochen',
};

export interface ProgressMapperOptions {
  /** Reads a workspace-relative text file, `null` if it does not exist or cannot be read. */
  readText: (relativePath: string) => Promise<string | null>;
  /** `claude.maxAnalysesPerRun` of the project. */
  maxAnalysesPerRun: number;
}

export interface ProgressMapper {
  /** Maps one changed path (relative to the workspace, `/` separators) to zero or more lines. */
  handlePath(relativePath: string, at: Date): Promise<LiveLine[]>;
  /** Called periodically; reports a waiting hint when nothing happened for 15 s while Claude is expected. */
  idle(now: Date): LiveLine[];
  /** Last line of a run. */
  finish(at: Date, exitCode: number | null, cancelled: boolean): LiveLine;
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createProgressMapper(options: ProgressMapperOptions): ProgressMapper {
  const seen = new Set<string>();
  const attemptDirs: string[] = [];
  const answered = new Set<string>();
  let lastEventAt = 0;
  let waitingReported = false;

  const once = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const line = (at: Date, text: string, muted = false): LiveLine => ({ at: at.toISOString(), text, ...(muted ? { muted } : {}) });

  async function handlePath(relativePath: string, at: Date): Promise<LiveLine[]> {
    const parts = relativePath.split('/').filter((part) => part !== '');
    const lines: LiveLine[] = [];
    const emit = (text: string, muted = false): void => void lines.push(line(at, text, muted));

    if (relativePath === 'lock' && once('lock')) {
      const lock = parseJson(await options.readText('lock'));
      const command = typeof lock?.['command'] === 'string' ? lock['command'] : null;
      emit(command === null ? 'Lauf gestartet' : `Lauf gestartet (${command})`);
    } else if (parts[0] === 'snapshots' && parts[1]?.startsWith('.tmp-') && once('tmp')) {
      emit('Arbeitsstand prüfen');
    } else if (parts[0] === 'snapshots' && parts[1] !== undefined && SNAPSHOT_ID.test(parts[1]) && parts[2] === 'manifest.json') {
      if (once(`manifest:${parts[1]}`)) {
        const manifest = parseJson(await options.readText(relativePath));
        const states = Array.isArray(manifest?.['fileStates']) ? manifest['fileStates'].length : 0;
        emit(`Snapshot ${parts[1]} gespeichert, ${states} Dateizustände`);
        const decisions = Array.isArray(manifest?.['filterDecisions']) ? manifest['filterDecisions'] : [];
        const withheld = decisions.filter((d) => typeof d === 'object' && d !== null && (d as { decision?: unknown }).decision === 'withheld').length;
        emit(withheld === 0 ? 'Geheimnisprüfung: keine Verdachtsfälle' : `Geheimnisprüfung: ${withheld} Einheit(en) zurückgehalten`);
      }
    } else if (parts[0] === 'analyses' && parts[1] !== undefined && SNAPSHOT_ID.test(parts[1])) {
      const snapshot = parts[1];
      const attempt = parts[2] !== undefined && /^attempt-\d+$/.test(parts[2]) ? parts[2] : null;
      if (attempt !== null) {
        const dir = `${snapshot}/${attempt}`;
        if (!attemptDirs.includes(dir)) {
          attemptDirs.push(dir);
          emit(`Analyse ${snapshot}: Claude-Aufruf ${attemptDirs.length} von ${options.maxAnalysesPerRun} gestartet`);
        }
        const number = attempt.slice('attempt-'.length);
        if (parts[3] === 'response.json' && once(`response:${dir}`)) {
          answered.add(dir);
          emit(`Analyse ${snapshot}: Antwort von Claude erhalten`);
        } else if (parts[3] === 'outcome.json' && once(`outcome:${dir}`)) {
          answered.add(dir);
          const outcome = parseJson(await options.readText(relativePath));
          const code = typeof outcome?.['errorCode'] === 'string' ? outcome['errorCode'] : null;
          const ok = outcome?.['outcome'] === 'success' || (outcome !== null && code === null);
          emit(
            ok
              ? `Analyse ${snapshot}: Versuch ${number} abgeschlossen`
              : `Analyse ${snapshot}: Versuch ${number} nicht abgeschlossen (${code === null ? 'unbekannt' : (ATTEMPT_ERROR_TEXT[code] ?? code)})`,
          );
        }
      } else if (parts[2] === 'complete.json' && once(`complete:${snapshot}`)) {
        emit(`Analyse ${snapshot}: abgeschlossen`);
      }
    } else if (parts[0] === 'journal' && parts[1] === 'runs' && parts[2] !== undefined && once(`journal-run:${parts[2]}`)) {
      emit('Journal: Eingabe gebaut');
    } else if (parts[0] === 'journal' && parts[1] === 'drafts' && parts[2]?.endsWith('.md') && once(`draft:${parts[2]}`)) {
      emit('Journal: Entwurf geschrieben');
    } else if (relativePath === 'ai-usage.jsonl') {
      const text = await options.readText('ai-usage.jsonl');
      const last = text === null ? null : text.trimEnd().split('\n').at(-1);
      const usage = last === undefined || last === null ? null : parseJson(last);
      if (usage !== null && once(`usage:${String(usage['startedAt'] ?? usage['durationMs'])}:${text?.length ?? 0}`)) {
        const seconds = typeof usage['durationMs'] === 'number' ? ` in ${Math.max(1, Math.round(usage['durationMs'] / 1000))} s` : '';
        emit(`Claude-Aufruf beendet${seconds} (${typeof usage['outcome'] === 'string' ? usage['outcome'] : 'unbekannt'})`);
      }
    }

    if (lines.length > 0) {
      lastEventAt = at.getTime();
      waitingReported = false;
    }
    return lines;
  }

  return {
    handlePath,
    idle(now) {
      if (waitingReported || lastEventAt === 0 || now.getTime() - lastEventAt < IDLE_AFTER_MS) return [];
      const open = attemptDirs.filter((dir) => !answered.has(dir)).at(-1);
      if (open === undefined) return [];
      waitingReported = true;
      return [line(now, `Analyse ${open.split('/')[0]}: wartet auf Antwort von Claude …`, true)];
    },
    finish(at, exitCode, cancelled) {
      return line(at, cancelled ? 'Lauf abgebrochen' : `Lauf beendet, Exit-Code ${exitCode ?? 'unbekannt'}`);
    },
  };
}
