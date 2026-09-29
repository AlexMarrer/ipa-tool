import { quoteGitPath } from '../git/parse-diff.js';

/**
 * Unified diff for a file that is not in the index yet (`unstaged_diff` of an untracked file),
 * in the same form `git diff` prints for a newly added file.
 */
export function renderNewFilePatch(path: string, content: Buffer, blob: string, mode: string): Buffer {
  const a = quoteGitPath(`a/${path}`);
  const b = quoteGitPath(`b/${path}`);
  const header = [`diff --git ${a} ${b}`, `new file mode ${mode}`, `index 0000000..${blob.slice(0, 7)}`];
  if (content.length === 0) return Buffer.from(`${header.join('\n')}\n`, 'utf8');

  const endsWithNewline = content[content.length - 1] === 0x0a;
  const body = endsWithNewline ? content.subarray(0, content.length - 1) : content;
  const lines: Buffer[] = [];
  let start = 0;
  for (;;) {
    const newline = body.indexOf(0x0a, start);
    lines.push(body.subarray(start, newline < 0 ? body.length : newline));
    if (newline < 0) break;
    start = newline + 1;
  }
  // Git appends a tab to ---/+++ lines when the name contains a space.
  const tab = path.includes(' ') ? '\t' : '';
  const range = lines.length === 1 ? '+1' : `+1,${lines.length}`;
  const parts: Buffer[] = [Buffer.from(`${header.join('\n')}\n--- /dev/null\n+++ ${b}${tab}\n@@ -0,0 ${range} @@\n`, 'utf8')];
  for (const line of lines) parts.push(Buffer.from('+'), line, Buffer.from('\n'));
  if (!endsWithNewline) parts.push(Buffer.from('\\ No newline at end of file\n'));
  return Buffer.concat(parts);
}
