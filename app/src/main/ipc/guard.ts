import { isDay } from '../../shared/dates';
import type { FileRef } from '../../shared/views';
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
