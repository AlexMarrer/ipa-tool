import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSystemTheme } from '../../src/renderer/theme/useTheme';

function Probe() {
  useSystemTheme();
  return null;
}

function mockMatchMedia(initialDark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initialDark,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    setDark(value: boolean) {
      query.matches = value;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Theme folgt Windows (AK-10-11)', () => {
  it('startet mit der Windows-Einstellung und wechselt zur Laufzeit', () => {
    const media = mockMatchMedia(true);
    render(<Probe />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    act(() => media.setDark(false));
    expect(document.documentElement.dataset['theme']).toBe('light');
    act(() => media.setDark(true));
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('meldet den Beobachter beim Entfernen ab', () => {
    const media = mockMatchMedia(false);
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('bleibt hell, wenn keine Einstellung ermittelbar ist', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<Probe />);
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
