import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { reportError } from '../../src/cli/main.js';
import { translateCommanderMessage } from '../../src/cli/messages.js';
import { IpaError } from '../../src/core/errors.js';
import { runCli, TOOL_ROOT } from '../helpers/workspace.js';

function memoryIo(env: NodeJS.ProcessEnv = {}) {
  const out = { stdout: '', stderr: '' };
  const io = {
    stdout: (text: string) => {
      out.stdout += text;
    },
    stderr: (text: string) => {
      out.stderr += text;
    },
    env,
  };
  return { io, out };
}

/** Command names listed under "Befehle:" in the help. */
function listedCommands(help: string): string[] {
  const section = help.split('Befehle:')[1] ?? '';
  return section
    .split(/\r?\n/)
    .map((line) => /^\s{2}(\S+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe('CLI-Rahmen (AK-01-02, AK-02-18, AK-03-14, AK-04-11, AK-05-10, AK-06-18, AK-07-11, AK-08-10)', () => {
  it('ipa --help listet alle Befehle von V1 bis schedule, aber keinen ausgeschlossenen (AK-05-10, AK-06-18, AK-07-11, AK-08-10)', async () => {
    const result = await runCli(['--help'], { dataDir: null });
    expect(result.exitCode).toBe(0);
    expect(listedCommands(result.stdout)).toEqual(['init', 'status', 'doctor', 'capture', 'baseline', 'skip', 'note', 'journal', 'schedule']);
    expect(result.stdout).toContain('--repo <pfad>');
    expect(result.stdout).toContain('--data-dir <pfad>');
    expect(result.stdout).not.toMatch(/\bhelp \[command\]/);
  });

  it('ipa --version gibt die Version aus package.json aus', async () => {
    const pkg = JSON.parse(await readFile(path.join(TOOL_ROOT, 'package.json'), 'utf8')) as { version: string };
    const result = await runCli(['--version'], { dataDir: null });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('ein unbekannter Befehl, eine unbekannte Option und fehlende Argumente enden mit Exit-Code 2', async () => {
    // `ipa decision` is excluded from V1 (spec.md §1.3).
    const unknownCommand = await runCli(['decision'], { dataDir: null });
    expect(unknownCommand.exitCode).toBe(2);
    expect(unknownCommand.stderr).toContain("unbekannter Befehl 'decision'");

    const unknownOption = await runCli(['status', '--gibt-es-nicht'], { dataDir: null });
    expect(unknownOption.exitCode).toBe(2);
    expect(unknownOption.stderr).toContain("unbekannte Option '--gibt-es-nicht'");

    const missingValue = await runCli(['init', '--timezone'], { dataDir: null });
    expect(missingValue.exitCode).toBe(2);

    const excess = await runCli(['status', 'zuviel'], { dataDir: null });
    expect(excess.exitCode).toBe(2);

    const nothing = await runCli([], { dataDir: null });
    expect(nothing.exitCode).toBe(2);
    expect(nothing.stderr).toContain('Aufruf:');
  });

  it('zeigt in der Hilfe eines Befehls auch die globalen Optionen', async () => {
    const result = await runCli(['init', '--help'], { dataDir: null });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--workspace <pfad>');
    expect(result.stdout).toContain('--timezone <iana>');
    expect(result.stdout).toContain('Globale Optionen:');
    expect(result.stdout).toContain('--data-dir <pfad>');
  });

  it('ersetzt die Claude-Vorabprüfung aus Paket 01 durch ipa doctor --live (AK-05-10, D-24)', async () => {
    const pkg = JSON.parse(await readFile(path.join(TOOL_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['probe:claude']).toBeUndefined();
    expect(existsSync(path.join(TOOL_ROOT, 'scripts', 'claude-probe.mjs'))).toBe(false);
    // The live tests are a separate configuration that `npm test` (test/**/*.test.ts) does not include.
    expect(pkg.scripts['test:live']).toBe('vitest run --config vitest.live.config.ts');
    expect(pkg.scripts['test']).toBe('vitest run');
    expect(existsSync(path.join(TOOL_ROOT, 'test', 'live', 'doctor.live.ts'))).toBe(true);
    const readme = await readFile(path.join(TOOL_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('ipa doctor --live');
    expect(readme).not.toContain('probe:claude');
    expect(readme).not.toContain('claude-probe');

    const help = await runCli(['doctor', '--help'], { dataDir: null });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('--live');
  });

  it('übersetzt Commander-Meldungen ins Deutsche', () => {
    expect(translateCommanderMessage("error: unknown option '--jsn'\n(Did you mean --json?)")).toBe(
      "Fehler: unbekannte Option '--jsn'\n(Meinten Sie --json?)",
    );
    expect(translateCommanderMessage("error: option '--timezone <iana>' argument missing")).toBe(
      "Fehler: Für die Option '--timezone <iana>' fehlt der Wert",
    );
  });
});

describe('Zentrale Fehlerbehandlung (spec.md §6.4)', () => {
  it('meldet IpaError mit eigenem Exit-Code und deutscher Meldung auf stderr', () => {
    const { io, out } = memoryIo();
    expect(reportError(new IpaError('not_initialized', 2, 'Nicht initialisiert.'), io)).toBe(2);
    expect(out.stderr).toBe('Fehler: Nicht initialisiert.\n');
    expect(out.stdout).toBe('');
  });

  it('meldet unerwartete Fehler mit Exit-Code 1 und kurzer Meldung ohne Stacktrace', () => {
    const { io, out } = memoryIo();
    expect(reportError(new TypeError('kaputt\nzweite Zeile'), io)).toBe(1);
    expect(out.stderr).toContain('Unerwarteter Fehler: kaputt');
    expect(out.stderr).not.toContain('zweite Zeile');
    expect(out.stderr).not.toContain('    at ');
  });

  it('gibt mit IPA_DEBUG=1 den Stacktrace samt Ursache aus', () => {
    const { io, out } = memoryIo({ IPA_DEBUG: '1' });
    expect(reportError(new TypeError('kaputt', { cause: new Error('Ursache') }), io)).toBe(1);
    expect(out.stderr).toContain('    at ');
    expect(out.stderr).toContain('Ursache');
  });

  it('bildet Bedienungsfehler von Commander auf 2 ab, Hilfe und Version auf 0', () => {
    const { io } = memoryIo();
    expect(reportError(new CommanderError(1, 'commander.unknownOption', 'x'), io)).toBe(2);
    expect(reportError(new CommanderError(1, 'commander.help', 'x'), io)).toBe(2);
    expect(reportError(new CommanderError(0, 'commander.helpDisplayed', 'x'), io)).toBe(0);
    expect(reportError(new CommanderError(0, 'commander.version', 'x'), io)).toBe(0);
  });
});
