/**
 * Replaceable parts of the CLI. The entry point uses the defaults; tests inject their own, so that no test
 * talks to the real Task Scheduler (package 09 §4.3).
 */
import type { SchtasksRunner } from '../schedule/schtasks.js';

export interface CliDeps {
  /** Default: the real `schtasks`. */
  schtasks?: SchtasksRunner;
  /** Default: `process.platform`. The task commands need `win32`. */
  platform?: NodeJS.Platform;
  /** Default: `process.execPath` and `dist/cli.js` of this installation. */
  nodePath?: string;
  cliPath?: string;
  /** Base of the folder for the task XML that `schtasks /Create` imports; default: `os.tmpdir()`. */
  tempDir?: string;
  /** Test hook as in spec.md §10: runs in `config set` after the check and before the file is compared and replaced. */
  beforeConfigWrite?: () => Promise<void>;
}
