import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_VARIABLES,
  type AuthInfo,
  assertPaidUsageAllowed,
  checkBilling,
  evaluateBilling,
  paidUsageMessage,
  PROVIDER_VARIABLES,
} from '../../src/claude/billing.js';
import type { SettingsLocations, SettingsRead } from '../../src/claude/claude-settings.js';
import { type Config, createDefaultConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';
import { FAKE_API_KEY, FAKE_AUTH_TOKEN, FAKE_KEY_HELPER } from '../helpers/claude.js';
import { createTempDir } from '../helpers/workspace.js';

function config(allowPaidUsage?: boolean): Pick<Config, 'claude'> {
  const { claude } = createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' });
  const { allowPaidUsage: _default, ...legacy } = claude;
  return { claude: allowPaidUsage === undefined ? legacy : { ...legacy, allowPaidUsage } };
}

const SUBSCRIPTION_ENV = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: 'C:/Benutzer/konfig', CLAUDE_CODE_OAUTH_TOKEN: 'abo-token', ANTHROPIC_BASE_URL: 'https://proxy.invalid' };
const NO_SETTINGS: SettingsRead = { documents: [], unreadable: [] };
const auth = (authMethod: string | null, apiKeySource: string | null = null): AuthInfo => ({ authMethod, apiKeySource });

