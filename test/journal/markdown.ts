/**
 * Reading helpers for journal drafts in tests.
 */

export function headings(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
}

/** Text of one section without its heading. */
export function section(markdown: string, title: string): string {
  const start = markdown.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`Abschnitt ${title} fehlt`);
  const rest = markdown.slice(start + title.length + 5);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** Every reference in brackets outside the source table. */
export function bracketRefs(markdown: string): string[] {
  const body = markdown.slice(0, markdown.indexOf('\n## Quellen\n'));
  return [...body.matchAll(/\[([^\]]+)\]/g)].flatMap((match) => match[1]!.split(', '));
}
