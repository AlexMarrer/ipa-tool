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
  /** System folder dialog; resolves to the chosen folder or `null` if the user cancelled. */
  chooseFolder(): Promise<string | null>;
  /** Sets the look of the whole window: `nativeTheme.themeSource`, so `prefers-color-scheme` of the page follows. */
  setTheme(theme: 'system' | 'light' | 'dark'): void;
}

/** Used where no operating system is available (tests that do not care). Nothing is opened. */
export const noShell: ShellPort = {
  openPath: async () => '',
  showItemInFolder: () => undefined,
  writeClipboard: () => undefined,
  openExternal: async () => undefined,
  trashItem: async () => undefined,
  chooseFile: async () => null,
  chooseFolder: async () => null,
  setTheme: () => undefined,
};
