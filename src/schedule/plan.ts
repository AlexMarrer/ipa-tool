/**
 * Run plan of the schedule (package 09 §4.3): the start times of a workday and the upper bound of Claude
 * calls per day. One function serves the templates, `schedule status|install` and `config check|set`.
 */
import type { Weekday } from '../core/config.js';
import { type ScheduleConfig, sortedWorkdays } from './window.js';

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}

export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function windowMinutes(schedule: ScheduleConfig): number {
  return minutesOf(schedule.windowEnd) - minutesOf(schedule.windowStart);
}

/** Windows repeats only if at least one repetition fits into the window. */
export function repeats(schedule: ScheduleConfig): boolean {
  return schedule.intervalMinutes <= windowMinutes(schedule);
}

/** Start times of a workday: the window start, every interval up to and including the window end, and the extra runs. */
export function runTimesOfDay(schedule: ScheduleConfig): string[] {
  const start = minutesOf(schedule.windowStart);
  const end = minutesOf(schedule.windowEnd);
  const times = new Set<number>();
  for (let minute = start; minute <= end; minute += schedule.intervalMinutes) times.add(minute);
  for (const extra of schedule.extraRunTimes) times.add(minutesOf(extra));
  return [...times].sort((a, b) => a - b).map(timeOf);
}

export interface SchedulePlan {
  workdays: Weekday[];
  /** Start times of a workday inside the window, ascending, without duplicates. */
  runTimes: string[];
  /** Extra runs outside the window: `capture --scheduled` skips them, so they never call Claude. */
  skippedRunTimes: string[];
  runsPerDay: number;
  /** A run lies exactly on `windowEnd`; whether Windows starts it is not observed, so it counts. */
  includesWindowEndRun: boolean;
  maxAnalysesPerRun: number;
  /** `runsPerDay` times `maxAnalysesPerRun`; a run without new work calls Claude not at all. */
  maxClaudeCallsPerDay: number;
}

export function planSchedule(schedule: ScheduleConfig, maxAnalysesPerRun: number): SchedulePlan {
  const workdays = sortedWorkdays(schedule);
  const all = runTimesOfDay(schedule);
  const inside = all.filter((time) => time >= schedule.windowStart && time <= schedule.windowEnd);
  const runsPerDay = workdays.length === 0 ? 0 : inside.length;
  return {
    workdays,
    runTimes: inside,
    skippedRunTimes: all.filter((time) => time < schedule.windowStart || time > schedule.windowEnd),
    runsPerDay,
    includesWindowEndRun: workdays.length > 0 && inside.includes(schedule.windowEnd),
    maxAnalysesPerRun,
    maxClaudeCallsPerDay: runsPerDay * maxAnalysesPerRun,
  };
}
