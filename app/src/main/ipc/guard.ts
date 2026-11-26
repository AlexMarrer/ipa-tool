import { isDay } from '../../shared/dates';
import { MAX_NOTE_TEXT } from '../../shared/run';
import type { FileRef } from '../../shared/views';
import type { CommandRequest, NoteFields } from '../cli/commands';
import { APP_ORIGIN } from '../security';

export interface SenderInfo {
  /** `event.senderFrame.url`; `undefined` when the frame is gone. */
  frameUrl: string | undefined;
  /** `event.sender.id` */
  webContentsId: number;
  /** Whether the frame is the top frame of its web contents. */
  isMainFrame: boolean;
}

/** spec §3.2: only the main frame of the main window, loaded from the app protocol (or the dev server). */
export function isTrustedSender(sender: SenderInfo, mainWebContentsId: number | undefined, devServerUrl?: string): boolean {
  if (mainWebContentsId === undefined || sender.webContentsId !== mainWebContentsId) return false;
  if (!sender.isMainFrame || sender.frameUrl === undefined) return false;
  if (sender.frameUrl.startsWith(`${APP_ORIGIN}/`)) return true;
  if (devServerUrl === undefined || devServerUrl === '') return false;
  try {
    return new URL(sender.frameUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** A reason for `skip` or `baseline`; the CLI keeps its own limits. */
const MAX_REASON = 2000;

export class InvalidInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInput';
  }
}

/** Input checks for IPC arguments; every check throws `InvalidInput`. */
export const input = {
  none(value: unknown): void {
    if (value !== undefined && value !== null) throw new InvalidInput('Es wurde keine Eingabe erwartet.');
  },
  string(value: unknown, max = 200): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new InvalidInput('Zeichenkette erwartet.');
    return value;
  },
  /** An object with exactly the given keys; extra or missing keys are refused. */
  fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput('Objekt erwartet.');
    const actual = Object.keys(value);
    if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) throw new InvalidInput('Unerwartete Felder.');
    return value as Record<string, unknown>;
  },
  day(value: unknown): string {
    if (!isDay(value)) throw new InvalidInput('Tag im Format JJJJ-MM-TT erwartet.');
    return value;
  },
  /** Text for the clipboard; long journals are fine, but not unlimited. */
  text(value: unknown, max = 2_000_000): string {
    if (typeof value !== 'string' || value.length > max) throw new InvalidInput('Text erwartet.');
    return value;
  },
  /** A reference to a file by kind and id; the renderer never passes a path (spec §3.8). */
  fileRef(value: unknown): FileRef {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput('Verweis erwartet.');
    const v = value as Record<string, unknown>;
    const only = (keys: string[]): void => {
      const actual = Object.keys(v);
      if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) throw new InvalidInput('Unerwartete Felder im Verweis.');
    };
    switch (v['kind']) {
      case 'workLog':
        only(['kind', 'snapshotId']);
        return { kind: 'workLog', snapshotId: input.string(v['snapshotId'], 20) };
      case 'journalDraft':
        only(['kind', 'file']);
        return { kind: 'journalDraft', file: input.string(v['file'], 60) };
      case 'journalFinal':
        only(['kind', 'file']);
        return { kind: 'journalFinal', file: input.string(v['file'], 120) };
      case 'journalFinalFolder':
        only(['kind']);
        return { kind: 'journalFinalFolder' };
      case 'workspaceFolder':
        only(['kind']);
        return { kind: 'workspaceFolder' };
      case 'evidence':
        only(['kind', 'snapshotId', 'evidenceId']);
        return { kind: 'evidence', snapshotId: input.string(v['snapshotId'], 20), evidenceId: input.string(v['evidenceId'], 20) };
      default:
        throw new InvalidInput('Unbekannte Art des Verweises.');
    }
  },
  /**
   * An action of package 12 as a typed command. Only the commands named there pass, with exactly their fields;
   * everything else is refused before a process could start (spec §3.4, §12.1).
   */
  runInput(value: unknown): CommandRequest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput('Befehl erwartet.');
    const v = value as Record<string, unknown>;
    const allow = (keys: string[]): void => {
      for (const key of Object.keys(v)) if (!keys.includes(key)) throw new InvalidInput(`Unbekanntes Feld: ${key}`);
    };
    const optional = <T>(key: string, parse: (raw: unknown) => T): T | undefined => (v[key] === undefined ? undefined : parse(v[key]));
    const snapshotId = (raw: unknown): string => {
      if (typeof raw !== 'string' || !/^S\d{6}$/.test(raw)) throw new InvalidInput('Snapshot-ID erwartet.');
      return raw;
    };
    /** Free text: not empty after trimming, within the limit. Reasons and notes may span lines. */
    const text = (raw: unknown, max: number): string => {
      if (typeof raw !== 'string' || raw.trim() === '' || raw.length > max) throw new InvalidInput('Text erwartet.');
      return raw;
    };
    const integer = (raw: unknown, min: number, max: number): number => {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) throw new InvalidInput('Ganze Zahl erwartet.');
      return raw;
    };
    const time = (raw: unknown): string => {
      if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new InvalidInput('Uhrzeit HH:MM erwartet.');
      return raw;
    };
    const flag = (raw: unknown): boolean => {
      if (typeof raw !== 'boolean') throw new InvalidInput('Ja oder nein erwartet.');
      return raw;
    };
    switch (v['name']) {
      case 'capture': {
        allow(['name', 'mode', 'retrySnapshotId']);
        const mode = v['mode'];
        if (mode !== 'full' && mode !== 'noAnalysis' && mode !== 'retry') throw new InvalidInput('Unbekannte Art des Erfassens.');
        if (mode === 'retry') return { name: 'capture', mode, retrySnapshotId: snapshotId(v['retrySnapshotId']) };
        if (v['retrySnapshotId'] !== undefined) throw new InvalidInput('retrySnapshotId nur beim erneuten Versuch.');
        return { name: 'capture', mode };
      }
      case 'journal': {
        allow(['name', 'day', 'noAi']);
        const day = optional('day', (raw) => input.day(raw));
        const noAi = optional('noAi', flag);
        return { name: 'journal', ...(day !== undefined ? { day } : {}), ...(noAi !== undefined ? { noAi } : {}) };
      }
      case 'skip':
        allow(['name', 'snapshotId', 'reason']);
        return { name: 'skip', snapshotId: snapshotId(v['snapshotId']), reason: text(v['reason'], MAX_REASON) };
      case 'baseline': {
        allow(['name', 'reason', 'force']);
        const force = optional('force', flag);
        return { name: 'baseline', reason: text(v['reason'], MAX_REASON), ...(force !== undefined ? { force } : {}) };
      }
      case 'doctor':
        allow(['name']);
        return { name: 'doctor' };
      case 'note': {
        allow(['name', 'text', 'type', 'day', 'minutes', 'start', 'end', 'timeKind', 'delay', 'reason', 'alternatives', 'cause', 'solution', 'refs']);
        const out: NoteFields & { name: 'note' } = { name: 'note', text: text(v['text'], MAX_NOTE_TEXT) };
        const type = optional('type', (raw) => {
          if (raw !== 'general' && raw !== 'activity' && raw !== 'problem' && raw !== 'decision' && raw !== 'insight' && raw !== 'plan') throw new InvalidInput('Unbekannte Notizart.');
          return raw;
        });
        if (type !== undefined) out.type = type;
        const day = optional('day', (raw) => input.day(raw));
        if (day !== undefined) out.day = day;
        const minutes = optional('minutes', (raw) => integer(raw, 1, 1440));
        if (minutes !== undefined) out.minutes = minutes;
        const start = optional('start', time);
        if (start !== undefined) out.start = start;
        const end = optional('end', time);
        if (end !== undefined) out.end = end;
        const timeKind = optional('timeKind', (raw) => {
          if (raw !== 'measured' && raw !== 'estimated') throw new InvalidInput('gemessen oder geschätzt erwartet.');
          return raw;
        });
        if (timeKind !== undefined) out.timeKind = timeKind;
        const delay = optional('delay', (raw) => integer(raw, 1, 1440));
        if (delay !== undefined) out.delay = delay;
        for (const key of ['reason', 'cause', 'solution'] as const) {
          const field = optional(key, (raw) => text(raw, MAX_NOTE_TEXT));
          if (field !== undefined) out[key] = field;
        }
        const alternatives = optional('alternatives', (raw) => {
          if (!Array.isArray(raw) || raw.length > 20) throw new InvalidInput('Liste erwartet.');
          return (raw as unknown[]).map((item) => text(item, 1000));
        });
        if (alternatives !== undefined) out.alternatives = alternatives;
        const refs = optional('refs', (raw) => {
          if (!Array.isArray(raw) || raw.length > 100) throw new InvalidInput('Liste erwartet.');
          return (raw as unknown[]).map((item) => {
            if (typeof item !== 'string' || !/^S\d{6}:E\d{3,}$/.test(item)) throw new InvalidInput('Beleg-Referenz erwartet.');
            return item;
          });
        });
        if (refs !== undefined) out.refs = refs;
        return out;
      }
      default:
        throw new InvalidInput('Dieser Befehl darf nicht gestartet werden.');
    }
  },
  /** Only `http:` and `https:` links (spec §11.1). */
  httpUrl(value: unknown): string {
    const text = input.string(value, 2048);
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new InvalidInput('Adresse erwartet.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InvalidInput('Nur http und https sind erlaubt.');
    return url.href;
  },
};
