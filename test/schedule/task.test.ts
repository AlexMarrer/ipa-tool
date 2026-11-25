import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import type { SchtasksResult, SchtasksRunner } from '../../src/schedule/schtasks.js';
import {
  compareTasks,
  splitWindowsArguments,
  expectedTask,
  parseDurationSeconds,
  parseSchedulerDate,
  parseTaskRuns,
  queryTask,
  readTaskDefinition,
  RESULT_NEVER_RUN,
  RESULT_RUNNING,
} from '../../src/schedule/task.js';
import { renderWindowsTask, type ScheduleTemplateInput } from '../../src/schedule/templates.js';
import { childrenNamed, findPath, parseXml, textAt } from '../../src/schedule/xml.js';

const DEFAULTS = createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' });

function input(overrides: Partial<ScheduleTemplateInput> = {}, schedule: Partial<typeof DEFAULTS.schedule> = {}): ScheduleTemplateInput {
  return {
    repositoryId: 'projekt-3fa9c1',
    repoPath: 'C:/GIT/projekt',
    timezone: 'Europe/Zurich',
    schedule: { ...DEFAULTS.schedule, ...schedule },
    maxRunSeconds: 1800,
    claudeTimeoutSeconds: 600,
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    cliPath: 'C:\\Tool\\dist\\cli.js',
    dataDir: null,
    startDay: '2026-10-06',
    ...overrides,
  };
}

const rendered = (value: ScheduleTemplateInput, enabled = true): string => renderWindowsTask(value, { encoding: null, enabled });

describe('XML-Leser (Paket 09 §4.3)', () => {
  it('liest Elemente, Text, Zeichenreferenzen und ignoriert Deklaration, Kommentare und Namensräume', () => {
    const root = parseXml(
      '\uFEFF<?xml version="1.0" encoding="UTF-16"?>\n<!-- Kommentar -- mit zwei Strichen -->\n' +
        '<t:Task xmlns:t="urn:x"><t:A id="1">a &amp; b &lt;c&gt; &#252; &#x20AC;</t:A><B/><C><![CDATA[<roh>]]></C></t:Task>',
    );
    expect(root.name).toBe('Task');
    expect(textAt(root, 'A')).toBe('a & b <c> ü €');
    expect(findPath(root, 'B')?.children).toEqual([]);
    expect(textAt(root, 'C')).toBe('<roh>');
    expect(childrenNamed(root, 'A')).toHaveLength(1);
    expect(textAt(root, 'Gibt/Es/Nicht')).toBeNull();
  });

  it('lehnt unvollständiges und unausgewogenes XML ab', () => {
    for (const broken of ['', '<A>', '<A></B>', '<A/><B/>', 'Text<A/>', '<A>text', '</A>']) {
      expect(() => parseXml(broken), broken).toThrow();
    }
  });

  it('wertet xs:duration aus', () => {
    expect(parseDurationSeconds('PT2H')).toBe(7200);
    expect(parseDurationSeconds('PT1H30M')).toBe(5400);
    expect(parseDurationSeconds('PT40M5S')).toBe(2405);
    expect(parseDurationSeconds('P1DT2H')).toBe(93600);
    expect(parseDurationSeconds('P1D')).toBe(86400);
    for (const bad of [null, '', 'P', 'PT', '2H', 'abc']) expect(parseDurationSeconds(bad), String(bad)).toBeNull();
  });
});