function settingsOf(label: string, settings: Record<string, unknown>): SettingsRead {
  return { documents: [{ label, settings }], unreadable: [] };
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('Kostenschutz: Umgebung und claude auth status (spec.md §13.1)', () => {
  it('schreibt allowPaidUsage: false als Standard in neue Konfigurationen', () => {
    expect(createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' }).claude.allowPaidUsage).toBe(false);
  });

  it('lässt die Abo-Anmeldung zu, auch mit CLAUDE_CODE_OAUTH_TOKEN und den Anmeldearten claude.ai, oauth_token und none', () => {
    for (const info of [null, auth(null), auth('claude.ai'), auth('oauth_token'), auth('none')]) {
      expect(evaluateBilling(SUBSCRIPTION_ENV, config(), NO_SETTINGS, info)).toEqual({
        apiKeySources: [],
        providerSources: [],
        unreadableSettings: [],
        detected: false,
        allowPaidUsage: false,
        blocked: false,
      });
    }
  });

  it.each([...API_KEY_VARIABLES.map((name) => [name, 'apiKeySources'] as const), ...PROVIDER_VARIABLES.map((name) => [name, 'providerSources'] as const)])(
    'sperrt %s ohne Freigabe und nennt nur den Namen',
    async (name, list) => {
      const env = { ...SUBSCRIPTION_ENV, [name]: FAKE_API_KEY };
      for (const cfg of [config(), config(false)]) {
        const check = evaluateBilling(env, cfg, NO_SETTINGS, null);
        expect(check[list]).toEqual([name]);
        expect(check).toMatchObject({ detected: true, allowPaidUsage: false, blocked: true });
        expect(paidUsageMessage(check)).not.toContain(FAKE_API_KEY);
      }
    },
  );

  it('wertet die frische Anmeldeart aus: third_party als Anbieter, jede andere Nicht-Abo-Anmeldeart als API-Zugang', () => {
    expect(evaluateBilling(SUBSCRIPTION_ENV, config(), NO_SETTINGS, auth('third_party'))).toMatchObject({ providerSources: ['Anmeldeart third_party'], blocked: true });
    for (const method of ['api_key', 'api_key_helper', 'gateway', 'unbekannt']) {
      expect(evaluateBilling(SUBSCRIPTION_ENV, config(), NO_SETTINGS, auth(method)), method).toMatchObject({
        apiKeySources: [`Anmeldeart ${method}`],
        blocked: true,
      });
    }
  });

  it('erkennt einen Console-Schlüssel über apiKeySource, obwohl die Anmeldeart claude.ai lautet', () => {
    expect(evaluateBilling(SUBSCRIPTION_ENV, config(), NO_SETTINGS, auth('claude.ai', '/login managed key'))).toMatchObject({
      apiKeySources: ['API-Schlüsselquelle /login managed key'],
      blocked: true,
    });
  });

  it('nennt Angaben aus claude auth status nur, wenn Umgebung und Einstellungen nichts dieser Art zeigen', () => {
    const env = { ANTHROPIC_API_KEY: FAKE_API_KEY, CLAUDE_CODE_USE_BEDROCK: '1' };
    expect(evaluateBilling(env, config(), NO_SETTINGS, auth('third_party', 'ANTHROPIC_API_KEY'))).toMatchObject({
      apiKeySources: ['ANTHROPIC_API_KEY'],
      providerSources: ['CLAUDE_CODE_USE_BEDROCK'],
    });
  });

  it('erkennt Namen ohne Rücksicht auf Gross- und Kleinschreibung und ignoriert leere Werte', () => {
    expect(evaluateBilling({ anthropic_api_key: FAKE_API_KEY, Claude_Code_Use_Vertex: '1' }, config(), NO_SETTINGS, null)).toMatchObject({
      apiKeySources: ['ANTHROPIC_API_KEY'],
      providerSources: ['CLAUDE_CODE_USE_VERTEX'],
      blocked: true,
    });
    expect(evaluateBilling({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_USE_BEDROCK: '  ', ANTHROPIC_AUTH_TOKEN: undefined }, config(), NO_SETTINGS, null).detected).toBe(false);
  });

  it('erlaubt alles nur mit allowPaidUsage: true', () => {
    const env = { ...SUBSCRIPTION_ENV, ANTHROPIC_API_KEY: FAKE_API_KEY, CLAUDE_CODE_USE_BEDROCK: '1' };
    const settings = settingsOf('Benutzereinstellungen', { apiKeyHelper: FAKE_KEY_HELPER });
    expect(evaluateBilling(env, config(true), settings, auth('third_party'))).toEqual({
      apiKeySources: ['ANTHROPIC_API_KEY', 'apiKeyHelper (Benutzereinstellungen)'],
      providerSources: ['CLAUDE_CODE_USE_BEDROCK'],
      unreadableSettings: [],
      detected: true,
      allowPaidUsage: true,
      blocked: false,
    });
  });
});

describe('Kostenschutz: Claude-Einstellungen (spec.md §13.1)', () => {
  it('erkennt apiKeyHelper, bezahlte Variablen in env und Anmeldevorgaben für Console und Gateway', () => {
    const settings = settingsOf('verwaltete Einstellungen', {
      apiKeyHelper: FAKE_KEY_HELPER,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, anthropic_auth_token: FAKE_AUTH_TOKEN, CLAUDE_CODE_USE_FOUNDRY: 1, CLAUDE_CODE_OAUTH_TOKEN: 'abo-token' },
      forceLoginMethod: 'console',
      forceLoginGatewayUrl: 'https://gateway.invalid',
    });
    const check = evaluateBilling(SUBSCRIPTION_ENV, config(), settings, auth('api_key_helper', 'apiKeyHelper'));
    expect(check).toMatchObject({
      apiKeySources: [
        'apiKeyHelper (verwaltete Einstellungen)',
        'env.ANTHROPIC_API_KEY (verwaltete Einstellungen)',
        'env.ANTHROPIC_AUTH_TOKEN (verwaltete Einstellungen)',
        'forceLoginMethod console (verwaltete Einstellungen)',
        'forceLoginGatewayUrl (verwaltete Einstellungen)',
      ],
      providerSources: ['env.CLAUDE_CODE_USE_FOUNDRY (verwaltete Einstellungen)'],
      blocked: true,
    });
    for (const secret of [FAKE_API_KEY, FAKE_AUTH_TOKEN, FAKE_KEY_HELPER, 'gateway.invalid']) {
      expect(JSON.stringify(check)).not.toContain(secret);
      expect(paidUsageMessage(check)).not.toContain(secret);
    }
  });

  it('lässt Abo-Einstellungen zu: forceLoginMethod claudeai, leere Werte, CLAUDE_CODE_OAUTH_TOKEN', () => {
    const settings = settingsOf('Benutzereinstellungen', {
      apiKeyHelper: '',
      env: { ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: 'abo-token', CLAUDE_CODE_USE_BEDROCK: null },
      forceLoginMethod: 'claudeai',
      model: 'sonnet',
    });
    expect(evaluateBilling(SUBSCRIPTION_ENV, config(), settings, auth('oauth_token')).detected).toBe(false);
  });

  it('prüft auch ein verschachteltes settings-Objekt, etwa im Cache der Server-Einstellungen', () => {
    const settings = settingsOf('Server-Einstellungen (Cache)', { settings: { env: { CLAUDE_CODE_USE_VERTEX: '1' } } });
    expect(evaluateBilling({}, config(), settings, null).providerSources).toEqual(['env.CLAUDE_CODE_USE_VERTEX (Server-Einstellungen (Cache))']);
  });

  it('meldet nicht auswertbare Einstellungen, ohne deswegen zu sperren', () => {
    const check = evaluateBilling({}, config(), { documents: [], unreadable: ['Benutzereinstellungen: C:/x/settings.json'] }, null);
    expect(check).toMatchObject({ unreadableSettings: ['Benutzereinstellungen: C:/x/settings.json'], blocked: false });
  });

  it('liest die Einstellungen aus Dateien und wirft vor einem Aufruf nur mit Namen', async () => {
    const dir = await createTempDir('einstellungen');
    await mkdir(path.join(dir, 'managed-settings.d'));
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ apiKeyHelper: FAKE_KEY_HELPER }));
    await writeFile(path.join(dir, 'managed-settings.d', '10-anbieter.json'), JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }));
    const locations: SettingsLocations = {
      files: [{ label: 'Benutzereinstellungen', file: path.join(dir, 'settings.json') }],
      dropInDirs: [{ label: 'verwaltete Einstellungen', dir: path.join(dir, 'managed-settings.d') }],
      registryKeys: [],
    };
    const check = await checkBilling({}, config(), null, locations);
    expect(check).toMatchObject({
      apiKeySources: ['apiKeyHelper (Benutzereinstellungen)'],
      providerSources: ['env.CLAUDE_CODE_USE_BEDROCK (verwaltete Einstellungen 10-anbieter.json)'],
      blocked: true,
    });

    const configDir = path.join(dir, 'konfig');
    await mkdir(configDir);
    await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: FAKE_AUTH_TOKEN } }));
    const error = await thrown(assertPaidUsageAllowed({ CLAUDE_CONFIG_DIR: configDir }, config()));
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ code: 'paid_usage_blocked', exitCode: 6 });
    expect((error as Error).message).toContain('env.ANTHROPIC_AUTH_TOKEN (Benutzereinstellungen)');
    expect((error as Error).message).not.toContain(FAKE_AUTH_TOKEN);
    await expect(assertPaidUsageAllowed({ CLAUDE_CONFIG_DIR: configDir }, config(true))).resolves.toBeUndefined();
  });
});
