/**
 * Business timestamps come only from an injected `Clock` (spec.md §4.3).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
