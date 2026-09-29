/**
 * `ipa init [--timezone <iana>] [--workspace <pfad>]` with baseline snapshot (spec.md §6.3).
 */
import type { Command } from 'commander';
import { takeInitialBaseline } from '../../collector/baseline.js';
import { readManifest } from '../../collector/snapshots.js';
import { DEFAULT_TIMEZONE } from '../../core/config.js';
import { EXIT } from '../../core/errors.js';
import { type InitResult, initializeWorkspace } from '../../core/init.js';
import { isStrictlyInside } from '../../core/paths.js';
import { describeWorkspaceMode, formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';
import { withheldNotice } from './capture.js';

interface InitCommandOptions extends GlobalOptions {
  timezone?: string;
  workspace?: string;
}

function headline(result: InitResult): string {
  if (result.created) return 'Arbeitsbereich angelegt.';
  if (result.baseline?.adopted === true) return 'Ausgangs-Snapshot aus einer abgebrochenen Initialisierung übernommen.';
  return 'Ausgangs-Snapshot nachgeholt.';
}

function formatInitResult(result: InitResult): string {
  const insideRepo = isStrictlyInside(result.entry.workspacePath, result.entry.repoPath);
  return (
    `${headline(result)}\n` +
    formatFields([
      ['Repository-ID', result.entry.repositoryId],
      ['Repository', result.entry.repoPath],
      ['Arbeitsbereich', result.entry.workspacePath],
      ['Speichermodus', describeWorkspaceMode(result.entry.workspaceMode, insideRepo)],
      ['Zeitzone', result.ctx.config.timezone],
      ['Ausgangs-Snapshot', result.baseline?.snapshotId ?? 'keiner'],
    ])
  );
}

export function registerInitCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('init')
    .usage('[optionen]')
    .description('Arbeitsbereich für das Repository anlegen und Ausgangs-Snapshot aufnehmen')
    .option('--timezone <iana>', `Zeitzone als IANA-Name (Standard: ${DEFAULT_TIMEZONE})`)
    .option('--workspace <pfad>', 'Arbeitsbereich ausdrücklich wählen, relativ zur Repository-Wurzel, zum Beispiel .ipa')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<InitCommandOptions>();
      const result = await initializeWorkspace({
        repo: options.repo,
        dataDir: options.dataDir,
        timezone: options.timezone,
        workspace: options.workspace,
        baseline: (ctx) => takeInitialBaseline(ctx, { onWarning: (message) => io.stderr(`${message}\n`) }),
      });
      io.stdout(formatInitResult(result));
      for (const notice of result.notices) io.stderr(`${notice}\n`);
      if (result.baseline !== null) {
        const notice = withheldNotice(await readManifest(result.ctx, result.baseline.snapshotId));
        if (notice !== null) io.stderr(`${notice}\n`);
      }
      state.exitCode = EXIT.ok;
    });
}
