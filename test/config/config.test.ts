import { describe, expect, it } from 'vitest';
import { hasErrors, inspectConfig } from '../../src/config/inspect.js';
import { applyAssignments, enablesPaidUsage, immutableFindings, parseAssignment, readPath, scheduleSettingsChanged } from '../../src/config/patch.js';
import { type Config, createDefaultConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';

const base = (): Config => createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' });
const IDENTITY = { repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt' };
const codes = (value: unknown) => inspectConfig(value, IDENTITY).findings.map((finding) => `${finding.severity}:${finding.code}:${finding.path}`);

describe('Befunde einer Konfiguration (AK-09-07)', () => {
  it('findet in der Standardkonfiguration nichts', () => {
    const { findings, config } = inspectConfig(base(), IDENTITY);
    expect(findings).toEqual([]);
    expect(config).not.toBeNull();
  });

  it('meldet Schemafehler mit JSON-Pfad und liefert dann keine typisierte Konfiguration', () => {
    const broken = { ...base(), limits: { ...base().limits, maxFileBytes: 0 }, extra: true } as unknown;
    const { findings, config } = inspectConfig(broken, IDENTITY);
    expect(config).toBeNull();
    expect(findings.map((finding) => [finding.code, finding.path])).toEqual(
      expect.arrayContaining([
        ['schema_invalid', '/extra'],
        ['schema_invalid', '/limits/maxFileBytes'],
      ]),
    );
    expect(hasErrors(findings)).toBe(true);
  });

  it('meldet eine unbekannte Schemaversion, eine falsche Zeitzone, ein ungültiges Muster und die Fensterreihenfolge', () => {
    expect(codes({ ...base(), schemaVersion: 2 })).toEqual(['error:schema_version_unsupported:/schemaVersion']);
    expect(codes({ ...base(), timezone: 'Mars/Olympus' })).toEqual(['error:timezone_unknown:/timezone']);
    expect(codes({ ...base(), secrets: { extraPatterns: ['[offen'], disabledDetectors: [] } })).toEqual(['error:pattern_invalid:/secrets/extraPatterns/0']);
    expect(codes({ ...base(), schedule: { ...base().schedule, windowStart: '18:00', windowEnd: '08:00' } })).toEqual(['error:window_order:/schedule/windowStart']);
  });

  it('meldet, wenn repositoryId oder Pfad nicht zum Registry-Eintrag passen', () => {
    expect(inspectConfig({ ...base(), repositoryId: 'anderes-000000' }, IDENTITY).findings.map((finding) => finding.path)).toEqual(['/repositoryId']);
    expect(inspectConfig({ ...base(), repository: { path: 'C:/GIT/anderes' } }, IDENTITY).findings.map((finding) => finding.code)).toEqual(['config_mismatch']);
    // Case and separator direction do not matter on Windows.
    expect(inspectConfig({ ...base(), repository: { path: process.platform === 'win32' ? 'c:\\git\\projekt' : 'C:/GIT/projekt' } }, IDENTITY).findings).toEqual([]);
    expect(inspectConfig(base()).findings).toEqual([]);
  });

  it('meldet die Zeitplanregeln von ipa schedule mit Schwere und Pfad', () => {
    const withSchedule = (schedule: Partial<Config['schedule']>, rest: Partial<Config> = {}): Config => ({ ...base(), ...rest, schedule: { ...base().schedule, ...schedule } });
    expect(codes(withSchedule({ workdays: [] }))).toEqual(['error:schedule_no_workdays:/schedule/workdays']);
    expect(codes(withSchedule({ extraRunTimes: ['07:30', '17:45', '18:30'] }))).toEqual([
      'warning:schedule_extra_outside_window:/schedule/extraRunTimes/0',
      'warning:schedule_extra_outside_window:/schedule/extraRunTimes/2',
    ]);
    expect(codes(withSchedule({ intervalMinutes: 720 }))).toEqual(['warning:schedule_interval_exceeds_window:/schedule/intervalMinutes']);
    expect(codes({ ...base(), claude: { ...base().claude, timeoutSeconds: 900 } })).toEqual(['warning:claude_timeout_exceeds_reserve:/claude/timeoutSeconds']);
    expect(codes({ ...base(), claude: { ...base().claude, timeoutSeconds: 600 } })).toEqual([]);
    // Warnings do not block.
    expect(hasErrors(inspectConfig(withSchedule({ intervalMinutes: 720 }), IDENTITY).findings)).toBe(false);
  });
});

describe('Zuweisungen (AK-09-08)', () => {
  it('liest den Wert als JSON und sonst als Text', () => {
    expect(parseAssignment('claude.maxTurns=7').value).toBe(7);
    expect(parseAssignment('claude.allowPaidUsage=true').value).toBe(true);
    expect(parseAssignment('claude.model=null').value).toBeNull();
    expect(parseAssignment('claude.model=opus').value).toBe('opus');
    expect(parseAssignment('claude.model="sonnet"').value).toBe('sonnet');
    expect(parseAssignment('schedule.workdays=["mon","tue"]').value).toEqual(['mon', 'tue']);
    expect(parseAssignment('paths.exclude=[]').value).toEqual([]);
    expect(parseAssignment('claude.model=').value).toBe('');
    expect(parseAssignment('a.b=c=d')).toMatchObject({ path: 'a.b', segments: ['a', 'b'], value: 'c=d' });
  });

  it('lehnt ungültige Zuweisungen mit Exit-Code 2 ab', () => {
    for (const bad of ['claude.maxTurns', '=5', 'claude..maxTurns=5', '.claude=5', 'claude.max Turns=5', '__proto__.x=1', '0.a=1', 'a-b=1']) {
      expect(() => parseAssignment(bad), bad).toThrow(IpaError);
    }
    expect(() => parseAssignment('claude.maxTurns')).toThrow(/pfad=wert/);
  });

  it('wendet Zuweisungen auf eine Kopie an und nennt Vorher und Nachher', () => {
    const original = base();
    const { candidate, changes } = applyAssignments(original, [parseAssignment('claude.maxTurns=9'), parseAssignment('schedule.extraRunTimes=[]'), parseAssignment('claude.allowPaidUsage=false')]);
    expect(original.claude.maxTurns).toBe(5);
    expect((candidate as Config).claude.maxTurns).toBe(9);
    expect((candidate as Config).schedule.extraRunTimes).toEqual([]);
    expect(changes).toEqual([
      { path: 'claude.maxTurns', before: 5, after: 9 },
      { path: 'schedule.extraRunTimes', before: ['17:45'], after: [] },
      { path: 'claude.allowPaidUsage', before: false, after: false },
    ]);
  });

  it('legt ein neues Feld auf einem vorhandenen Objekt an, verlangt aber den übrigen Pfad', () => {
    const old = base();
    delete old.claude.allowPaidUsage;
    const { candidate, changes } = applyAssignments(old, [parseAssignment('claude.allowPaidUsage=true')]);
    expect((candidate as Config).claude.allowPaidUsage).toBe(true);
    expect(changes[0]).toEqual({ path: 'claude.allowPaidUsage', before: null, after: true });
    for (const bad of ['gibt.es.nicht=1', 'schedule.workdays.mon=1', 'timezone.x=1', 'constructor.x=1']) {
      expect(() => applyAssignments(base(), [parseAssignment(bad)]), bad).toThrow(/gibt es in config.json nicht/);
    }
  });

  it('liest Werte unter einem Pfad und lehnt unbekannte ab', () => {
    expect(readPath(base(), 'claude.maxAnalysesPerRun')).toBe(5);
    expect(readPath(base(), 'schedule.workdays')).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(readPath(base(), 'claude.model')).toBeNull();
    for (const bad of ['gibt.es.nicht', 'claude.toString', 'schedule.workdays.0', '', 'a b']) expect(() => readPath(base(), bad), bad).toThrow(IpaError);
  });
});

describe('Schutz von Feldern (AK-09-09, AK-09-10)', () => {
  const change = (...assignments: string[]) => applyAssignments(base(), assignments.map(parseAssignment)).candidate;

  it('lässt repositoryId, repository.path, timezone und schemaVersion nicht ändern, auch über einen übergeordneten Pfad', () => {
    const paths = (candidate: unknown) => immutableFindings(base(), candidate).map((finding) => finding.path);
    expect(paths(change('repositoryId=anderes-000000'))).toEqual(['/repositoryId']);
    expect(paths(change('repository.path=C:/GIT/anderes'))).toEqual(['/repository/path']);
    expect(paths(change('repository={"path":"C:/GIT/anderes"}'))).toEqual(['/repository/path']);
    expect(paths(change('timezone=UTC'))).toEqual(['/timezone']);
    expect(paths(change('schemaVersion=2'))).toEqual(['/schemaVersion']);
    // Unchanged values and other fields are allowed.
    expect(paths(change('timezone="Europe/Zurich"', 'claude.maxTurns=2'))).toEqual([]);
    expect(paths(change('repository={"path":"C:/GIT/projekt"}'))).toEqual([]);
    expect(immutableFindings(base(), change('timezone=UTC'))[0]).toMatchObject({ severity: 'error', code: 'config_immutable' });
  });

  it('erkennt nur den Wechsel von nicht wahr auf wahr als Einschalten von allowPaidUsage', () => {
    const missing = base();
    delete missing.claude.allowPaidUsage;
    const on = change('claude.allowPaidUsage=true');
    expect(enablesPaidUsage(base(), on)).toBe(true);
    expect(enablesPaidUsage(missing, on)).toBe(true);
    expect(enablesPaidUsage(base(), change('claude={"command":["claude"],"model":null,"timeoutSeconds":600,"maxTurns":5,"maxAttemptsPerSnapshot":3,"maxAnalysesPerRun":5,"allowPaidUsage":true}'))).toBe(true);
    // Already on, switching off and unrelated changes are not enabling.
    expect(enablesPaidUsage(on, change('claude.allowPaidUsage=true'))).toBe(false);
    expect(enablesPaidUsage(on, applyAssignments(on, [parseAssignment('claude.maxTurns=2')]).candidate)).toBe(false);
    expect(enablesPaidUsage(on, change('claude.allowPaidUsage=false'))).toBe(false);
    expect(enablesPaidUsage(base(), change('claude.maxTurns=2'))).toBe(false);
    // Text or 1 is not true; the schema rejects such a value anyway.
    expect(enablesPaidUsage(base(), change('claude.allowPaidUsage="true"'))).toBe(false);
  });

  it('erkennt, wann die Aufgabe veraltet sein kann', () => {
    const edit = (assignment: string): Config => applyAssignments(base(), [parseAssignment(assignment)]).candidate as Config;
    expect(scheduleSettingsChanged(base(), edit('schedule.intervalMinutes=60'))).toBe(true);
    expect(scheduleSettingsChanged(base(), edit('limits.maxRunSeconds=900'))).toBe(true);
    expect(scheduleSettingsChanged(base(), edit('claude.timeoutSeconds=900'))).toBe(true);
    expect(scheduleSettingsChanged(base(), edit('claude.maxTurns=2'))).toBe(false);
    expect(scheduleSettingsChanged(base(), edit('paths.include=["src/**"]'))).toBe(false);
  });
});
