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
};
