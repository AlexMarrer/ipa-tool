import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { createPathFilter, GIT_DIR_RULE, NOT_INCLUDED_RULE } from '../../src/filter/path-filter.js';

const defaults = createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' }).paths;

// For every default exclusion: paths at the root, deep inside and in different letter case.
const DEFAULT_CASES: Record<string, string[]> = {
  '.env': ['.env', 'app/config/.env', 'A/B/.ENV'],
  '.env.*': ['.env.local', 'app/.env.production', 'x/.ENV.Test'],
  '*.pem': ['server.pem', 'a/b/c/Zertifikat.PEM'],
  '*.key': ['privat.key', 'tls/Server.KEY'],
  '*.p12': ['konto.p12', 'x/y.P12'],
  '*.pfx': ['cert.pfx', 'x/CERT.PFX'],
  '*.jks': ['store.jks', 'java/Store.JKS'],
  '*.keystore': ['debug.keystore', 'android/app/Release.KEYSTORE'],
  id_rsa: ['id_rsa', 'home/.ssh/ID_RSA'],
  'id_rsa.*': ['id_rsa.pub', 'ssh/ID_RSA.old'],
  id_ed25519: ['id_ed25519', 'ssh/ID_ED25519'],
  'id_ed25519.*': ['id_ed25519.pub', 'x/id_ed25519.bak'],
  '.npmrc': ['.npmrc', 'packages/a/.NPMRC'],
  '.pypirc': ['.pypirc', 'py/.PyPIRC'],
  '.netrc': ['.netrc', 'home/.Netrc'],
  '**/secrets/**': ['secrets/x.txt', 'app/Secrets/deep/y.json', 'SECRETS/z'],
  '**/credentials/**': ['credentials/a', 'x/Credentials/b/c.txt'],
  '**/node_modules/**': ['node_modules/pkg/index.js', 'web/NODE_MODULES/a/b.js'],
  '**/vendor/**': ['vendor/lib.php', 'x/Vendor/y'],
  '**/.venv/**': ['.venv/bin/python', 'py/.VENV/lib/x.py'],
  '**/__pycache__/**': ['__pycache__/a.pyc', 'pkg/__PYCACHE__/b.pyc'],
  '**/dist/**': ['dist/app.js', 'packages/ui/DIST/x.js'],
  '**/target/**': ['target/app.jar', 'module/Target/classes/A.class'],
  '**/coverage/**': ['coverage/lcov.info', 'x/COVERAGE/index.html'],
};

describe('PathFilter (spec.md §14.3, D-10, AK-02-17)', () => {
  const filter = createPathFilter({ include: defaults.include, exclude: defaults.exclude });

  it('deckt jeden Standard-Ausschluss aus spec.md §7.1 ab', () => {
    expect(Object.keys(DEFAULT_CASES).sort()).toEqual([...defaults.exclude].sort());
  });

  it.each(Object.entries(DEFAULT_CASES))('schliesst %s in jeder Tiefe und ohne Beachtung der Schreibweise aus', (rule, paths) => {
    for (const path of paths) {
      expect(filter.decide(path), path).toEqual({ allowed: false, rule });
    }
  });

  it('lässt gewöhnliche Pfade zu, auch wenn sie den Mustern ähneln', () => {
    for (const path of ['src/app.ts', 'env.txt', 'docs/environment.md', 'my.env', 'secretsanta/list.md', 'distance.ts', 'README.md', '.github/workflows/ci.yml']) {
      expect(filter.decide(path), path).toEqual({ allowed: true });
    }
  });

  it('schliesst .git immer aus, auch ohne Muster und bei ausdrücklichem Einschluss', () => {
    const open = createPathFilter({ include: ['**', '.git/**'], exclude: [] });
    for (const path of ['.git/config', '.git', 'sub/.git/HEAD', '.GIT/index']) {
      expect(open.decide(path), path).toEqual({ allowed: false, rule: GIT_DIR_RULE });
    }
    expect(open.decide('.gitignore')).toEqual({ allowed: true });
    expect(open.decide('src/.github/x')).toEqual({ allowed: true });
  });

  it('wendet Muster ohne / auf den Dateinamen und Muster mit / auf den ganzen Pfad an', () => {
    const custom = createPathFilter({ include: ['**'], exclude: ['docs/*.md', 'notizen.txt'] });
    expect(custom.decide('docs/a.md')).toEqual({ allowed: false, rule: 'docs/*.md' });
    expect(custom.decide('x/docs/a.md')).toEqual({ allowed: true });
    expect(custom.decide('docs/sub/a.md')).toEqual({ allowed: true });
    expect(custom.decide('tief/unten/NOTIZEN.txt')).toEqual({ allowed: false, rule: 'notizen.txt' });
  });

  it('lässt Ausschlüsse vor Einschlüssen gelten und meldet nicht eingeschlossene Pfade', () => {
    const custom = createPathFilter({ include: ['src/**', '*.md'], exclude: ['src/generated/**'] });
    expect(custom.decide('src/a.ts')).toEqual({ allowed: true });
    expect(custom.decide('docs/b.md')).toEqual({ allowed: true });
    expect(custom.decide('src/generated/c.ts')).toEqual({ allowed: false, rule: 'src/generated/**' });
    expect(custom.decide('scripts/d.sh')).toEqual({ allowed: false, rule: NOT_INCLUDED_RULE });
  });

  it('schliesst einen Arbeitsbereich im Repository immer aus (I-14)', () => {
    const custom = createPathFilter({ include: ['**'], exclude: [], workspace: '.ipa' });
    expect(custom.decide('.ipa')).toEqual({ allowed: false, rule: '.ipa/**' });
    expect(custom.decide('.ipa/snapshots/S000001/manifest.json')).toEqual({ allowed: false, rule: '.ipa/**' });
    expect(custom.decide('.IPA/tmp/x')).toEqual({ allowed: false, rule: '.ipa/**' });
    expect(custom.decide('.ipa2/x')).toEqual({ allowed: true });
    expect(custom.decide('src/.ipa/x')).toEqual({ allowed: true });
  });
});
