import { describe, expect, it } from 'vitest';
import { assertPaidUsageAllowed, checkBilling, paidUsageMessage } from '../../src/claude/billing.js';
import { type Config, createDefaultConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';
import { FAKE_API_KEY, FAKE_AUTH_TOKEN } from '../helpers/claude.js';

function config(allowPaidUsage?: boolean): Pick<Config, 'claude'> {
  const { claude } = createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' });
  const { allowPaidUsage: _default, ...legacy } = claude;
  return { claude: allowPaidUsage === undefined ? legacy : { ...legacy, allowPaidUsage } };
}

const SUBSCRIPTION_ENV = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: 'C:/Benutzer/konfig', CLAUDE_CODE_OAUTH_TOKEN: 'abo-token', ANTHROPIC_BASE_URL: 'https://proxy.invalid' };

const PAID: [string, string, 'apiKeyVariables' | 'providerVariables'][] = [
  ['ANTHROPIC_API_KEY', FAKE_API_KEY, 'apiKeyVariables'],
  ['ANTHROPIC_AUTH_TOKEN', FAKE_AUTH_TOKEN, 'apiKeyVariables'],
  ['CLAUDE_CODE_USE_BEDROCK', '1', 'providerVariables'],
  ['CLAUDE_CODE_USE_VERTEX', '1', 'providerVariables'],
  ['CLAUDE_CODE_USE_FOUNDRY', 'true', 'providerVariables'],
];

describe('Kostenschutz (spec.md §13.1)', () => {
  it('schreibt allowPaidUsage: false als Standard in neue Konfigurationen', () => {
    expect(createDefaultConfig({ repositoryId: 'x-111111', repoPath: 'C:/x', timezone: 'Europe/Zurich' }).claude.allowPaidUsage).toBe(false);
  });

  it('lässt die Abo-Anmeldung zu, auch mit CLAUDE_CODE_OAUTH_TOKEN und den Anmeldearten claude.ai und oauth_token', () => {
    for (const authMethod of [null, 'claude.ai', 'oauth_token']) {
      expect(checkBilling(SUBSCRIPTION_ENV, config(), authMethod)).toEqual({
        apiKeyVariables: [],
        providerVariables: [],
        thirdPartyLogin: false,
        detected: false,
        allowPaidUsage: false,
        blocked: false,
      });
      expect(() => assertPaidUsageAllowed(SUBSCRIPTION_ENV, config(), authMethod)).not.toThrow();
    }
  });

  it.each(PAID)('sperrt %s ohne Freigabe und nennt nur den Namen', (name, value, list) => {
    const env = { ...SUBSCRIPTION_ENV, [name]: value };
    for (const cfg of [config(), config(false)]) {
      const check = checkBilling(env, cfg);
      expect(check[list]).toEqual([name]);
      expect(check).toMatchObject({ detected: true, allowPaidUsage: false, blocked: true });
      const error = (() => {
        try {
          assertPaidUsageAllowed(env, cfg);
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(IpaError);
      expect(error).toMatchObject({ code: 'paid_usage_blocked', exitCode: 6 });
      expect((error as Error).message).toContain(name);
      expect((error as Error).message).toContain('allowPaidUsage');
      if (value.length > 4) expect((error as Error).message).not.toContain(value);
    }
  });

  it('sperrt die Anmeldeart third_party auch ohne Variable, etwa bei einem Anbieter aus den Claude-Einstellungen', () => {
    const check = checkBilling(SUBSCRIPTION_ENV, config(), 'third_party');
    expect(check).toMatchObject({ providerVariables: [], thirdPartyLogin: true, blocked: true });
    expect(paidUsageMessage(check)).toContain('Anmeldeart third_party');
  });

  it('erlaubt alles nur mit allowPaidUsage: true', () => {
    const env = { ...SUBSCRIPTION_ENV, ANTHROPIC_API_KEY: FAKE_API_KEY, CLAUDE_CODE_USE_BEDROCK: '1' };
    expect(checkBilling(env, config(true), 'third_party')).toEqual({
      apiKeyVariables: ['ANTHROPIC_API_KEY'],
      providerVariables: ['CLAUDE_CODE_USE_BEDROCK'],
      thirdPartyLogin: true,
      detected: true,
      allowPaidUsage: true,
      blocked: false,
    });
    expect(() => assertPaidUsageAllowed(env, config(true), 'third_party')).not.toThrow();
  });

  it('erkennt Namen ohne Rücksicht auf Gross- und Kleinschreibung und ignoriert leere Werte', () => {
    expect(checkBilling({ anthropic_api_key: FAKE_API_KEY, Claude_Code_Use_Vertex: '1' }, config())).toMatchObject({
      apiKeyVariables: ['ANTHROPIC_API_KEY'],
      providerVariables: ['CLAUDE_CODE_USE_VERTEX'],
      blocked: true,
    });
    expect(checkBilling({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_USE_BEDROCK: '  ', ANTHROPIC_AUTH_TOKEN: undefined }, config()).detected).toBe(false);
  });

  it('nennt mehrere Quellen in fester Reihenfolge', () => {
    const env = { CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_AUTH_TOKEN: FAKE_AUTH_TOKEN, ANTHROPIC_API_KEY: FAKE_API_KEY };
    expect(paidUsageMessage(checkBilling(env, config(), 'third_party'))).toContain(
      '(ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_USE_FOUNDRY, Anmeldeart third_party)',
    );
  });
});
