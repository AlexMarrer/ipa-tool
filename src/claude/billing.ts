/**
 * Billing guard (spec.md §13.1): by default `claude` runs only on the Claude.ai subscription. API keys,
 * key helpers, Console or gateway logins and external providers bill per request, so they need
 * `claude.allowPaidUsage: true`. Sources: the environment for `claude`, the Claude Code settings and,
 * where known, `claude auth status`. Only names are kept, never values.
 */
import type { Config } from '../core/config.js';
import { EXIT, IpaError } from '../core/errors.js';
import type { AuthStatus } from './args.js';
import { readSettingsDocuments, type SettingsLocations, type SettingsRead } from './claude-settings.js';
import type { BillingCheck } from './types.js';

/** With one of these, Claude Code bills through the Anthropic API instead of the subscription. */
export const API_KEY_VARIABLES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'] as const;
export const PROVIDER_VARIABLES = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
] as const;
/** `authMethod` of `claude auth status` with an external provider. */
export const THIRD_PARTY_AUTH_METHOD = 'third_party';
/** `authMethod` values of a subscription login (`oauth_token` also covers `CLAUDE_CODE_OAUTH_TOKEN`). */
export const SUBSCRIPTION_AUTH_METHODS: ReadonlySet<string> = new Set(['claude.ai', 'oauth_token', 'none']);
/** `forceLoginMethod` values that lead away from the subscription. */
const PAID_LOGIN_METHODS = new Set(['console', 'gateway']);

export type AuthInfo = Pick<AuthStatus, 'authMethod' | 'apiKeySource'>;

function isSet(value: unknown): boolean {
  return (typeof value === 'string' && value.trim() !== '') || typeof value === 'number' || typeof value === 'boolean';
}

/** Names from `names` with a set value; case-insensitive, because Windows treats `anthropic_api_key` alike. */
function setVariables(vars: Record<string, unknown>, names: readonly string[]): string[] {
  const found = new Set<string>();
  for (const [name, value] of Object.entries(vars)) {
    if (isSet(value) && names.includes(name.toUpperCase())) found.add(name.toUpperCase());
  }
  return names.filter((name) => found.has(name));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Paid keys of one settings object: `apiKeyHelper`, variables in `env` and the login pins. */
function paidSettings(settings: Record<string, unknown>): { apiKey: string[]; provider: string[] } {
  const apiKey: string[] = [];
  const provider: string[] = [];
  if (isSet(settings['apiKeyHelper'])) apiKey.push('apiKeyHelper');
  const env = settings['env'];
  if (isPlainRecord(env)) {
    apiKey.push(...setVariables(env, API_KEY_VARIABLES).map((name) => `env.${name}`));
    provider.push(...setVariables(env, PROVIDER_VARIABLES).map((name) => `env.${name}`));
  }
  const loginMethod = settings['forceLoginMethod'];
  if (typeof loginMethod === 'string' && PAID_LOGIN_METHODS.has(loginMethod)) apiKey.push(`forceLoginMethod ${loginMethod}`);
  if (isSet(settings['forceLoginGatewayUrl'])) apiKey.push('forceLoginGatewayUrl');
  return { apiKey, provider };
}

/**
 * `env` is the environment `claude` receives. `auth` comes from a fresh `claude auth status`; it only
 * adds a source when the environment and the settings show nothing of that kind.
 */
export function evaluateBilling(env: NodeJS.ProcessEnv, config: Pick<Config, 'claude'>, settings: SettingsRead, auth: AuthInfo | null): BillingCheck {
  const apiKeySources: string[] = setVariables(env, API_KEY_VARIABLES);
  const providerSources: string[] = setVariables(env, PROVIDER_VARIABLES);
  for (const document of settings.documents) {
    // The cached server-managed settings may wrap the document.
    const nested = document.settings['settings'];
    for (const candidate of [document.settings, ...(isPlainRecord(nested) ? [nested] : [])]) {
      const paid = paidSettings(candidate);
      apiKeySources.push(...paid.apiKey.map((key) => `${key} (${document.label})`));
      providerSources.push(...paid.provider.map((key) => `${key} (${document.label})`));
    }
  }
  const method = auth?.authMethod ?? null;
  if (method === THIRD_PARTY_AUTH_METHOD && providerSources.length === 0) providerSources.push(`Anmeldeart ${method}`);
  if (method !== null && method !== THIRD_PARTY_AUTH_METHOD && !SUBSCRIPTION_AUTH_METHODS.has(method) && apiKeySources.length === 0) {
    apiKeySources.push(`Anmeldeart ${method}`);
  }
  const keySource = auth?.apiKeySource ?? null;
  if (keySource !== null && apiKeySources.length === 0) apiKeySources.push(`API-Schlüsselquelle ${keySource}`);

  const detected = apiKeySources.length > 0 || providerSources.length > 0;
  const allowPaidUsage = config.claude.allowPaidUsage === true;
  return {
    apiKeySources: [...new Set(apiKeySources)],
    providerSources: [...new Set(providerSources)],
    unreadableSettings: settings.unreadable,
    detected,
    allowPaidUsage,
    blocked: detected && !allowPaidUsage,
  };
}

/** Reads the settings; starts no `claude` process and never a model call. */
export async function checkBilling(
  env: NodeJS.ProcessEnv,
  config: Pick<Config, 'claude'>,
  auth: AuthInfo | null = null,
  locations?: SettingsLocations,
): Promise<BillingCheck> {
  return evaluateBilling(env, config, await readSettingsDocuments(env, locations), auth);
}

export function paidUsageSources(check: BillingCheck): string[] {
  return [...check.apiKeySources, ...check.providerSources];
}

export function paidUsageMessage(check: BillingCheck): string {
  return (
    `Kostenpflichtige Claude-Nutzung erkannt (${paidUsageSources(check).join(', ')}): Claude Code würde pro Anfrage über ` +
    'API-Zugangsdaten oder einen externen Anbieter abrechnen statt über das Claude-Abo. Ohne "allowPaidUsage": true unter ' +
    '"claude" in config.json ruft ipa Claude deshalb nicht auf. Abhilfe: die Variablen oder Einstellungen entfernen ' +
    'und das Abo über claude auth login verwenden, oder die Kosten bewusst freigeben.'
  );
}

export function paidUsageError(check: BillingCheck): IpaError {
  return new IpaError(
    'paid_usage_blocked',
    EXIT.analysisIncomplete,
    `${paidUsageMessage(check)} Der KI-Schritt entfällt, gesicherte Daten bleiben offen. Details mit ipa doctor.`,
  );
}

/** Before every model call; throws with exit code 6 before anything starts. */
export async function assertPaidUsageAllowed(env: NodeJS.ProcessEnv, config: Pick<Config, 'claude'>, auth: AuthInfo | null = null): Promise<void> {
  const check = await checkBilling(env, config, auth);
  if (check.blocked) throw paidUsageError(check);
}
