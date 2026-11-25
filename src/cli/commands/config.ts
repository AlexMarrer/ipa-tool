/**
 * `ipa config get|check|set` (package 09 §4.2): reads, checks and atomically writes `config.json`.
 * No lock and no entry in `runs.jsonl`; a running capture keeps the configuration it started with.
 */
import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { type ConfigFinding, formatFinding, hasErrors, inspectConfig } from '../../config/inspect.js';
import { applyAssignments, type ConfigChange, enablesPaidUsage, immutableFindings, parseAssignment, readPath, scheduleSettingsChanged } from '../../config/patch.js';
import { type Config, configPath, writeConfig } from '../../core/config.js';
import { systemClock } from '../../core/clock.js';
import { locateRepository, notInitializedError, resolveContext } from '../../core/context.js';
import { EXIT, IpaError } from '../../core/errors.js';
import { createRunId } from '../../core/ids.js';
import { describeJsonSyntaxError, stripBom } from '../../core/json.js';
import { shortRunError } from '../../core/run-log.js';
import { workspaceMissingError, workspacePresent } from '../../core/workspace.js';
import { planSchedule, type SchedulePlan, zonesOf } from '../../schedule/plan.js';
import { type ActionReport, type Emitter, jsonPath, runAction } from '../action.js';
import type { CliDeps } from '../deps.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

interface ConfigCliOptions extends GlobalOptions {
  json?: boolean;
  dryRun?: boolean;
  confirmPaidUsage?: boolean;
}

type ConfigAction = 'get' | 'check' | 'set';

function publicFinding(finding: ConfigFinding): object {
  return { severity: finding.severity, code: finding.code, path: finding.path, message: finding.message };
}

function planOf(config: Config | null, findings: readonly ConfigFinding[]): SchedulePlan | null {
  if (config === null || findings.some((finding) => finding.code === 'window_order')) return null;
  return planSchedule(config.schedule, config.claude.maxAnalysesPerRun, zonesOf(config.timezone));
}

function describePlan(plan: SchedulePlan): string {
  if (plan.workdays.length === 0) return 'keine Arbeitstage, keine Läufe';
  return `${plan.runTimes.join(', ')} (${plan.runsPerDay} Läufe); höchstens ${plan.maxClaudeCallsPerDay} Claude-Aufrufe pro Arbeitstag`;
}

function errorsOf(findings: readonly ConfigFinding[]): { code: string; message: string }[] {
  return findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => shortRunError(finding.code, finding.path === '/' ? finding.message : `${finding.path}: ${finding.message}`));
}

/** Warnings go to stderr and into `warnings`, errors only to stderr (they are also in `errors`). */
function printFindings(out: Emitter, findings: readonly ConfigFinding[]): void {
  for (const finding of findings) {
    if (finding.severity === 'warning') out.warn(formatFinding(finding));
    else out.stderr(`${formatFinding(finding)}\n`);
  }
}

async function readConfigFile(file: string): Promise<{ text: string; value: unknown }> {
  const text = await readFile(file, 'utf8').catch((error: unknown) => {
    throw new IpaError('file_unreadable', EXIT.usage, `config.json ist nicht lesbar: ${file} (${(error as NodeJS.ErrnoException).code ?? 'unbekannter Fehler'}).`, {
      cause: error,
    });
  });
  try {
    return { text, value: JSON.parse(stripBom(text)) };
  } catch (error) {
    throw new IpaError('json_invalid', EXIT.usage, `Kein gültiges JSON in ${file} (${describeJsonSyntaxError(error)}).`, { cause: error });
  }
}

