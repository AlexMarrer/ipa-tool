/**
 * Injizierbare Uhr (spec.md §4.3, §10). Fachliche Zeitstempel entstehen nur über eine `Clock`.
 */
export interface Clock {
  now(): Date;
}

/** Systemuhr für das ausgelieferte CLI. */
export const systemClock: Clock = {
  now: () => new Date(),
};
