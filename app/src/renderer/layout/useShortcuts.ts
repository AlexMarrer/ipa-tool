import { useEffect } from 'react';

export interface ShortcutHandlers {
  onNewNote: () => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  /** `←` and `→` only count in the day view. */
  dayKeysActive: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Ctrl+N, ← and → (spec §8.1). Esc is handled by dialogs and popovers themselves. */
export function useShortcuts({ onNewNote, onPreviousDay, onNextDay, dayKeysActive }: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onNewNote();
        return;
      }
      if (!dayKeysActive || event.ctrlKey || event.altKey || event.metaKey || isEditable(event.target)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (event.key === 'ArrowLeft') onPreviousDay();
      else if (event.key === 'ArrowRight') onNextDay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onNewNote, onPreviousDay, onNextDay, dayKeysActive]);
}
