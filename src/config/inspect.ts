/**
 * Findings about a `config.json` (package 09 §4.2): schema, rules of spec.md §7.2, the match with the
 * registry entry and the content rules of the schedule. A finding of severity `error` blocks writing.
 */
import { type Config, checkConfigRules } from '../core/config.js';
import { samePath } from '../core/paths.js';
import { type SchemaIssue, unsupportedSchemaVersion, validate } from '../core/schemas.js';
import { type ScheduleFinding, scheduleFindings } from '../schedule/templates.js';

export interface ConfigFinding {
  severity: 'error' | 'warning';
  code: string;
  /** JSON pointer such as `/schedule/windowStart`, or `/` for the file. */
  path: string;
  message: string;
  /** Prefix of the line on stderr. */
  label: 'Fehler' | 'Warnung' | 'Hinweis';
}

export interface ExpectedIdentity {
  repositoryId: string;
  repoPath: string;
}

export interface Inspection {
  findings: ConfigFinding[];
  /** The value typed as `Config`, only if it passed the schema. */
  config: Config | null;
}

export function hasErrors(findings: readonly ConfigFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}

function error(code: string, path: string, message: string): ConfigFinding {
  return { severity: 'error', code, path, message, label: 'Fehler' };
}

function ruleCode(issue: SchemaIssue): string {
  if (issue.path === '/timezone') return 'timezone_unknown';
  if (issue.path.startsWith('/secrets/extraPatterns/')) return 'pattern_invalid';
  if (issue.path === '/schedule/windowStart') return 'window_order';
  return 'config_rule';
}

function fromSchedule(finding: ScheduleFinding): ConfigFinding {
  return { severity: finding.severity, code: finding.code, path: finding.path, message: finding.message, label: finding.label };
}

/** Checks a parsed value; never throws. `expected` adds the match with the registry entry. */
export function inspectConfig(value: unknown, expected?: ExpectedIdentity): Inspection {
  const version = unsupportedSchemaVersion(value);
  if (version !== null) {
    return {
      findings: [error('schema_version_unsupported', '/schemaVersion', `Die Schemaversion ${version} ist unbekannt; V1 liest nur Schemaversion 1.`)],
      config: null,
    };
  }
  const schema = validate('config', value);
  if (!schema.ok) {
    return { findings: schema.issues.map((issue) => error('schema_invalid', issue.path, issue.message)), config: null };
  }
  const config = value as Config;
  const findings: ConfigFinding[] = checkConfigRules(config).map((issue) => error(ruleCode(issue), issue.path, issue.message));
  if (expected !== undefined) {
    if (config.repositoryId !== expected.repositoryId) {
      findings.push(error('config_mismatch', '/repositoryId', `Die repositoryId gehört nicht zum registrierten Repository (erwartet ${expected.repositoryId}).`));
    }
    if (!samePath(config.repository.path, expected.repoPath)) {
      findings.push(error('config_mismatch', '/repository/path', `Der Repository-Pfad gehört nicht zum registrierten Repository (erwartet ${expected.repoPath}).`));
    }
  }
  findings.push(
    ...scheduleFindings({
      schedule: config.schedule,
      maxRunSeconds: config.limits.maxRunSeconds,
      claudeTimeoutSeconds: config.claude.timeoutSeconds,
    }).map(fromSchedule),
  );
  return { findings, config };
}

export function formatFinding(finding: ConfigFinding): string {
  return `${finding.label}: ${finding.path === '/' ? '' : `${finding.path}: `}${finding.message}`;
}

export function formatFindings(findings: readonly ConfigFinding[]): string {
  return findings.map(formatFinding).join('; ');
}
