import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { APP_ERROR_MESSAGES } from '../../shared/messages';
import { INVOKE_CHANNELS, type IpcChannel } from '../../shared/ipc';
import type { IpaResult } from '../../shared/types';
import { toIpaError } from '../cli/errors';
import { InvalidInput, isTrustedSender } from './guard';
import type { Handler } from './handlers';

export interface RegisterOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  handlers: Partial<Record<IpcChannel, Handler>>;
  mainWebContentsId: () => number | undefined;
  devServerUrl?: string;
  onRejected?: (channel: string, reason: 'untrusted_sender' | 'invalid_input') => void;
}

/**
 * Registers one handler per invoke channel. Every message is checked for its sender and its input; the answer is
 * always `{ ok, value | error }` and never throws into the renderer (spec §3.9).
 */
export function registerIpc(options: RegisterOptions): () => void {
  const registered: string[] = [];
  for (const channel of INVOKE_CHANNELS) {
    const handler = options.handlers[channel];
    if (handler === undefined) continue;
    registered.push(channel);
    options.ipcMain.handle(channel, async (event: IpcMainInvokeEvent, argument: unknown): Promise<IpaResult<unknown>> => {
      const sender = {
        frameUrl: event.senderFrame?.url,
        webContentsId: event.sender.id,
        isMainFrame: event.senderFrame !== null && event.senderFrame === event.sender.mainFrame,
      };
      if (!isTrustedSender(sender, options.mainWebContentsId(), options.devServerUrl)) {
        options.onRejected?.(channel, 'untrusted_sender');
        return { ok: false, error: { code: 'untrusted_sender', message: APP_ERROR_MESSAGES.untrusted_sender } };
      }
      try {
        return { ok: true, value: await handler(argument) };
      } catch (error) {
        if (error instanceof InvalidInput) {
          options.onRejected?.(channel, 'invalid_input');
          return { ok: false, error: { code: 'invalid_request', message: APP_ERROR_MESSAGES.invalid_request } };
        }
        return { ok: false, error: toIpaError(error) };
      }
    });
  }
  return () => {
    for (const channel of registered) options.ipcMain.removeHandler(channel);
  };
}