describe('Definition der Aufgabe (AK-09-13)', () => {
  it('liest aus der Vorlage genau das, was install erzeugen würde', () => {
    const variants: ScheduleTemplateInput[] = [
      input(),
      input({}, { workdays: ['sat', 'sun', 'mon'], extraRunTimes: [] }),
      input({}, { intervalMinutes: 720 }),
      input({ dataDir: 'C:/Daten/ipa daten' }, { extraRunTimes: ['07:30', '17:45', '18:30'] }),
      input({ nodePath: 'C:\\Müller & Söhne\\node.exe', maxRunSeconds: 125 }),
    ];
    for (const variant of variants) {
      expect(readTaskDefinition(rendered(variant)), JSON.stringify(variant.schedule)).toEqual(expectedTask(variant));
    }
  });

  it('erkennt eine pausierte Aufgabe', () => {
    expect(readTaskDefinition(rendered(input(), false)).enabled).toBe(false);
    expect(readTaskDefinition(rendered(input(), true)).enabled).toBe(true);
  });

  it('beschreibt die Trigger als Wochentag, Startzeit und Wiederholung', () => {
    expect(expectedTask(input({}, { workdays: ['mon', 'tue'], extraRunTimes: ['17:45'] })).triggers).toEqual([
      'mon@08:00#7200/36000',
      'mon@17:45#-',
      'tue@08:00#7200/36000',
      'tue@17:45#-',
    ]);
    expect(expectedTask(input({}, { workdays: ['mon'], extraRunTimes: [], intervalMinutes: 720 })).triggers).toEqual(['mon@08:00#-']);
  });

  it('gilt eine Aufgabe im Export-Format der Aufgabenplanung als aktuell', () => {
    // The export has another date, extra elements and one trigger for all workdays.
    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.6" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2026-11-20T09:15:00.1234567</Date>
    <Author>YOO-880\\Alex</Author>
    <URI>\\ipa-assistant-projekt-3fa9c1</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <Repetition><Interval>PT2H</Interval><Duration>PT10H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-11-20T08:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek><DaysOfWeek><Monday /><Tuesday /><Wednesday /><Thursday /><Friday /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>
    </CalendarTrigger>
    <CalendarTrigger>
      <StartBoundary>2026-11-20T17:45:00</StartBoundary>
      <ScheduleByWeek><DaysOfWeek><Monday /><Tuesday /><Wednesday /><Thursday /><Friday /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-21-1</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <IdleSettings><StopOnIdleEnd>true</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT40M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"C:\\Program Files\\nodejs\\node.exe"</Command>
      <Arguments>"C:\\Tool\\dist\\cli.js" capture --scheduled --repo "C:/GIT/projekt"</Arguments>
    </Exec>
  </Actions>
</Task>`;
    expect(compareTasks(expectedTask(input()), readTaskDefinition(xml))).toEqual([]);
  });

  it('meldet jede Abweichung einzeln', () => {
    const wanted = expectedTask(input());
    const actualOf = (edit: (xml: string) => string) => readTaskDefinition(edit(rendered(input())));
    expect(compareTasks(wanted, actualOf((xml) => xml))).toEqual([]);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('node.exe', 'node22.exe')))).toEqual(['node_path']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('dist\\cli.js', 'neu\\cli.js')))).toEqual(['cli_path']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('--repo', '--data-dir')))).toEqual(['arguments']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('<Interval>PT2H</Interval>', '<Interval>PT1H</Interval>')))).toEqual(['triggers']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('T17:45:00', 'T17:30:00')))).toEqual(['triggers']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('<Friday />', '<Saturday />')))).toEqual(['triggers']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('PT40M', 'PT1H')))).toEqual(['execution_time_limit']);
    expect(compareTasks(wanted, actualOf((xml) => xml.replace('<Interval>PT2H</Interval>', '<Interval>PT1H</Interval>').replace('node.exe', 'x.exe')))).toEqual(['node_path', 'triggers']);
  });

  it('behandelt einen fremden Trigger und einen deaktivierten Trigger', () => {
    const base = rendered(input());
    const withLogon = base.replace('</Triggers>', '<LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>');
    expect(compareTasks(expectedTask(input()), readTaskDefinition(withLogon))).toEqual(['triggers']);
    const disabled = base.replace('</Triggers>', '<LogonTrigger><Enabled>false</Enabled></LogonTrigger></Triggers>');
    expect(compareTasks(expectedTask(input()), readTaskDefinition(disabled))).toEqual([]);
  });

  it('vergleicht Pfade ohne Gross- und Kleinschreibung, mit beliebiger Trennerrichtung und ohne Umlaute', () => {
    const wanted = expectedTask(input({ nodePath: 'C:\\Müller\\Node\\node.exe', cliPath: 'C:\\Tool\\dist\\cli.js' }));
    // The Task Scheduler prints the OEM code page, so an umlaut arrives as another character.
    const actual = { ...wanted, command: '"c:/m?ller/node/NODE.EXE"', arguments: wanted.arguments!.replace('C:\\Tool', 'c:/tool') };
    expect(compareTasks(wanted, actual)).toEqual([]);
  });
});

describe('Datumsangaben der Aufgabenplanung', () => {
  const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => new Date(year, month - 1, day, hour, minute, second);

  it('liest die deutsche, die amerikanische und die ISO-Anzeige', () => {
    expect(parseSchedulerDate('24.11.2026 10:21:35', 'dmy')).toEqual([at(2026, 11, 24, 10, 21, 35)]);
    expect(parseSchedulerDate('11/24/2026 10:21:35 AM', 'mdy')).toEqual([at(2026, 11, 24, 10, 21, 35)]);
    expect(parseSchedulerDate('11/24/2026 6:00:00 PM', 'mdy')).toEqual([at(2026, 11, 24, 18, 0, 0)]);
    expect(parseSchedulerDate('11/24/2026 12:05:00 AM', 'mdy')).toEqual([at(2026, 11, 24, 0, 5, 0)]);
    expect(parseSchedulerDate('2026-11-24 18:00:00', 'dmy')).toEqual([at(2026, 11, 24, 18, 0, 0)]);
    expect(parseSchedulerDate('24/11/2026 18:00', 'dmy')).toEqual([at(2026, 11, 24, 18, 0, 0)]);
    expect(parseSchedulerDate('24.11.26 18:00', 'dmy')).toEqual([at(2026, 11, 24, 18, 0, 0)]);
  });

  it('liefert für eine zweideutige Angabe beide Lesarten, die der Systemsprache zuerst', () => {
    expect(parseSchedulerDate('03/04/2026 08:00:00', 'dmy')).toEqual([at(2026, 4, 3, 8), at(2026, 3, 4, 8)]);
    expect(parseSchedulerDate('03/04/2026 08:00:00', 'mdy')).toEqual([at(2026, 3, 4, 8), at(2026, 4, 3, 8)]);
    expect(parseSchedulerDate('05/05/2026 08:00:00', 'dmy')).toHaveLength(1);
  });

  it('verwirft Text und unmögliche Daten', () => {
    for (const bad of ['Nicht zutreffend', 'N/A', '', '31.02.2026 10:00:00', '24.11.2026 25:00:00', '13/13/2026 10:00:00']) {
      expect(parseSchedulerDate(bad, 'dmy'), bad).toEqual([]);
    }
  });

  const NOW = at(2026, 11, 25, 12, 0, 0);
  const row = (next: string, last: string, result: string) =>
    `"YOO-880","\\ipa-assistant-x","${next}","Bereit","Interaktiv/Hintergrund","${last}","${result}","Autor","cmd","Nicht zutreffend","Kommentar","Aktiviert"`;

  it('liest nächsten und letzten Lauf und das Ergebnis aus der ausführlichen Ausgabe', () => {
    expect(parseTaskRuns(row('25.11.2026 14:00:00', '25.11.2026 10:00:00', '0'), NOW, 'dmy')).toEqual({
      nextRun: at(2026, 11, 25, 14),
      lastRun: at(2026, 11, 25, 10),
      lastResult: 0,
    });
  });

  it('liefert null für „Nicht zutreffend“ und für eine Aufgabe, die nie lief', () => {
    expect(parseTaskRuns(row('Nicht zutreffend', '30.11.1999 00:00:00', String(RESULT_NEVER_RUN)), NOW, 'dmy')).toEqual({
      nextRun: null,
      lastRun: null,
      lastResult: RESULT_NEVER_RUN,
    });
    expect(parseTaskRuns(row('N/A', 'N/A', 'abc'), NOW, 'dmy')).toEqual({ nextRun: null, lastRun: null, lastResult: null });
    expect(parseTaskRuns('', NOW, 'dmy')).toEqual({ nextRun: null, lastRun: null, lastResult: null });
  });

  it('entscheidet eine zweideutige Angabe nach der Plausibilität', () => {
    // 12/11/2026 is 12 November (day first) or 11 December (month first); NOW is 25 November 2026.
    const text = '12/11/2026 08:00:00';
    expect(parseTaskRuns(row(text, 'Nicht zutreffend', '0'), NOW, 'dmy').nextRun).toEqual(at(2026, 12, 11, 8));
    expect(parseTaskRuns(row(text, 'Nicht zutreffend', '0'), NOW, 'mdy').nextRun).toEqual(at(2026, 12, 11, 8));
    expect(parseTaskRuns(row('Nicht zutreffend', text, '0'), NOW, 'dmy').lastRun).toEqual(at(2026, 11, 12, 8));
    expect(parseTaskRuns(row('Nicht zutreffend', text, '0'), NOW, 'mdy').lastRun).toEqual(at(2026, 11, 12, 8));
  });

  it('nimmt bei mehreren Zeilen (mehrere Trigger) den frühesten nächsten Lauf', () => {
    const csv = [row('25.11.2026 17:45:00', '25.11.2026 10:00:00', '0'), row('25.11.2026 14:00:00', '25.11.2026 10:00:00', '0')].join('\n');
    expect(parseTaskRuns(csv, NOW, 'dmy').nextRun).toEqual(at(2026, 11, 25, 14));
  });

  it('meldet das laufende Ergebnis', () => {
    expect(parseTaskRuns(row('25.11.2026 14:00:00', '25.11.2026 12:00:00', String(RESULT_RUNNING)), NOW, 'dmy').lastResult).toBe(RESULT_RUNNING);
  });
});

describe('queryTask mit Ersatz-Runner (AK-09-13)', () => {
  const NOW = new Date(2026, 10, 25, 12, 0, 0);
  const name = 'ipa-assistant-projekt-3fa9c1';
  const ok = (stdout: string): SchtasksResult => ({ exitCode: 0, stdout, stderr: '' });
  const failure = (stderr = 'FEHLER: Das System kann die angegebene Datei nicht finden.\n'): SchtasksResult => ({ exitCode: 1, stdout: '', stderr });
  const verbose = `"H","\\${name}","25.11.2026 14:00:00","Bereit","I","25.11.2026 10:00:00","0"\n`;

  function runner(handlers: { xml: SchtasksResult | Error; list?: SchtasksResult | Error; verbose?: SchtasksResult | Error }): { runner: SchtasksRunner; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      runner: {
        async run(args) {
          calls.push([...args]);
          const pick = args.includes('/XML') ? handlers.xml : args.includes('/V') ? (handlers.verbose ?? ok(verbose)) : (handlers.list ?? ok(''));
          if (pick instanceof Error) throw pick;
          return pick;
        },
      },
    };
  }

  it('erkennt eine fehlende Aufgabe an der Aufgabenliste, nicht am lokalisierten Text', async () => {
    const { runner: fake, calls } = runner({ xml: failure('Irgendein Text in einer anderen Sprache\n'), list: ok(`"\\Microsoft\\Windows\\X","N/A","Bereit"\n"\\Andere","N/A","Bereit"\n`) });
    const status = await queryTask(fake, input(), NOW);
    expect(status).toMatchObject({ taskName: name, state: 'not_installed', enabled: null, differences: [], detail: null, nextRun: null, lastRun: null });
    expect(calls).toEqual([
      ['/Query', '/TN', name, '/XML'],
      ['/Query', '/FO', 'CSV', '/NH'],
    ]);
  });

  it('meldet einen Fehler, wenn die Aufgabe in der Liste steht, sich aber nicht lesen lässt', async () => {
    const { runner: fake } = runner({ xml: failure('FEHLER: Zugriff verweigert\n'), list: ok(`"\\${name}","N/A","Bereit"\n`) });
    const status = await queryTask(fake, input(), NOW);
    expect(status.state).toBe('error');
    expect(status.detail).toContain('Zugriff verweigert');
  });

  it('meldet einen Fehler, wenn auch die Liste fehlschlägt oder schtasks nicht startet', async () => {
    const both = await queryTask(runner({ xml: failure(), list: failure('FEHLER: kaputt\n') }).runner, input(), NOW);
    expect(both).toMatchObject({ state: 'error' });
    expect(both.detail).toContain('kaputt');
    const missing = await queryTask(runner({ xml: Object.assign(new Error('spawn schtasks ENOENT'), { code: 'ENOENT' }) }).runner, input(), NOW);
    expect(missing).toMatchObject({ state: 'error' });
    expect(missing.detail).toContain('ENOENT');
    const broken = await queryTask(runner({ xml: ok('<Task><Unvollständig>') }).runner, input(), NOW);
    expect(broken.state).toBe('error');
    expect(broken.detail).toContain('Definition');
  });

  it('meldet aktiv, pausiert und veraltet mit nächstem und letztem Lauf', async () => {
    const active = await queryTask(runner({ xml: ok(rendered(input())) }).runner, input(), NOW);
    expect(active).toMatchObject({ state: 'active', enabled: true, differences: [], detail: null, lastResult: 0, running: false });
    expect(active.nextRun).toEqual(new Date(2026, 10, 25, 14));
    expect(active.lastRun).toEqual(new Date(2026, 10, 25, 10));

    const paused = await queryTask(runner({ xml: ok(rendered(input(), false)) }).runner, input(), NOW);
    expect(paused).toMatchObject({ state: 'paused', enabled: false, differences: [], nextRun: null });

    const stale = await queryTask(runner({ xml: ok(rendered(input({}, { intervalMinutes: 60 }))) }).runner, input(), NOW);
    expect(stale).toMatchObject({ state: 'stale', enabled: true, differences: ['triggers'] });
    const stalePaused = await queryTask(runner({ xml: ok(rendered(input({}, { intervalMinutes: 60 }), false)) }).runner, input(), NOW);
    expect(stalePaused).toMatchObject({ state: 'stale', enabled: false });
  });

  it('bleibt bei nicht lesbaren Laufzeiten im Zustand der Definition', async () => {
    const status = await queryTask(runner({ xml: ok(rendered(input())), verbose: failure() }).runner, input(), NOW);
    expect(status).toMatchObject({ state: 'active', nextRun: null, lastRun: null, lastResult: null });
    const running = await queryTask(
      runner({ xml: ok(rendered(input())), verbose: ok(`"H","\\${name}","25.11.2026 14:00:00","Wird ausgeführt","I","25.11.2026 12:00:00","${RESULT_RUNNING}"\n`) }).runner,
      input(),
      NOW,
    );
    expect(running.running).toBe(true);
  });
});

describe('Vergleich der Aufgabe: Pfade und Optionen (Nacharbeit nach der Review)', () => {
  type Definition = Parameters<typeof compareTasks>[0];
  const definition = (command: string, args: string): Definition => ({ enabled: true, command, arguments: args, executionTimeLimitSeconds: 2400, triggers: [] });
  const wanted = definition('"C:\\Program Files\\nodejs\\node.exe"', '"C:\\Tool\\dist\\cli.js" capture --scheduled --repo "C:/GIT/my project"');

  it('unterscheidet Pfade, die sich nur in der Zahl der Leerzeichen unterscheiden', () => {
    expect(compareTasks(wanted, definition(wanted.command!, wanted.arguments!.replace('my project', 'my  project')))).toEqual(['arguments']);
    expect(compareTasks(wanted, definition('"C:\\Program  Files\\nodejs\\node.exe"', wanted.arguments!))).toEqual(['node_path']);
  });

  it('unterscheidet Gross- und Kleinschreibung bei Optionen, nicht bei Pfaden', () => {
    expect(compareTasks(wanted, definition(wanted.command!, wanted.arguments!.replace('--scheduled', '--SCHEDULED')))).toEqual(['arguments']);
    expect(compareTasks(wanted, definition(wanted.command!, wanted.arguments!.replace('C:/GIT/my project', 'c:\\git\\MY PROJECT')))).toEqual([]);
  });

  it('liest Argumente nach den Regeln der C-Laufzeit', () => {
    expect(splitWindowsArguments('"a b" c "d\\"e" f\\\\g "h\\\\"')).toEqual(['a b', 'c', 'd"e', 'f\\\\g', 'h\\']);
  });
});
