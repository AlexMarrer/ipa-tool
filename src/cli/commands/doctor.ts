/**
 * `ipa doctor [--live]` (spec.md §6.2): no lock and no `runs.jsonl` entry; the result is `doctor.json`
 * and, with `--live`, the lines in `ai-usage.jsonl` (spec.md §18).
 */
import type { Command } from 'commander';
import { requiredFlags } from '../../claude/args.js';
import { probeClaude, STRUCTURED_OUTPUT_TOOL } from '../../claude/doctor.js';
import { usesSafeMode, usesSettingSources } from '../../claude/doctor-record.js';
import type { DoctorRecord, DoctorReport, ProbedFlag } from '../../claude/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT } from '../../core/errors.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

interface DoctorCommandOptions extends GlobalOptions {
  live?: boolean;
}

const OPTIONAL_FLAGS: ProbedFlag[] = ['--safe-mode', '--setting-sources', '--model', '--verbose'];

export const CLAUDE_CHECK_WARNING = 'Warnung: Die Claude-Prüfung ist nicht bestanden:';

function describeLogin(record: DoctorRecord): string {
  if (record.claude.loggedIn === true) return `angemeldet, Anmeldeart ${record.claude.authMethod ?? 'unbekannt'}`;
  return record.claude.loggedIn === false ? 'nicht angemeldet' : 'unklar';
}

function describeSettingSources(record: DoctorRecord): string {
  if (usesSettingSources(record)) return 'wird verwendet, die Anmeldung damit ist bestätigt (A-08)';
  if (record.claude.settingSourcesAuthOk === false) return 'wird nicht verwendet: die Live-Prüfung damit schlug fehl (A-08)';
  return 'wird nicht verwendet, bis ipa doctor --live die Anmeldung damit bestätigt (A-08)';
}

function describeLive(record: DoctorRecord, report: DoctorReport, requested: boolean): string {
  const live = record.live;
  if (live === null) return requested ? 'nicht ausgeführt, siehe Befunde' : 'nicht ausgeführt (ipa doctor --live)';
  const tools = live.toolsReported.length === 0 ? 'keine' : live.toolsReported.join(', ');
  const servers = live.mcpServersReported.length === 0 ? 'keine' : live.mcpServersReported.join(', ');
  const earlier = report.liveCarriedOver ? ' (frühere Prüfung derselben Version)' : '';
  return `${live.ok ? 'bestanden' : 'nicht bestanden'} am ${live.checkedAt}${earlier}; gemeldete Werkzeuge: ${tools}; MCP-Server: ${servers}`;
}

export function formatDoctorReport(report: DoctorReport, ctx: WorkspaceContext, live: boolean): string {
  const { record } = report;
  const rows: [string, string][] = [
    ['Git', record.git.found ? `gefunden, Version ${record.git.version ?? 'unbekannt'}` : 'nicht gefunden'],
    [
      'Claude Code',
      record.claude.found
        ? `gefunden, Version ${record.claude.version ?? 'unbekannt'}`
        : `nicht gefunden (claude.command ${JSON.stringify(ctx.config.claude.command)})`,
    ],
  ];
  if (record.claude.found) {
    const required = requiredFlags(ctx.config);
    rows.push(
      ['Anmeldung', describeLogin(record)],
      [
        'Pflichtoptionen',
        report.missingFlags.length === 0 ? `alle ${required.length} erkannt` : `nicht erkannt: ${report.missingFlags.join(', ')}`,
      ],
      ['Weitere Optionen', OPTIONAL_FLAGS.map((flag) => `${flag} ${record.claude.flags[flag] === true ? 'ja' : 'nein'}`).join(', ')],
      ['--safe-mode', usesSafeMode(record) ? 'wird verwendet' : 'wird nicht verwendet, weil nicht erkannt'],
      ['--setting-sources', describeSettingSources(record)],
    );
  }
  rows.push(['Live-Prüfung', describeLive(record, report, live)], ['Ergebnis', record.ok ? 'bereit' : 'nicht bereit']);

  const hints: string[] = [];
  if (record.claude.loggedIn === true) {
    hints.push('Hinweis: Ob diese Anmeldung der zugelassene geschäftliche Zugang ist, lässt sich technisch nicht prüfen und ist organisatorisch zu bestätigen (O-02).');
  }
  if (record.live !== null) {
    hints.push(
      `Hinweis: Die Live-Prüfung zeigt, was Claude Code meldet; ${STRUCTURED_OUTPUT_TOOL} dient nur der strukturierten Antwort. ` +
        'Die Optionen sind keine Sandbox und kein Schreibschutz.',
    );
  }
  return formatFields(rows) + hints.map((hint) => `${hint}\n`).join('');
}

/** Short reason for a failed check, for the warning after `init`. */
export function describeProblems(report: DoctorReport, ctx: WorkspaceContext): string {
  const { record } = report;
  const problems: string[] = [];
  if (!record.git.found) problems.push('Git wurde nicht gefunden');
  if (!record.claude.found) {
    problems.push(`Claude Code wurde nicht gefunden (claude.command ${JSON.stringify(ctx.config.claude.command)})`);
  } else {
    if (record.claude.loggedIn !== true) problems.push(record.claude.loggedIn === false ? 'Claude Code ist nicht angemeldet' : 'der Anmeldestatus ist unklar');
    if (report.missingFlags.length > 0) problems.push(`Pflichtoptionen nicht erkannt: ${report.missingFlags.join(', ')}`);
  }
  return problems.length > 0 ? problems.join('; ') : 'unbekannter Grund';
}

/** `ipa init` runs the check without a model call; a failure is only a warning (spec.md §6.3, AK-05-07). */
export async function checkClaudeAfterInit(ctx: WorkspaceContext, io: CliIo): Promise<void> {
  try {
    const report = await probeClaude(ctx, { live: false, env: io.env });
    if (report.record.ok) {
      io.stdout(
        `Claude-Prüfung: bereit (Claude Code ${report.record.claude.version ?? 'unbekannter Version'}, ohne Modellaufruf). ` +
          'Einen echten Aufruf prüft ipa doctor --live.\n',
      );
    } else {
      io.stderr(`${CLAUDE_CHECK_WARNING} ${describeProblems(report, ctx)}. Der Arbeitsbereich ist vollständig angelegt; Details mit ipa doctor.\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? '') : String(error);
    io.stderr(`${CLAUDE_CHECK_WARNING} ${message} Der Arbeitsbereich ist vollständig angelegt; Details mit ipa doctor.\n`);
  }
}

export function registerDoctorCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('doctor')
    .usage('[optionen]')
    .description('Git und Claude Code prüfen (Version, Anmeldung, Optionen), ohne Modellaufruf')
    .option('--live', 'zusätzlich zwei kleine echte Modellaufrufe: Werkzeuge, MCP-Server, strukturierte Antwort (verbraucht Kontingent)')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<DoctorCommandOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      const live = options.live === true;
      const report = await probeClaude(ctx, { live, env: io.env, onNotice: (message) => io.stderr(`${message}\n`) });
      io.stdout(formatDoctorReport(report, ctx, live));
      for (const finding of report.findings) io.stderr(`Befund: ${finding}\n`);
      if (!report.record.ok) io.stderr('Fehler: Die Voraussetzungen für Claude sind nicht erfüllt. Einzelheiten stehen in den Befunden.\n');
      state.exitCode = report.record.ok ? EXIT.ok : EXIT.doctorFailed;
    });
}
