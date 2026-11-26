// Writes out/cli-version.json: the CLI version the app expects at startup (spec §6.5).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPackage = JSON.parse(readFileSync(path.join(appRoot, '..', 'package.json'), 'utf8'));

mkdirSync(path.join(appRoot, 'out'), { recursive: true });
writeFileSync(path.join(appRoot, 'out', 'cli-version.json'), `${JSON.stringify({ version: cliPackage.version }, null, 2)}\n`);
console.log(`out/cli-version.json: ${cliPackage.version}`);
