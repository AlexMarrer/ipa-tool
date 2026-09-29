import type { SecretDetector } from '../core/config.js';

export interface SecretHit {
  detector: SecretDetector;
  /** 1-based line number. */
  line: number;
}

export interface SecretScanner {
  scan(text: string): SecretHit[];
}

export interface SecretScannerOptions {
  extraPatterns: readonly string[];
  disabledDetectors: readonly string[];
}

interface Detector {
  name: SecretDetector;
  patterns: readonly RegExp[];
}

// Keys that end with one of these words count as secret keys ("db_password", "accessToken", "client_secret").
const KEY = String.raw`(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)`;

// All patterns start with a literal, a lookbehind or a line anchor, and scan lines of arbitrary
// length (minified files) in linear time.
export const BUILTIN_DETECTORS: readonly Detector[] = [
  { name: 'private_key', patterns: [/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/] },
  { name: 'aws_access_key', patterns: [/(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/] },
  {
    name: 'github_token',
    patterns: [/(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,}/, /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/],
  },
  { name: 'slack_token', patterns: [/(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/] },
  { name: 'anthropic_or_openai_key', patterns: [/(?<![A-Za-z0-9_-])sk-(?:ant-)?[A-Za-z0-9_-]{20,}/] },
  { name: 'jwt', patterns: [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/] },
  {
    name: 'url_credentials',
    // Placeholders such as ${USER} or %s are not credentials.
    patterns: [/(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s/:@'"`${}%<>]+:[^\s/@'"`${}%<>]+@/],
  },
  {
    name: 'assignment',
    patterns: [
      // Quoted literal anywhere: api_key = "…", "token": "…". Values with spaces are prose, not secrets.
      new RegExp(
        String.raw`${KEY}(?![A-Za-z0-9_])["']?\s*(?:=>|:=|=|:)\s*(?:"(?!\$\{|\{\{|%\(|<)[^"\s]{8,}"|'(?!\$\{|\{\{|%\(|<)[^'\s]{8,}'|` +
          '`(?!\\$\\{|\\{\\{|%\\(|<)[^`\\s]{8,}`)',
        'i',
      ),
      // Unquoted literal only as a whole config line (.env, properties, YAML, shell). Values with
      // dots or brackets are treated as code expressions, and $VAR, %VAR% or <…> as placeholders.
      new RegExp(
        String.raw`^\s*(?:export\s+|-\s+)?["']?[A-Za-z0-9_.-]*${KEY}["']?\s*[=:]\s*(?![$%<{\[(&*!|>@])[^\s"'` +
          '`' +
          String.raw`,;(){}\[\]<>.#]{8,}\s*(?:#.*)?$`,
        'i',
      ),
    ],
  },
];

export function createSecretScanner(options: SecretScannerOptions): SecretScanner {
  const disabled = new Set(options.disabledDetectors);
  const detectors: Detector[] = BUILTIN_DETECTORS.filter((detector) => !disabled.has(detector.name));
  if (!disabled.has('custom') && options.extraPatterns.length > 0) {
    // The config loader already rejected invalid patterns (spec.md §7.2).
    detectors.push({ name: 'custom', patterns: options.extraPatterns.map((source) => new RegExp(source)) });
  }

  return {
    scan(text) {
      const hits: SecretHit[] = [];
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index] ?? '';
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        for (const detector of detectors) {
          if (detector.patterns.some((pattern) => pattern.test(line))) {
            hits.push({ detector: detector.name, line: index + 1 });
          }
        }
      }
      return hits;
    },
  };
}
