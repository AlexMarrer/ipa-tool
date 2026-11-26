// Downloads the pinned node.exe and checks its SHA-256 (spec §3.3, AD-04). Writes stage/node/node.exe.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sha256Of(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export function archiveUrl(version) {
  return `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`;
}

async function downloadTo(url, file) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

/** Extracts `node.exe` from the zip with the tar that ships with Windows 10 and later (bsdtar reads zip). */
function extractNodeExe(zipFile, version, targetDir) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'ipa-node-'));
  try {
    const inner = `node-v${version}-win-x64/node.exe`;
    execFileSync('tar', ['-xf', zipFile, '-C', work, inner], { stdio: 'inherit' });
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(path.join(work, ...inner.split('/')), path.join(targetDir, 'node.exe'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Fetches, verifies and stages node.exe. Aborts on a checksum mismatch without writing node.exe.
 * `download` and `extract` are injectable for tests.
 */
export async function fetchNode({ version, sha256, targetDir, download = downloadTo, extract = extractNodeExe }) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'ipa-node-dl-'));
  try {
    const zip = path.join(work, 'node.zip');
    await download(archiveUrl(version), zip);
    const actual = await sha256Of(zip);
    if (actual !== sha256.toLowerCase()) {
      throw new Error(`Prüfsumme von node ${version} stimmt nicht: erwartet ${sha256}, erhalten ${actual}. Abbruch.`);
    }
    await extract(zip, version, targetDir);
    return { sha256: actual, file: path.join(targetDir, 'node.exe') };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version, sha256 } = JSON.parse(readFileSync(path.join(appRoot, 'node-runtime.json'), 'utf8'));
  const result = await fetchNode({ version, sha256, targetDir: path.join(appRoot, 'stage', 'node') });
  console.log(`node ${version} bereitgestellt: ${result.file}`);
}
