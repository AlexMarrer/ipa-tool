/**
 * Billing guard (spec.md §13.1): by default `claude` runs only on the Claude.ai subscription. An API key
 * or an external provider bills every request, so both need `claude.allowPaidUsage: true`.
 */
import type { Config } from '../core/config.js';
import { EXIT, IpaError } from '../core/errors.js';
import type { BillingCheck } from './types.js';

/** With one of these, Claude Code bills through the Anthropic API instead of the subscription. */
export const API_KEY_VARIABLES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;
export const PROVIDER_VARIABLES = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'] as const;
/** `authMethod` of `claude auth status` with Bedrock, Vertex AI or Foundry. */
export const THIRD_PARTY_AUTH_METHOD = 'third_party';

/** Names with a non-empty value; case-insensitive, because Windows treats `anthropic_api_key` alike. */
function setVariables(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  const found = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '' && names.includes(name.toUpperCase())) found.add(name.toUpperCase());
  }
  return names.filter((name) => found.has(name));
}

/** `env` is the environment `claude` receives; `authMethod` comes from `claude auth status`, if known. */
export function checkBilling(env: NodeJS.ProcessEnv, config: Pick<Config, 'claude'>, authMethod: string | null = null): BillingCheck {
  const apiKeyVariables = setVariables(env, API_KEY_VARIABLES);
  const providerVariables = setVariables(env, PROVIDER_VARIABLES);
  const thirdPartyLogin = authMethod === THIRD_PARTY_AUTH_METHOD;
  const detected = apiKeyVariables.length > 0 || providerVariables.length > 0 || thirdPartyLogin;
  const allowPaidUsage = config.claude.allowPaidUsage === true;
  return { apiKeyVariables, providerVariables, thirdPartyLogin, detected, allowPaidUsage, blocked: detected && !allowPaidUsage };
}

export function paidUsageSources(check: BillingCheck): string[] {
  return [...check.apiKeyVariables, ...check.providerVariables, ...(check.thirdPartyLogin ? [`Anmeldeart ${THIRD_PARTY_AUTH_METHOD}`] : [])];
}

export function paidUsageMessage(check: BillingCheck): string {
  return (
    `Kostenpflichtige Claude-Nutzung erkannt (${paidUsageSources(check).join(', ')}): Claude Code würde pro Anfrage über ` +
    'API-Zugangsdaten oder einen externen Anbieter abrechnen statt über das Claude-Abo. Ohne "allowPaidUsage": true unter ' +
    '"claude" in config.json ruft ipa Claude deshalb nicht auf. Abhilfe: die Variablen oder Anbieter-Einstellungen entfernen ' +
    'und das Abo über claude auth login verwenden, oder die Kosten bewusst freigeben.'
  );
}

/** Before every model call; throws with exit code 6 before anything starts. */
export function assertPaidUsageAllowed(env: NodeJS.ProcessEnv, config: Pick<Config, 'claude'>, authMethod: string | null = null): void {
  const check = checkBilling(env, config, authMethod);
  if (!check.blocked) return;
  throw new IpaError(
    'paid_usage_blocked',
    EXIT.analysisIncomplete,
    `${paidUsageMessage(check)} Der KI-Schritt entfällt, gesicherte Daten bleiben offen. Details mit ipa doctor.`,
  );
}
