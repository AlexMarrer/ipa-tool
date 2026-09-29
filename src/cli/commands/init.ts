/**
 * `ipa init [--timezone <iana>] [--workspace <pfad>]` (Paket 01: ohne Ausgangs-Snapshot).
 */
import type { Command } from 'commander';
import { DEFAULT_TIMEZONE } from '../../core/config.js';
import { EXIT } from '../../core/errors.js';
import { type InitResult, initializeWorkspace } from '../../core/init.js';
import { describeWorkspaceMode, formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

interface InitCommandOptions extends GlobalOptions {
  timezone?: string;
  workspace?: string;
}

function formatInitResult(result: InitResult): string {
  return (
    'Arbeitsbereich angelegt.\n' +
    formatFields([
      ['Repository-ID', result.entry.repositoryId],
      ['Repository', result.entry.repoPath],
      ['Arbeitsbereich', result.entry.workspacePath],
      ['Speichermodus', describeWorkspaceMode(result.entry.workspaceMode, result.location.relativeToRepo !== null)],
      ['Zeitzone', result.ctx.config.timezone],
    ])
  );
}

export function registerInitCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('init')
    .usage('[optionen]')
    .description('Arbeitsbereich für das Repository anlegen')
    .option('--timezone <iana>', `Zeitzone als IANA-Name (Standard: ${DEFAULT_TIMEZONE})`)
    .option('--workspace <pfad>', 'Arbeitsbereich ausdrücklich wählen, relativ zur Repository-Wurzel, zum Beispiel .ipa')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<InitCommandOptions>();
      const result = await initializeWorkspace({
        repo: options.repo,
        dataDir: options.dataDir,
        timezone: options.timezone,
        workspace: options.workspace,
      });
      io.stdout(formatInitResult(result));
      for (const notice of result.notices) io.stderr(`${notice}\n`);
      state.exitCode = EXIT.ok;
    });
}
