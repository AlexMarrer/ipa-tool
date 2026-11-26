/** What the main process may do with the operating system (spec §3.8). Electron-free so tests can replace it. */
export interface ShellPort {
  /** `shell.openPath`: resolves to an error text, empty on success. */
  openPath(file: string): Promise<string>;
  showItemInFolder(file: string): void;
  writeClipboard(text: string): void;
  openExternal(url: string): Promise<void>;
}

/** Used where no operating system is available (tests that do not care). Nothing is opened. */
export const noShell: ShellPort = {
  openPath: async () => '',
  showItemInFolder: () => undefined,
  writeClipboard: () => undefined,
  openExternal: async () => undefined,
};
