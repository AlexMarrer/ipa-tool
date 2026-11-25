/**
 * Stand-in for the Windows Task Scheduler in tests (package 09, AK-09-16): a `SchtasksRunner` that keeps one
 * task in memory and answers like `schtasks`. No test talks to the real Task Scheduler.
 */
import { readFileSync } from 'node:fs';
import type { SchtasksResult, SchtasksRunner } from '../../src/schedule/schtasks.js';

const OK = (stdout = ''): SchtasksResult => ({ exitCode: 0, stdout, stderr: '' });

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The date as `schtasks` prints it in the German or the American display. */
export function formatSchedulerDate(date: Date, style: 'de' | 'en'): string {
  if (style === 'de') {
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  const hours = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${hours}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

export class FakeScheduler implements SchtasksRunner {
  /** Every call with its arguments, in order. */
  readonly calls: string[][] = [];
  /** Text of every imported XML file, decoded from UTF-16. */
  readonly imports: string[] = [];
  /** The registered task, or `null`. */
  xml: string | null = null;
  nextRun: Date | null = null;
  lastRun: Date | null = null;
  lastResult = 0;
  dateStyle: 'de' | 'en' = 'de';
  /** Answers by the first two arguments, for example `/Create`, to simulate failures. */
  failures = new Map<string, SchtasksResult>();
  /** Makes every call fail like a missing program. */
  rejectWith: Error | null = null;
  /** Other tasks that the list shows. */
  others = ['\\Microsoft\\Windows\\Defrag\\ScheduledDefrag'];

  constructor(private readonly name: string) {}

  /** The call verbs, for example `['/Query', '/Query', '/Create']`. */
  get verbs(): string[] {
    return this.calls.map((call) => call[0]!);
  }

  /** Calls that change something. */
  get changes(): string[][] {
    return this.calls.filter((call) => call[0] !== '/Query');
  }

  /** The definition as the Task Scheduler exports it: other dates, extra elements, no comment. */
  private exportXml(): string {
    return this.xml!
      .replace(/<!--[\s\S]*?-->\s*/, '')
      .replace(/(<StartBoundary>)\d{4}-\d{2}-\d{2}/g, '$12019-05-17')
      .replace('</RegistrationInfo>', `<URI>\\${this.name}</URI>\n  </RegistrationInfo>`)
      .replace('<Priority>7</Priority>', '<Priority>7</Priority>\n    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>');
  }

  private verbose(): string {
    const date = (value: Date | null): string => (value === null ? 'Nicht zutreffend' : formatSchedulerDate(value, this.dateStyle));
    const columns = ['YOO-880', `\\${this.name}`, date(this.nextRun), 'Bereit', 'Interaktiv/Hintergrund', date(this.lastRun), String(this.lastResult), 'Autor', 'cmd'];
    return `${columns.map((column) => `"${column}"`).join(',')}\r\n`;
  }

  async run(args: readonly string[]): Promise<SchtasksResult> {
    this.calls.push([...args]);
    if (this.rejectWith !== null) throw this.rejectWith;
    const forced = this.failures.get(args.slice(0, 2).join(' ')) ?? this.failures.get(args[0] ?? '');
    if (forced !== undefined) return forced;
    const [verb] = args;
    if (verb === '/Query') {
      if (args.includes('/XML')) {
        return this.xml === null ? { exitCode: 1, stdout: '', stderr: 'FEHLER: Das System kann die angegebene Datei nicht finden.\r\n' } : OK(this.exportXml());
      }
      if (args.includes('/V')) return this.xml === null ? { exitCode: 1, stdout: '', stderr: 'FEHLER\r\n' } : OK(this.verbose());
      const rows = [...this.others, ...(this.xml === null ? [] : [`\\${this.name}`])];
      return OK(`${rows.map((row) => `"${row}","N/A","Bereit"`).join('\r\n')}\r\n`);
    }
    if (verb === '/Create') {
      const file = args[args.indexOf('/XML') + 1]!;
      const bytes = readFileSync(file);
      if (bytes[0] !== 0xff || bytes[1] !== 0xfe) return { exitCode: 1, stdout: '', stderr: 'FEHLER: Die Datei ist kein UTF-16.\r\n' };
      if (this.xml !== null && !args.includes('/F')) return { exitCode: 1, stdout: '', stderr: 'FEHLER: Die Aufgabe existiert bereits.\r\n' };
      const text = bytes.subarray(2).toString('utf16le');
      this.imports.push(text);
      this.xml = text.replace(/\r\n/g, '\n');
      return OK('ERFOLG: Die geplante Aufgabe wurde erfolgreich erstellt.\r\n');
    }
    if (this.xml === null) return { exitCode: 1, stdout: '', stderr: 'FEHLER: Das System kann die angegebene Datei nicht finden.\r\n' };
    if (verb === '/Change') {
      const enabled = args.includes('/ENABLE');
      this.xml = this.xml.replace(/(<Settings>[\s\S]*?<Enabled>)(?:true|false)(<\/Enabled>)/, `$1${enabled}$2`);
      return OK('ERFOLG\r\n');
    }
    if (verb === '/Delete') {
      this.xml = null;
      return OK('ERFOLG\r\n');
    }
    if (verb === '/Run') return OK('ERFOLG: Die geplante Aufgabe wurde ausgeführt.\r\n');
    return { exitCode: 1, stdout: '', stderr: `FEHLER: unbekannter Aufruf ${String(verb)}\r\n` };
  }

  /** Changes the registered definition, as a user in the Task Scheduler would. */
  edit(change: (xml: string) => string): void {
    this.xml = change(this.xml!);
  }
}
