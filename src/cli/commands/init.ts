/**
 * `ipa init [--timezone <iana>] [--workspace <pfad>]` with baseline snapshot and Claude check without
 * a model call (spec.md §6.3).
 */
import type { Command } from 'commander';
import { takeInitialBaseline } from '../../collector/baseline.js';
import { readManifest } from '../../collector/snapshots.js';
import { DEFAULT_TIMEZONE } from '../../core/config.js';
import { EXIT } from '../../core/errors.js';
import { type InitResult, initializeWorkspace } from '../../core/init.js';
import { isStrictlyInside } from '../../core/paths.js';
import { jsonPath, runAction } from '../action.js';
import { describeWorkspaceMode, formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';
import { withheldNotice } from './capture.js';
import { probeClaudeAfterInit } from './doctor.js';

interface InitCommandOptions extends GlobalOptions {
  timezone?: string;
  workspace?: string;
  json?: boolean;
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
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<InitCommandOptions>();
      await runAction({ command: 'init', json: options.json === true, io, state }, async (out) => {
        const result = await initializeWorkspace({
          repo: options.repo,
          dataDir: options.dataDir,
          timezone: options.timezone,
          workspace: options.workspace,
          baseline: (ctx) => takeInitialBaseline(ctx, { onWarning: (message) => out.warn(message) }),
        });
        out.runId = result.ctx.runId;
        out.stdout(formatInitResult(result));
        for (const notice of result.notices) out.warn(notice);
        if (result.baseline !== null) {
          const notice = withheldNotice(await readManifest(result.ctx, result.baseline.snapshotId));
          if (notice !== null) out.warn(notice);
        }
        const check = await probeClaudeAfterInit(result.ctx, io.env);
        if (check.confirmation !== null) out.stdout(check.confirmation);
        if (check.warning !== null) out.warn(check.warning);
        return {
          exitCode: EXIT.ok,
          result: {
            created: result.created,
            repositoryId: result.entry.repositoryId,
            repoPath: jsonPath(result.entry.repoPath),
            workspacePath: jsonPath(result.entry.workspacePath),
            workspaceMode: result.entry.workspaceMode,
            dataRoot: jsonPath(result.ctx.dataRoot),
            timezone: result.ctx.config.timezone,
            baselineSnapshotId: result.baseline?.snapshotId ?? null,
            baselineAdopted: result.baseline?.adopted ?? false,
            recovered: result.baseline?.recovered ?? [],
            claude: check.result,
          },
          print: () => undefined,
        };
      });
    });
}
