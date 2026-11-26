// Stages the CLI as `npm install --global .` would install it: the packed files plus production dependencies
// (spec §6.3, step 2). Result: stage/cli/ with dist/, schemas/, prompts/, package.json and node_modules/.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const target = path.join(appRoot, 'stage', 'cli');
// npm ships next to node; running its script with node needs no shell.
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npm = 'npm';

function run(command, args, cwd) {
  const [program, programArgs, shell] =
    command === npm
      ? existsSync(npmCli)
        ? [process.execPath, [npmCli, ...args], false]
        : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args, process.platform === 'win32']
      : [command, args, false];
  const result = spawnSync(program, programArgs, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} endete mit Code ${result.status}`);
}

if (!existsSync(path.join(repoRoot, 'dist', 'cli.js'))) {
  throw new Error('dist/cli.js fehlt. Zuerst "npm run build" im Wurzelordner ausführen.');
}

const work = mkdtempSync(path.join(os.tmpdir(), 'ipa-pack-'));
try {
  run(npm, ['pack', '--pack-destination', work, '--ignore-scripts'], repoRoot);
  const archive = readdirSync(work).find((name) => name.endsWith('.tgz'));
  if (archive === undefined) throw new Error('npm pack hat kein Archiv erzeugt.');

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // The archive holds everything below "package/".
  run('tar', ['-xzf', path.join(work, archive), '-C', target, '--strip-components=1'], work);
  copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(target, 'package-lock.json'));
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], target);
  console.log(`CLI bereitgestellt: ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