async function get(options: ConfigCliOptions, out: Emitter, pathArgument: string | undefined): Promise<ActionReport> {
  const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
  out.runId = ctx.runId;
  const value = pathArgument === undefined ? ctx.config : readPath(ctx.config, pathArgument);
  return {
    exitCode: EXIT.ok,
    result: {
      action: 'get',
      configPath: jsonPath(configPath(ctx.workspaceDir)),
      path: pathArgument ?? null,
      value,
      valid: null,
      findings: [],
      changes: [],
      written: false,
      dryRun: false,
      schedulePlan: null,
    },
    print: () => out.stdout(`${JSON.stringify(value, null, 2)}\n`),
  };
}

async function check(options: ConfigCliOptions, out: Emitter): Promise<ActionReport> {
  const location = await locateRepository({ repo: options.repo, dataDir: options.dataDir });
  if (location.entry === null) throw notInitializedError(location);
  if (!(await workspacePresent(location.entry))) throw workspaceMissingError(location.entry, location.dataRoot.path);
  out.runId = createRunId(systemClock);
  const file = configPath(location.entry.workspacePath);
  let inspection: ReturnType<typeof inspectConfig>;
  try {
    inspection = inspectConfig((await readConfigFile(file)).value, { repositoryId: location.entry.repositoryId, repoPath: location.repo.root });
  } catch (error) {
    if (!(error instanceof IpaError) || error.code !== 'json_invalid') throw error;
    inspection = { findings: [{ severity: 'error', code: 'json_invalid', path: '/', message: error.message, label: 'Fehler' }], config: null };
  }
  const { findings, config } = inspection;
  const valid = !hasErrors(findings);
  const plan = planOf(config, findings);
  return {
    exitCode: valid ? EXIT.ok : EXIT.usage,
    errors: errorsOf(findings),
    result: {
      action: 'check',
      configPath: jsonPath(file),
      path: null,
      value: null,
      valid,
      findings: findings.map(publicFinding),
      changes: [],
      written: false,
      dryRun: false,
      schedulePlan: plan,
    },
    print: () => {
      const errors = findings.filter((finding) => finding.severity === 'error').length;
      const warnings = findings.length - errors;
      out.stdout(valid ? `config.json ist gültig${warnings > 0 ? ` (${warnings} Warnung${warnings === 1 ? '' : 'en'})` : ''}.\n` : `config.json ist ungültig (${errors} Fehler, ${warnings} Warnungen).\n`);
      if (plan !== null) out.stdout(`Läufe pro Arbeitstag: ${describePlan(plan)}\n`);
      printFindings(out, findings);
    },
  };
}

const PAID_USAGE_REQUIRED: ConfigFinding = {
  severity: 'error',
  code: 'paid_usage_confirmation_required',
  path: '/claude/allowPaidUsage',
  label: 'Fehler',
  message:
    'Das Einschalten von claude.allowPaidUsage braucht das ausdrückliche Flag --confirm-paid-usage. Mit dieser Einstellung darf ipa Claude ' +
    'auch über API-Schlüssel und externe Anbieter aufrufen, und dabei können Kosten pro Anfrage entstehen.',
};

