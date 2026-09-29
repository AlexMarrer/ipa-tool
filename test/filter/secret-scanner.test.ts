import { describe, expect, it } from 'vitest';
import { SECRET_DETECTORS } from '../../src/core/config.js';
import { BUILTIN_DETECTORS, createSecretScanner } from '../../src/filter/secret-scanner.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';

const marker = createSecretMarker();
// Fake tokens are assembled at runtime so that no token-shaped literal sits in the source.
const fake = (prefix: string, body: string, length: number) => `${prefix}${body.padEnd(length, '0')}`;

const HITS: Record<string, string[]> = {
  private_key: ['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN OPENSSH PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----'],
  aws_access_key: [`aws_id: ${fake('AK' + 'IA', 'IPATESTSECRET', 16)}`],
  github_token: [fake('gh' + 'p_', 'IPATESTSECRET', 36), `token ${fake('github' + '_pat_', 'IPA_TEST_SECRET', 40)}`],
  slack_token: [`${'xo' + 'xb'}-IPA-TEST-SECRET-000000`],
  anthropic_or_openai_key: [`KEY=${'s' + 'k-ant-'}${marker}`, `${'s' + 'k-proj-'}${marker}`],
  jwt: [`Bearer ${'ey' + 'J'}hbGciOiJIUzI1NiJ9.eyJzdWIiOiJJUEFfVEVTVCJ9.IPA_TEST_SECRET_signature`],
  url_credentials: [`postgres://ipa:${marker}@localhost:5432/db`, `git clone https://nutzer:${marker}@example.invalid/r.git`],
  assignment: [
    secretAssignment(marker),
    `const accessToken = '${marker}';`,
    `"client_secret": "${marker}"`,
    `DB_PASSWORD=${marker}`,
    `export API_TOKEN=${marker}`,
    `  password: ${marker}`,
    `spring.datasource.password=${marker}  # Test`,
  ],
};

const MISSES: Record<string, string[]> = {
  private_key: ['-----BEGIN PUBLIC KEY-----', '-----BEGIN CERTIFICATE-----'],
  aws_access_key: ['AKIA1234', `X${fake('AK' + 'IA', 'IPATESTSECRET', 16)}Y`],
  github_token: ['ghp_kurz', 'ghx_IPATESTSECRET000000000000000000000000'],
  slack_token: ['xoxb-kurz', 'xoxz-IPA-TEST-SECRET-000000'],
  anthropic_or_openai_key: ['sk-kurz', 'desk-management-component-reference-id', 'task-queue-worker-priority-high-01'],
  jwt: ['eyJhbGciOi', 'eyJabc.def.ghi'],
  url_credentials: ['https://example.invalid/pfad', 'mongodb://${USER}:${PASSWORD}@host', 'http://localhost:8080/@home'],
  assignment: [
    'password = "kurz"',
    'const token = await getToken();',
    'token = response.data.accessToken',
    'const TOKEN_HEADER = "Authorization";',
    'password: ${DB_PASSWORD}',
    '"password": "Passwort eingeben"',
    'passwordConfirmation = "wiederholen1234"',
    'api_key = "${API_KEY_FROM_ENV}"',
  ],
};

describe('SecretScanner (spec.md §14.4, AK-02-17)', () => {
  const scanner = createSecretScanner({ extraPatterns: [], disabledDetectors: [] });

  it('kennt genau die verbindlichen Detektornamen', () => {
    expect([...BUILTIN_DETECTORS.map((detector) => detector.name), 'custom'].sort()).toEqual([...SECRET_DETECTORS].sort());
    expect(Object.keys(HITS).sort()).toEqual(BUILTIN_DETECTORS.map((detector) => detector.name).sort());
  });

  it.each(Object.entries(HITS))('%s erkennt künstliche Werte', (detector, lines) => {
    for (const line of lines) {
      expect(scanner.scan(`erste Zeile\n${line}\nletzte Zeile`), line).toContainEqual({ detector, line: 2 });
    }
  });

  it.each(Object.entries(MISSES))('%s schlägt bei ähnlichen harmlosen Werten nicht an', (detector, lines) => {
    for (const line of lines) {
      expect(scanner.scan(line).filter((hit) => hit.detector === detector), line).toEqual([]);
    }
  });

  it('meldet Zeilennummern, auch bei CRLF, und nie den Wert', () => {
    const hits = scanner.scan(`a\r\nb\r\n${secretAssignment(marker)}\r\n`);
    expect(hits).toEqual([{ detector: 'assignment', line: 3 }]);
    expect(JSON.stringify(hits)).not.toContain(marker);
  });

  it('prüft zusätzliche Muster als Detektor custom und kann Detektoren abschalten', () => {
    const custom = createSecretScanner({ extraPatterns: ['INTERN-[0-9]{4}'], disabledDetectors: ['assignment'] });
    expect(custom.scan('Ticket INTERN-1234')).toEqual([{ detector: 'custom', line: 1 }]);
    expect(custom.scan('Ticket INTERN-12')).toEqual([]);
    expect(custom.scan(secretAssignment(marker))).toEqual([]);
    const withoutCustom = createSecretScanner({ extraPatterns: ['INTERN-[0-9]{4}'], disabledDetectors: ['custom'] });
    expect(withoutCustom.scan('Ticket INTERN-1234')).toEqual([]);
  });

  it('prüft auch sehr lange Zeilen wie in minifizierten Dateien schnell', () => {
    const line = `${'A'.repeat(200_000)}+${'b-'.repeat(100_000)}${'x'.repeat(200_000)}`;
    const started = performance.now();
    expect(scanner.scan(line)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
