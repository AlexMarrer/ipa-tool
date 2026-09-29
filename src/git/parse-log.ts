/**
 * Parsers for `git rev-list` and `git log -z` with {@link COMMIT_LOG_FORMAT}.
 */

export interface CommitMeta {
  sha: string;
  parents: string[];
  /** Unix seconds. */
  authorTime: number;
  committerTime: number;
  authorEmail: string;
  /** Raw message (`%B`), usually with a trailing newline. */
  message: string;
}

// NUL-separated fields; `-z` also ends every commit with NUL, so each commit yields exactly six fields.
export const COMMIT_LOG_FORMAT = '%H%x00%P%x00%at%x00%ct%x00%ae%x00%B';
const FIELDS_PER_COMMIT = 6;
const OBJECT_ID = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

function toText(output: Buffer | string): string {
  return typeof output === 'string' ? output : output.toString('utf8');
}

export function parseRevList(output: Buffer | string): string[] {
  return toText(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      if (!OBJECT_ID.test(line)) throw new Error(`Unerwartete Git-Ausgabe von rev-list: "${line.slice(0, 80)}"`);
      return line;
    });
}

export function parseCommitLogZ(output: Buffer | string): CommitMeta[] {
  const tokens = toText(output).split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  if (tokens.length % FIELDS_PER_COMMIT !== 0) {
    throw new Error(`Unerwartete Git-Ausgabe von log: ${tokens.length} Felder`);
  }
  const commits: CommitMeta[] = [];
  for (let i = 0; i < tokens.length; i += FIELDS_PER_COMMIT) {
    const [sha, parents, authorTime, committerTime, authorEmail, message] = tokens.slice(i, i + FIELDS_PER_COMMIT) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!OBJECT_ID.test(sha)) throw new Error(`Unerwartete Git-Ausgabe von log: "${sha.slice(0, 80)}"`);
    commits.push({
      sha,
      parents: parents === '' ? [] : parents.split(' '),
      authorTime: Number(authorTime),
      committerTime: Number(committerTime),
      authorEmail,
      message,
    });
  }
  return commits;
}
