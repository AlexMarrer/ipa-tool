import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Runtime } from '../../src/main/cli/runtime';
import { REPO_ROOT } from './env';

/**
 * A stand-in for `dist/cli.js` that prints what the test sets in environment variables. Used for outputs the
 * real CLI never produces (garbage, wrong exit codes, other versions).
 *   STUB_STDOUT, STUB_STDERR, STUB_EXIT, STUB_VERSION
 */
export async function createStubRuntime(dir: string): Promise<Runtime> {
  const cliRoot = path.join(dir, 'stub-cli');
  await mkdir(path.join(cliRoot, 'dist'), { recursive: true });
  await writeFile(
    path.join(cliRoot, 'dist', 'cli.js'),
    [
      "if (process.argv.includes('--version')) { console.log(process.env.STUB_VERSION ?? '0.1.0'); process.exit(0); }",
      "process.stdout.write(process.env.STUB_STDOUT ?? '');",
      "process.stderr.write(process.env.STUB_STDERR ?? '');",
      "process.exit(Number(process.env.STUB_EXIT ?? '0'));",
      '',
    ].join('\n'),
  );
  return {
    nodeExe: process.execPath,
    cliJs: path.join(cliRoot, 'dist', 'cli.js'),
    cliRoot,
    // The real schemas of the CLI validate the stub output.
    schemasDir: path.join(REPO_ROOT, 'schemas'),
    mode: 'test',
    nodeVersion: process.version,
  };
}
