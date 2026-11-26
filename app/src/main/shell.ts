/** What the main process may do with the operating system (spec §3.8). Electron-free so tests can replace it. */
export interface ShellPort {
  /** `shell.openPath`: resolves to an error text, empty on success. */
  openPath(file: string): Promise<string>;
  showItemInFolder(file: string): void;
  writeClipboard(text: string): void;
  openExternal(url: string): Promise<void>;
  /** `shell.trashItem`: moves to the recycle bin; rejects if that is not possible. Nothing is deleted for good. */
  trashItem(file: string): Promise<void>;
  /** System file dialog; resolves to the chosen file or `null` if the user cancelled. */
  chooseFile(defaultPath: string): Promise<string | null>;
}

/** Used where no operating system is available (tests that do not care). Nothing is opened. */
export const noShell: ShellPort = {
  openPath: async () => '',
  showItemInFolder: () => undefined,
  writeClipboard: () => undefined,
  openExternal: async () => undefined,
  trashItem: async () => undefined,
  chooseFile: async () => null,
};
