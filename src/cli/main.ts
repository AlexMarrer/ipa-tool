/**
 * Commander-Definition und zentrale Fehlerbehandlung (spec.md §6).
 */
import { Command, CommanderError } from 'commander';
import { EXIT, type ExitCode, IpaError } from '../core/errors.js';
import { toolVersion } from '../core/tool.js';
import { registerInitCommand } from './commands/init.js';
import { registerStatusCommand } from './commands/status.js';
import { type CliIo, type CliState, processIo } from './io.js';
import { translateCommanderMessage, translateHelpTitle } from './messages.js';

const MAX_UNEXPECTED_MESSAGE = 300;

/** Eintrag in der Befehlsliste der Hilfe, zum Beispiel `init [optionen]`. */
function subcommandTerm(command: Command): string {
  const args = command.registeredArguments.map((arg) => {
    const name = `${arg.name()}${arg.variadic ? '...' : ''}`;
    return arg.required ? `<${name}>` : `[${name}]`;
  });
  return [command.name(), ...(command.options.length > 0 ? ['[optionen]'] : []), ...args].join(' ');
}

export function createProgram(io: CliIo, state: CliState): Command {
  const program = new Command('ipa');
  program
    .description(
      'IPA Assistant: sichert den Arbeitsstand eines Git-Repositorys in einem eigenen Arbeitsbereich ' +
        'und bereitet belegte Arbeitsprotokolle vor.',
    )
    .usage('[optionen] <befehl>')
    .version(toolVersion(), '-V, --version', 'Tool-Version ausgeben')
    .helpOption('-h, --help', 'Hilfe anzeigen')
    .helpCommand(false)
    .option('--repo <pfad>', 'zu untersuchendes Repository (Standard: aktuelles Verzeichnis)')
    .option('--data-dir <pfad>', 'Datenwurzel (Standard: IPA_ASSISTANT_HOME, sonst %LOCALAPPDATA%\\ipa-assistant)')
    .configureHelp({ styleTitle: translateHelpTitle, subcommandTerm, showGlobalOptions: true })
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
      outputError: (text, write) => write(translateCommanderMessage(text)),
    })
    .showSuggestionAfterError(true)
    .exitOverride();

  // Befehle späterer Pakete werden erst mit ihrem Paket registriert.
  registerInitCommand(program, io, state);
  registerStatusCommand(program, io, state);
  return program;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/)[0] ?? '';
  return line.length > MAX_UNEXPECTED_MESSAGE ? `${line.slice(0, MAX_UNEXPECTED_MESSAGE)} …` : line;
}

function stackOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    parts.push(current instanceof Error ? (current.stack ?? current.message) : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return `${parts.join('\nUrsache: ')}\n`;
}

/**
 * Bildet einen Fehler auf den Exit-Code ab (spec.md §6.4):
 * `IpaError` → eigener Code, Bedienungsfehler von Commander → 2, alles andere → 1 ohne Stacktrace.
 * Mit `IPA_DEBUG=1` folgt der Stacktrace.
 */
export function reportError(error: unknown, io: CliIo): ExitCode {
  const debug = io.env['IPA_DEBUG'] === '1';
  if (error instanceof CommanderError) {
    // Commander hat Hilfe oder Meldung bereits ausgegeben.
    return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
  }
  if (error instanceof IpaError) {
    io.stderr(`Fehler: ${error.message}\n`);
    if (debug) io.stderr(stackOf(error));
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(`Unerwarteter Fehler: ${firstLine(message)}\n`);
  io.stderr(debug ? stackOf(error) : 'Details mit IPA_DEBUG=1.\n');
  return EXIT.internal;
}

export async function main(argv: readonly string[], io: CliIo = processIo()): Promise<ExitCode> {
  const state: CliState = { exitCode: EXIT.ok };
  try {
    const program = createProgram(io, state);
    await program.parseAsync([...argv], { from: 'user' });
    return state.exitCode;
  } catch (error) {
    return reportError(error, io);
  }
}
