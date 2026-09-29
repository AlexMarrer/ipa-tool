/**
 * Parsers for `git diff --raw -z`, `git diff --numstat -z` and unified patches, plus C-style path quoting.
 */

export type ChangeLetter = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X';

export interface RawDiffEntry {
  srcMode: string;
  dstMode: string;
  srcBlob: string;
  dstBlob: string;
  status: ChangeLetter;
  /** Similarity for R and C, otherwise null. */
  score: number | null;
  /** Destination path; for deletions the deleted path. */
  path: string;
  /** Source path for R and C, otherwise null. */
  oldPath: string | null;
}

export interface NumstatEntry {
  added: number | null;
  deleted: number | null;
  binary: boolean;
  path: string;
  oldPath: string | null;
}

export interface PatchSection {
  oldPath: string | null;
  newPath: string | null;
  /** Exact bytes of this file's section, starting with `diff --git`. */
  content: Buffer;
}

function toText(output: Buffer | string): string {
  return typeof output === 'string' ? output : output.toString('utf8');
}

function unexpected(command: string, record: string): Error {
  return new Error(`Unerwartete Git-Ausgabe von ${command}: "${record.slice(0, 80)}"`);
}

/** Record format: `:<srcmode> <dstmode> <srcsha> <dstsha> <status>[score]\0<path>\0[<dst path>\0]`. */
export function parseRawZ(output: Buffer | string): RawDiffEntry[] {
  const tokens = toText(output).split('\0');
  const entries: RawDiffEntry[] = [];
  let i = 0;
  // `git show --format=` may emit line breaks before the first record.
  while (i < tokens.length) {
    const header = (tokens[i] ?? '').replace(/^[\n\r]+/, '');
    i += 1;
    if (header === '') continue;
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([ACDMRTUX])(\d*)$/.exec(header);
    if (match === null) throw unexpected('diff --raw', header);
    const [, srcMode, dstMode, srcBlob, dstBlob, letter, score] = match as unknown as [string, string, string, string, string, ChangeLetter, string];
    const first = tokens[i];
    if (first === undefined) throw unexpected('diff --raw', header);
    i += 1;
    let path = first;
    let oldPath: string | null = null;
    if (letter === 'R' || letter === 'C') {
      const second = tokens[i];
      if (second === undefined) throw unexpected('diff --raw', header);
      i += 1;
      oldPath = first;
      path = second;
    }
    entries.push({ srcMode, dstMode, srcBlob, dstBlob, status: letter, score: score === '' ? null : Number(score), path, oldPath });
  }
  return entries;
}

/** Record format: `<added>\t<deleted>\t<path>\0` or, for renames, `<added>\t<deleted>\t\0<old>\0<new>\0`. */
export function parseNumstatZ(output: Buffer | string): NumstatEntry[] {
  const tokens = toText(output).split('\0');
  const entries: NumstatEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const record = tokens[i] ?? '';
    i += 1;
    if (record === '') continue;
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(record);
    if (match === null) throw unexpected('diff --numstat', record);
    const [, added, deleted, rest] = match as unknown as [string, string, string, string];
    let path = rest;
    let oldPath: string | null = null;
    if (rest === '') {
      const from = tokens[i];
      const to = tokens[i + 1];
      if (from === undefined || to === undefined) throw unexpected('diff --numstat', record);
      i += 2;
      oldPath = from;
      path = to;
    }
    const binary = added === '-' && deleted === '-';
    entries.push({
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted),
      binary,
      path,
      oldPath,
    });
  }
  return entries;
}

const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Decodes a path that Git wrote in C quotes (`"a\303\244\"b"`); unquoted input is returned unchanged. */
export function unquoteGitPath(text: string): string {
  if (!(text.length >= 2 && text.startsWith('"') && text.endsWith('"'))) return text;
  const bytes: number[] = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next]!);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Quotes a path like Git's `quote_c_style` with `core.quotepath=off`: only `"`, `\` and control
 * characters force quoting, non-ASCII stays unescaped.
 */
