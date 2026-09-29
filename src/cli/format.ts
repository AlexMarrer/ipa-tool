/**
 * Lesbare Ausgabe des CLI.
 */
import type { WorkspaceMode } from '../core/registry.js';

/** Schlüssel-Wert-Liste mit bündigen Werten. */
export function formatFields(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, value]) => `${`${label}:`.padEnd(width)}${value}\n`).join('');
}

export function describeWorkspaceMode(mode: WorkspaceMode, insideRepo: boolean): string {
  if (mode === 'default') return 'Standard (Datenwurzel, ausserhalb des Repositorys)';
  return insideRepo ? 'ausdrücklich gewählt (im Repository)' : 'ausdrücklich gewählt (ausserhalb des Repositorys)';
}
