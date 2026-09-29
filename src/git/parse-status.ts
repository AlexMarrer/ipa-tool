/**
 * Parsers for `git status --porcelain=v2 -z` and `git ls-files -s -z`.
 */

export interface OrdinaryEntry {
  type: 'ordinary';
  /** Two letters: index vs. HEAD, then worktree vs. index; `.` means unchanged. */
  xy: string;
  /** `N...` for regular files, `S<c><m><u>` for submodules. */
  sub: string;
  modes: { head: string; index: string; worktree: string };
  blobs: { head: string; index: string };
  path: string;
}

export interface RenamedEntry extends Omit<OrdinaryEntry, 'type'> {
  type: 'renamed';
  score: string;
  origPath: string;
}

export interface UnmergedEntry {
  type: 'unmerged';
  xy: string;
  sub: string;
  modes: { stage1: string; stage2: string; stage3: string; worktree: string };
  blobs: { stage1: string; stage2: string; stage3: string };
  path: string;
}

export interface UntrackedEntry {
  type: 'untracked';
  path: string;
}

export interface IgnoredEntry {
  type: 'ignored';
  path: string;
}

export type StatusEntry = OrdinaryEntry | RenamedEntry | UnmergedEntry | UntrackedEntry | IgnoredEntry;

export interface IndexEntry {
  mode: string;
  blob: string;
  stage: number;
  path: string;
}

export const NULL_MODE = '000000';

export function isNullObjectId(id: string): boolean {
  return /^0+$/.test(id);
}

function toText(output: Buffer | string): string {
  return typeof output === 'string' ? output : output.toString('utf8');
}

/** Splits off `count` space-separated fields; the remainder is the path, which may contain spaces. */
function fields(record: string, count: number): { values: string[]; rest: string } {
  const values: string[] = [];
  let position = 0;
  for (let i = 0; i < count; i += 1) {
    const next = record.indexOf(' ', position);
    if (next < 0) throw new Error(`Unerwartete Git-Ausgabe: zu wenige Felder in "${record.slice(0, 80)}"`);
    values.push(record.slice(position, next));
    position = next + 1;
  }
  return { values, rest: record.slice(position) };
}

export function parseStatusV2Z(output: Buffer | string): StatusEntry[] {
  const tokens = toText(output).split('\0');
  const entries: StatusEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const record = tokens[i] ?? '';
    if (record === '' || record.startsWith('#')) continue;
    const marker = record.slice(0, 2);
    if (marker === '1 ') {
      const { values, rest } = fields(record.slice(2), 7);
      const [xy, sub, mH, mI, mW, hH, hI] = values as [string, string, string, string, string, string, string];
      entries.push({ type: 'ordinary', xy, sub, modes: { head: mH, index: mI, worktree: mW }, blobs: { head: hH, index: hI }, path: rest });
    } else if (marker === '2 ') {
      const { values, rest } = fields(record.slice(2), 8);
      const [xy, sub, mH, mI, mW, hH, hI, score] = values as [string, string, string, string, string, string, string, string];
      const origPath = tokens[i + 1];
      if (origPath === undefined) throw new Error('Unerwartete Git-Ausgabe: Ursprungspfad einer Umbenennung fehlt');
      i += 1;
      entries.push({
        type: 'renamed',
        xy,
        sub,
        modes: { head: mH, index: mI, worktree: mW },
        blobs: { head: hH, index: hI },
        score,
        path: rest,
        origPath,
      });
    } else if (marker === 'u ') {
      const { values, rest } = fields(record.slice(2), 9);
      const [xy, sub, m1, m2, m3, mW, h1, h2, h3] = values as [string, string, string, string, string, string, string, string, string];
      entries.push({
        type: 'unmerged',
        xy,
        sub,
        modes: { stage1: m1, stage2: m2, stage3: m3, worktree: mW },
        blobs: { stage1: h1, stage2: h2, stage3: h3 },
        path: rest,
      });
    } else if (marker === '? ') {
      entries.push({ type: 'untracked', path: record.slice(2) });
    } else if (marker === '! ') {
      entries.push({ type: 'ignored', path: record.slice(2) });
    } else {
      throw new Error(`Unerwartete Git-Ausgabe von status: "${record.slice(0, 80)}"`);
    }
  }
  return entries;
}

/** Format per record: `<mode> <object> <stage>\t<path>`. */
export function parseLsFilesStageZ(output: Buffer | string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const record of toText(output).split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode, blob, stage] = record.slice(0, tab).split(' ');
    if (tab < 0 || mode === undefined || blob === undefined || stage === undefined) {
      throw new Error(`Unerwartete Git-Ausgabe von ls-files: "${record.slice(0, 80)}"`);
    }
    entries.push({ mode, blob, stage: Number(stage), path: record.slice(tab + 1) });
  }
  return entries;
}
