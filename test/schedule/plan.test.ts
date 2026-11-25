import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { planSchedule, runTimesOfDay } from '../../src/schedule/plan.js';
import { renderCron, renderWindowsTask, type ScheduleTemplateInput } from '../../src/schedule/templates.js';
import { parseXml, textAt } from '../helpers/xml.js';

const DEFAULTS = createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' });
const schedule = (overrides: Partial<typeof DEFAULTS.schedule> = {}) => ({ ...DEFAULTS.schedule, ...overrides });

function templateInput(overrides: Partial<typeof DEFAULTS.schedule> = {}): ScheduleTemplateInput {
  return {
    repositoryId: 'projekt-3fa9c1',
    repoPath: 'C:/GIT/projekt',
    timezone: 'Europe/Zurich',
    schedule: schedule(overrides),
    maxRunSeconds: 1800,
    claudeTimeoutSeconds: 600,
    nodePath: 'C:\\Programme\\nodejs\\node.exe',
    cliPath: 'C:\\Tool\\dist\\cli.js',
    dataDir: null,
    startDay: '2026-10-06',
  };
}

describe('planSchedule (AK-09-11)', () => {
  it('liefert für die Standardwerte 7 Läufe und höchstens 35 Claude-Aufrufe pro Arbeitstag', () => {
    expect(planSchedule(DEFAULTS.schedule, DEFAULTS.claude.maxAnalysesPerRun)).toEqual({
      workdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      runTimes: ['08:00', '10:00', '12:00', '14:00', '16:00', '17:45', '18:00'],
      skippedRunTimes: [],
      runsPerDay: 7,
      includesWindowEndRun: true,
      maxAnalysesPerRun: 5,
      maxClaudeCallsPerDay: 35,
    });
  });

  it('zählt einen Lauf genau auf windowEnd vorsichtig mit und kennzeichnet ihn', () => {
    const onEnd = planSchedule(schedule({ extraRunTimes: [] }), 5);
    expect(onEnd.runTimes).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
    expect(onEnd.includesWindowEndRun).toBe(true);
    expect(onEnd.maxClaudeCallsPerDay).toBe(30);

    const before = planSchedule(schedule({ extraRunTimes: [], intervalMinutes: 180 }), 5);
    expect(before.runTimes).toEqual(['08:00', '11:00', '14:00', '17:00']);
    expect(before.includesWindowEndRun).toBe(false);
  });

  it('zählt Zusatzläufe ausserhalb des Fensters nicht mit, weil capture --scheduled sie überspringt', () => {
    const plan = planSchedule(schedule({ extraRunTimes: ['07:30', '17:45', '18:30'] }), 3);
    expect(plan.runTimes).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '17:45', '18:00']);
    expect(plan.skippedRunTimes).toEqual(['07:30', '18:30']);
    expect(plan.runsPerDay).toBe(7);
    expect(plan.maxClaudeCallsPerDay).toBe(21);
  });

  it('führt doppelte Startzeiten nur einmal auf', () => {
    const plan = planSchedule(schedule({ extraRunTimes: ['10:00', '08:00'] }), 5);
    expect(plan.runTimes).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
  });

  it('startet bei einem Intervall länger als das Fenster nur zum Fensterbeginn und zu den Zusatzläufen', () => {
    const plan = planSchedule(schedule({ intervalMinutes: 720 }), 5);
    expect(plan.runTimes).toEqual(['08:00', '17:45']);
    expect(plan.maxClaudeCallsPerDay).toBe(10);
  });

  it('plant ohne Arbeitstage keinen Lauf', () => {
    const plan = planSchedule(schedule({ workdays: [] }), 5);
    expect(plan).toMatchObject({ workdays: [], runsPerDay: 0, maxClaudeCallsPerDay: 0, includesWindowEndRun: false });
  });

  it('sortiert die Arbeitstage mit Montag zuerst', () => {
    expect(planSchedule(schedule({ workdays: ['sun', 'wed', 'mon'] }), 1).workdays).toEqual(['mon', 'wed', 'sun']);
  });

  it('stimmt mit den Startzeiten der Vorlagen überein (gemeinsame Funktion)', () => {
    const input = templateInput({ extraRunTimes: ['07:30', '17:45', '18:30'] });
    const plan = planSchedule(input.schedule, 5);
    expect([...plan.runTimes, ...plan.skippedRunTimes].sort()).toEqual(runTimesOfDay(input.schedule));

    const root = parseXml(renderWindowsTask(input, { encoding: null })).root;
    const starts = root.children
      .find((child) => child.name === 'Triggers')!
      .children.map((trigger) => textAt(trigger, 'StartBoundary')!.slice(11, 16));
    // One trigger per workday at the window start, one per extra run: the repetition covers the intervals.
    expect(starts.slice(5)).toEqual(['07:30', '17:45', '18:30']);
    expect(new Set(starts.slice(0, 5))).toEqual(new Set(['08:00']));

    const cron = renderCron(input);
    for (const time of runTimesOfDay(input.schedule)) {
      const [hours, minutes] = time.split(':').map(Number);
      expect(cron).toMatch(new RegExp(`^${minutes} (?:[0-9]+,)*${hours}(?:,[0-9]+)* \\* \\* 1-5 `, 'm'));
    }
  });
});
