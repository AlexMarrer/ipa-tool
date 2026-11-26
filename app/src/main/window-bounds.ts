import type { AppState } from '../shared/types';
import { MIN_HEIGHT, MIN_WIDTH } from './app-state';

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Saved bounds are used only if they still touch a display (spec §8.1: minimum size 1100 x 700). */
export function fitBounds(saved: AppState['window'], displays: Area[]): Partial<Area> & { width: number; height: number } {
  const size = { width: Math.max(MIN_WIDTH, saved.width), height: Math.max(MIN_HEIGHT, saved.height) };
  if (saved.x === null || saved.y === null) return size;
  const rect = { x: saved.x, y: saved.y, ...size };
  const visible = displays.some(
    (area) => rect.x < area.x + area.width - 40 && rect.x + rect.width > area.x + 40 && rect.y >= area.y - 10 && rect.y < area.y + area.height - 40,
  );
  return visible ? rect : size;
}
