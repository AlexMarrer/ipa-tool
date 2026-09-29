/**
 * German texts for Commander's help and error messages (spec.md §6.5).
 */

const HELP_TITLES: Record<string, string> = {
  'Usage:': 'Aufruf:',
  'Options:': 'Optionen:',
  'Commands:': 'Befehle:',
  'Arguments:': 'Argumente:',
  'Global Options:': 'Globale Optionen:',
};

export function translateHelpTitle(title: string): string {
  return HELP_TITLES[title] ?? title;
}

const RULES: [RegExp, string][] = [
  [/error: unknown option '([^']*)'/, "Fehler: unbekannte Option '$1'"],
  [/error: unknown command '([^']*)'/, "Fehler: unbekannter Befehl '$1'"],
  [/error: missing required argument '([^']*)'/, "Fehler: Argument '$1' fehlt"],
  [/error: option '([^']*)' argument missing/, "Fehler: Für die Option '$1' fehlt der Wert"],
  [/error: required option '([^']*)' not specified/, "Fehler: Die Option '$1' ist erforderlich"],
  [/error: too many arguments(?: for '([^']*)')?\. Expected \d+ arguments? but got \d+: (.*)\./, 'Fehler: zu viele Argumente: $2'],
  [/\(Did you mean (.+)\?\)/, '(Meinten Sie $1?)'],
  [/^error: /m, 'Fehler: '],
];

export function translateCommanderMessage(text: string): string {
  let result = text;
  for (const [pattern, replacement] of RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
