import type { NoteView, TimeView } from '../../shared/views';

/**
 * Day times from the notes only (app spec §5.6, CLI spec §15, I-07): measured and estimated stay apart,
 * planning notes are shown separately, delays are never added to the time, and no total exists.
 */
export function summarizeTime(notes: readonly Pick<NoteView, 'type' | 'time' | 'delay'>[]): TimeView {
  const view: TimeView = {
    time: { measured: 0, estimated: 0 },
    planned: { measured: 0, estimated: 0 },
    delays: { measured: 0, estimated: 0 },
    withoutTime: 0,
  };
  for (const note of notes) {
    if (note.time === null) view.withoutTime += 1;
    else (note.type === 'plan' ? view.planned : view.time)[note.time.basis] += note.time.minutes;
    if (note.delay !== null) view.delays[note.delay.basis] += note.delay.minutes;
  }
  return view;
}