export function quoteGitPath(path: string): string {
  if (!/["\\\x00-\x1f\x7f]/.test(path)) return path;
  const reverse: Record<number, string> = { 7: 'a', 8: 'b', 9: 't', 10: 'n', 11: 'v', 12: 'f', 13: 'r', 34: '"', 92: '\\' };
  let result = '"';
  for (const char of path) {
    const code = char.codePointAt(0)!;
    if (code in reverse) result += `\\${reverse[code]}`;
    else if (code < 0x20 || code === 0x7f) result += `\\${code.toString(8).padStart(3, '0')}`;
    else result += char;
  }
  return `${result}"`;
}

const DIFF_HEADER = Buffer.from('diff --git ');

function lineStarts(buffer: Buffer): number[] {
  const starts: number[] = [];
  let position = 0;
  while (position < buffer.length) {
    if (buffer.subarray(position, position + DIFF_HEADER.length).equals(DIFF_HEADER)) starts.push(position);
    const newline = buffer.indexOf(0x0a, position);
    if (newline < 0) break;
    position = newline + 1;
  }
  return starts;
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Path of a `---`/`+++` line; Git appends a tab when the name contains a space. */
function markerPath(value: string, prefix: string): string | null {
  const trimmed = value.endsWith('\t') ? value.slice(0, -1) : value;
  if (trimmed === '/dev/null') return null;
  return stripPrefix(unquoteGitPath(trimmed), prefix);
}

function closingQuote(text: string): number {
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '"') return i;
  }
  return -1;
}

/**
 * Splits `diff --git a/<x> b/<y>` for sections without rename headers and without `---`/`+++`
 * (mode changes, binary files, empty files). Old and new path are then the same name.
 */
function pathsFromDiffLine(rest: string): { oldPath: string; newPath: string } {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    const left = unquoteGitPath(rest.slice(0, end + 1));
    const right = unquoteGitPath(rest.slice(end + 2));
    return { oldPath: stripPrefix(left, 'a/'), newPath: stripPrefix(right, 'b/') };
  }
  const half = (rest.length - 5) / 2;
  if (Number.isInteger(half) && rest.startsWith('a/') && rest.slice(2 + half) === ` b/${rest.slice(2, 2 + half)}`) {
    const same = rest.slice(2, 2 + half);
    return { oldPath: same, newPath: same };
  }
  const quotedRight = rest.lastIndexOf(' "b/');
  const split = quotedRight >= 0 ? quotedRight : rest.lastIndexOf(' b/');
  return {
    oldPath: stripPrefix(rest.slice(0, split), 'a/'),
    newPath: stripPrefix(unquoteGitPath(rest.slice(split + 1)), 'b/'),
  };
}

const MAX_HEADER_BYTES = 64 * 1024;

function describeSection(content: Buffer): { oldPath: string | null; newPath: string | null } {
  const lines = content.subarray(0, MAX_HEADER_BYTES).toString('utf8').split('\n');
  const diffLine = (lines[0] ?? '').slice(DIFF_HEADER.length);
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let minus: string | null | undefined;
  let plus: string | null | undefined;
  let created = false;
  let deleted = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('@@') || line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) break;
    if (line.startsWith('rename from ') || line.startsWith('copy from ')) renameFrom = unquoteGitPath(line.slice(line.indexOf(' from ') + 6));
    else if (line.startsWith('rename to ') || line.startsWith('copy to ')) renameTo = unquoteGitPath(line.slice(line.indexOf(' to ') + 4));
    else if (line.startsWith('new file mode ')) created = true;
    else if (line.startsWith('deleted file mode ')) deleted = true;
    else if (line.startsWith('--- ')) minus = markerPath(line.slice(4), 'a/');
    else if (line.startsWith('+++ ')) plus = markerPath(line.slice(4), 'b/');
  }
  if (renameFrom !== null && renameTo !== null) return { oldPath: renameFrom, newPath: renameTo };
  if (minus !== undefined && plus !== undefined) return { oldPath: minus, newPath: plus };
  const { oldPath, newPath } = pathsFromDiffLine(diffLine);
  return { oldPath: created ? null : oldPath, newPath: deleted ? null : newPath };
}

/**
 * Splits a patch into per-file sections. Section boundaries are lines starting with `diff --git `,
 * which cannot occur inside a hunk because every hunk line starts with ` `, `+`, `-` or `\`.
 * Expects `--src-prefix=a/ --dst-prefix=b/`.
 */
export function splitPatch(output: Buffer): PatchSection[] {
  const starts = lineStarts(output);
  return starts.map((start, index) => {
    const content = output.subarray(start, starts[index + 1] ?? output.length);
    return { ...describeSection(content), content: Buffer.from(content) };
  });
}