async function set(options: ConfigCliOptions, out: Emitter, assignmentArguments: readonly string[], deps: CliDeps): Promise<ActionReport> {
  const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
  out.runId = ctx.runId;
  const file = configPath(ctx.workspaceDir);
  const original = await readConfigFile(file);
  const { candidate, changes } = applyAssignments(original.value, assignmentArguments.map(parseAssignment));
  const inspection = inspectConfig(candidate, { repositoryId: ctx.repositoryId, repoPath: ctx.repoRoot });
  const findings: ConfigFinding[] = [...immutableFindings(original.value, candidate), ...inspection.findings];
  const enabling = enablesPaidUsage(original.value, candidate);
  if (enabling && options.confirmPaidUsage !== true) findings.unshift(PAID_USAGE_REQUIRED);
  const valid = !hasErrors(findings);
  const dryRun = options.dryRun === true;
  let written = false;
  if (valid && !dryRun && inspection.config !== null) {
    await deps.beforeConfigWrite?.();
    // Only the content that was checked may be replaced (package 09 §4.2).
    if ((await readFile(file, 'utf8')) !== original.text) {
      throw new IpaError('config_changed', EXIT.usage, 'config.json hat sich während der Prüfung geändert und wurde nicht ersetzt. Bitte den Befehl erneut ausführen.');
    }
    await writeConfig(ctx.workspaceDir, inspection.config);
    written = true;
  }
  const plan = planOf(inspection.config, findings);
  const paths = changes.map((change: ConfigChange) => change.path).join(', ');
  return {
    exitCode: valid ? EXIT.ok : EXIT.usage,
    errors: errorsOf(findings),
    result: {
      action: 'set',
      configPath: jsonPath(file),
      path: null,
      value: null,
      valid,
      findings: findings.map(publicFinding),
      changes,
      written,
      dryRun,
      schedulePlan: plan,
    },
    print: () => {
      printFindings(out, findings);
      if (!valid) {
        out.stderr('Fehler: config.json wurde nicht geändert.\n');
        return;
      }
      out.stdout(written ? `config.json aktualisiert: ${paths}.\n` : `Nur geprüft (--dry-run), config.json ist unverändert: ${paths}.\n`);
      if (plan !== null) out.stdout(`Läufe pro Arbeitstag: ${describePlan(plan)}\n`);
      if (enabling) {
        out.warn('Warnung: claude.allowPaidUsage ist aktiv: API-Schlüssel und externe Anbieter dürfen genutzt werden und können Kosten pro Anfrage verursachen.');
      }
      if (written && inspection.config !== null && scheduleSettingsChanged(ctx.config, inspection.config)) {
        out.warn(
          'Hinweis: Eine bereits eingerichtete Aufgabe der Aufgabenplanung bleibt unverändert. ' +
            'ipa schedule status zeigt Abweichungen, ipa schedule install --update gleicht sie ab.',
        );
      }
    },
  };
}

export function registerConfigCommand(program: Command, io: CliIo, state: CliState, deps: CliDeps = {}): void {
  const config = program
    .command('config')
    .usage('<unterbefehl>')
    .helpCommand(false)
    .description('config.json des Repositorys lesen (get), prüfen (check) und ändern (set)');

  const run = (action: ConfigAction, command: Command, body: (options: ConfigCliOptions, out: Emitter) => Promise<ActionReport>): Promise<void> => {
    const options = command.optsWithGlobals<ConfigCliOptions>();
    return runAction({ command: 'config', json: options.json === true, io, state }, (out) => body(options, out));
  };

  config
    .command('get')
    .usage('[pfad] [optionen]')
    .description('config.json oder einen Wert daraus ausgeben, zum Beispiel claude.maxAnalysesPerRun')
    .argument('[pfad]', 'Feldnamen mit Punkten, zum Beispiel schedule.workdays; ohne Pfad die ganze Datei')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action((pathArgument: string | undefined, _options: unknown, command: Command) => run('get', command, (options, out) => get(options, out, pathArgument)));

  config
    .command('check')
    .usage('[optionen]')
    .description('config.json prüfen: Schema, Regeln, Zeitplan; auch eine ungültige Datei wird gemeldet')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action((_options: unknown, command: Command) => run('check', command, (options, out) => check(options, out)));

  config
    .command('set')
    .usage('<pfad=wert>... [optionen]')
    .description('Felder von config.json ändern; geprüft und atomar geschrieben, bei einem Fehler bleibt die Datei unverändert')
    .argument('<zuweisungen...>', 'pfad=wert; der Wert ist JSON (60, true, ["mon"]), sonst Text')
    .option('--dry-run', 'nur prüfen, nichts schreiben')
    .option('--confirm-paid-usage', 'erlaubt, claude.allowPaidUsage auf true zu setzen (kostenpflichtige Nutzung)')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action((assignments: string[], _options: unknown, command: Command) => run('set', command, (options, out) => set(options, out, assignments, deps)));
}
