/**
 * Configured test reports (spec.md §9.4, D-17): read directly, without path filter, but always with
 * the content check and the size limit of the snapshot.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { errnoCode } from '../core/errors.js';
import { relativeInside, toPortablePath } from '../core/paths.js';
import type { TestReportRef } from './types.js';
import { isBinaryContent, sha256Hex } from './worktree.js';

export interface ObservedReport {
  /** Relative to the repository root if inside, otherwise absolute; always with `/`. */
  path: string;
  label: string;
  size: number;
  sha256: string;
  mtimeMs: number;
  binary: boolean;
  /** Null when the file exceeds `maxFileBytes`; only its hash is known then. */
  content: Buffer | null;
}

async function hashStream(file: string): Promise<{ sha256: string; binary: boolean }> {
  const hash = createHash('sha256');
  let probe: Buffer | null = null;
  for await (const chunk of createReadStream(file)) {
    const bytes = chunk as Buffer;
    probe ??= bytes;
    hash.update(bytes);
  }
  return { sha256: hash.digest('hex'), binary: probe !== null && isBinaryContent(probe) };
}

export function reportDisplayPath(repoRoot: string, configured: string): { absolute: string; display: string } {
  const absolute = path.resolve(repoRoot, configured);
  const portable = toPortablePath(absolute);
  return { absolute, display: relativeInside(portable, repoRoot) ?? portable };
}

/** Existing reports in configuration order; a missing or unreadable report is simply absent. */
export async function readTestReports(
  repoRoot: string,
  entries: readonly { path: string; label: string }[],
  maxFileBytes: number,
): Promise<ObservedReport[]> {
  const reports: ObservedReport[] = [];
  for (const entry of entries) {
    const { absolute, display } = reportDisplayPath(repoRoot, entry.path);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) continue;
      if (info.size > maxFileBytes) {
        const { sha256, binary } = await hashStream(absolute);
        reports.push({ path: display, label: entry.label, size: info.size, sha256, mtimeMs: info.mtimeMs, binary, content: null });
        continue;
      }
      const content = await readFile(absolute);
      reports.push({
        path: display,
        label: entry.label,
        size: content.length,
        sha256: sha256Hex(content),
        mtimeMs: info.mtimeMs,
        binary: isBinaryContent(content),
        content,
      });
    } catch (error) {
      const code = errnoCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM' || code === 'EISDIR') continue;
      throw error;
    }
  }
  return reports;
}

/** Consistency check (spec.md §11.2) for test reports. */
export function sameReports(a: readonly ObservedReport[], b: readonly ObservedReport[]): boolean {
  return a.length === b.length && a.every((report, index) => report.path === b[index]!.path && report.sha256 === b[index]!.sha256);
}

/** New or different from the comparison base of the previous snapshot (spec.md §11.3). */
export function changedReports(reports: readonly ObservedReport[], previous: readonly TestReportRef[]): ObservedReport[] {
  const known = new Map(previous.map((ref) => [ref.path, ref.sha256]));
  return reports.filter((report) => known.get(report.path) !== report.sha256);
}

/** D-17: fresh if the modification time lies in `(from, to]` of the observed period. */
export function isFresh(mtimeMs: number, from: string | null, to: Date): boolean {
  const lower = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
  return mtimeMs > lower && mtimeMs <= to.getTime();
}
