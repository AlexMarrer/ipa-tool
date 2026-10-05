import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';
import {
  CRON_UNTESTED_COMMENT,
  formatDuration,
  quotePosixArg,
  quoteWindowsArg,
  renderCron,
  renderWindowsTask,
  runTimesOfDay,
  type ScheduleTemplateInput,
  scheduleWarnings,
} from '../../src/schedule/templates.js';
import { childrenNamed, only, parseXml, textAt, type XmlElement } from '../helpers/xml.js';
import { TOOL_ROOT } from '../helpers/workspace.js';

const DEFAULTS = createDefaultConfig({ repositoryId: 'mein-projekt-3fa9c1', repoPath: 'C:/GIT/mein-projekt', timezone: 'Europe/Zurich' });

function templateInput(overrides: Partial<ScheduleTemplateInput> = {}): ScheduleTemplateInput {
  return {
    repositoryId: 'mein-projekt-3fa9c1',
    repoPath: 'C:/GIT/mein-projekt',
    timezone: 'Europe/Zurich',
    schedule: structuredClone(DEFAULTS.schedule),
    maxRunSeconds: DEFAULTS.limits.maxRunSeconds,
    claudeTimeoutSeconds: DEFAULTS.claude.timeoutSeconds,
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    cliPath: 'C:\\Tools\\ipa-tool\\dist\\cli.js',
    dataDir: null,
    startDay: '2026-10-06',
    ...overrides,
  };
}

function triggers(root: XmlElement): XmlElement[] {
  return childrenNamed(only(root, 'Triggers'), 'CalendarTrigger');
}

function daysOf(trigger: XmlElement): string[] {
  return only(only(trigger, 'ScheduleByWeek'), 'DaysOfWeek').children.map((day) => day.name);
}

describe('Vorlage für die Windows-Aufgabenplanung (AK-08-04)', () => {
  it('ist wohlgeformtes XML mit Triggern, Einstellungen und Aktion gemäss Konfiguration', () => {
    const document = parseXml(renderWindowsTask(templateInput(), { encoding: null }));
    const task = document.root;
    expect(task.name).toBe('Task');
    expect(task.attributes).toEqual({ version: '1.2', xmlns: 'http://schemas.microsoft.com/windows/2004/02/mit/task' });

    // One weekly trigger per workday from windowStart, repeated every intervalMinutes until windowEnd.
    const all = triggers(task);
    expect(all).toHaveLength(6);
    const daily = all.slice(0, 5);
    expect(daily.map(daysOf)).toEqual([['Monday'], ['Tuesday'], ['Wednesday'], ['Thursday'], ['Friday']]);
    for (const trigger of daily) {
      expect(textAt(trigger, 'StartBoundary')).toBe('2026-10-06T08:00:00');
      expect(textAt(trigger, 'Repetition/Interval')).toBe('PT2H');
      expect(textAt(trigger, 'Repetition/Duration')).toBe('PT10H');
      expect(textAt(trigger, 'Repetition/StopAtDurationEnd')).toBe('false');
      expect(textAt(trigger, 'ScheduleByWeek/WeeksInterval')).toBe('1');
      expect(textAt(trigger, 'Enabled')).toBe('true');
    }
    // One extra weekly trigger per entry of extraRunTimes, without repetition.
    const extra = all[5]!;
    expect(textAt(extra, 'StartBoundary')).toBe('2026-10-06T17:45:00');
    expect(childrenNamed(extra, 'Repetition')).toEqual([]);
    expect(daysOf(extra)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

    expect(textAt(task, 'Settings/MultipleInstancesPolicy')).toBe('IgnoreNew');
    expect(textAt(task, 'Settings/StartWhenAvailable')).toBe('true');
    expect(textAt(task, 'Settings/ExecutionTimeLimit')).toBe('PT40M');
    expect(textAt(task, 'Settings/DisallowStartIfOnBatteries')).toBe('false');
    expect(textAt(task, 'Settings/AllowStartOnDemand')).toBe('true');

    // Only while the user is logged on, without highest privileges and without a stored password.
    const principal = only(only(task, 'Principals'), 'Principal');
    expect(principal.attributes['id']).toBe('Author');
    expect(principal.children.map((child) => [child.name, child.text])).toEqual([
      ['LogonType', 'InteractiveToken'],
      ['RunLevel', 'LeastPrivilege'],
    ]);

    const actions = only(task, 'Actions');
    expect(actions.attributes['Context']).toBe('Author');
    expect(textAt(actions, 'Exec/Command')).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(textAt(actions, 'Exec/Arguments')).toBe('"C:\\Tools\\ipa-tool\\dist\\cli.js" capture --scheduled --repo "C:/GIT/mein-projekt"');
  });

  it('quotet und escaped Pfade mit Leerzeichen, & und Umlauten (Paket 08 §6)', () => {
    const text = renderWindowsTask(
      templateInput({
        nodePath: 'C:\\Program Files\\node & co\\node.exe',
        cliPath: 'C:\\Users\\Jürg\\ipa tool\\dist\\cli.js',
        repoPath: 'C:/GIT/mein projekt & Jürg',
        dataDir: 'D:/Daten/ipa daten',
      }),
      { encoding: null },
    );
    expect(text).toContain('node &amp; co');
    expect(text).toContain('J&#252;rg');
    // Outside the comment the document is plain ASCII, so a re-encoding redirection cannot damage it.
    expect(text.slice(text.indexOf('<Task'))).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
    const exec = only(only(parseXml(text).root, 'Actions'), 'Exec');
    expect(textAt(exec, 'Command')).toBe('"C:\\Program Files\\node & co\\node.exe"');
    expect(textAt(exec, 'Arguments')).toBe(
      '"C:\\Users\\Jürg\\ipa tool\\dist\\cli.js" capture --scheduled --repo "C:/GIT/mein projekt & Jürg" --data-dir "D:/Daten/ipa daten"',
    );
  });

  it.runIf(process.platform === 'win32')('Node.js zerlegt die Argumente der Aufgabe unter Windows in genau die vorgesehenen Werte', () => {
    const script = path.join(TOOL_ROOT, 'test', 'helpers', 'print-argv.mjs');
    const input = templateInput({ cliPath: script, repoPath: 'C:/GIT/mein projekt & "Jürg"', dataDir: 'D:\\Daten\\ipa daten\\' });
    const exec = only(only(parseXml(renderWindowsTask(input, { encoding: null })).root, 'Actions'), 'Exec');
    // The Task Scheduler passes Arguments unchanged on the command line of Command.
    const child = spawnSync(process.execPath, [textAt(exec, 'Arguments')], {
      argv0: quoteWindowsArg(process.execPath),
      windowsVerbatimArguments: true,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(['capture', '--scheduled', '--repo', 'C:/GIT/mein projekt & "Jürg"', '--data-dir', 'D:\\Daten\\ipa daten\\']);
  });

  it('enthält den Kommentarblock mit Import-Befehl und Hinweisen, ohne Pfade und ohne "--" im Kommentar', () => {
    const document = parseXml(renderWindowsTask(templateInput({ repoPath: 'C:/Temp/C--GIT/projekt--neu' }), { encoding: null }));
    expect(document.comments).toHaveLength(1);
    const comment = document.comments[0]!;
    expect(comment).toContain('schtasks /Create /XML "<Pfad dieser Datei>" /TN ipa-assistant-mein-projekt-3fa9c1');
    expect(comment).toContain('Die Trigger verwenden die Systemzeit');
    expect(comment).toContain('Option scheduled');
    expect(comment).toContain('Konsolenfenster');
    expect(comment).not.toContain('C:/Temp');
    // Comments cannot contain "--"; the description names the option literally.
    expect(textAt(document.root, 'RegistrationInfo/Description')).toContain('ipa capture --scheduled');
    expect(textAt(document.root, 'RegistrationInfo/Description')).toContain('C:/Temp/C--GIT/projekt--neu');
  });

  it('deklariert UTF-16 nur für die Datei, auf stdout keine Kodierung', () => {
    expect(parseXml(renderWindowsTask(templateInput(), { encoding: 'UTF-16' })).declaration).toEqual({ version: '1.0', encoding: 'UTF-16' });
    expect(parseXml(renderWindowsTask(templateInput(), { encoding: null })).declaration).toEqual({ version: '1.0' });
  });

  it('setzt ExecutionTimeLimit auf maxRunSeconds plus 10 Minuten', () => {
    const limit = (maxRunSeconds: number) => textAt(parseXml(renderWindowsTask(templateInput({ maxRunSeconds }), { encoding: null })).root, 'Settings/ExecutionTimeLimit');
    expect(limit(1800)).toBe('PT40M');
    expect(limit(3000)).toBe('PT1H');
    expect(limit(1805)).toBe('PT40M5S');
  });

  it('lässt die Wiederholung weg, wenn das Intervall länger als das Fenster ist, und weist darauf hin', () => {
    const schedule = { ...DEFAULTS.schedule, windowStart: '08:00', windowEnd: '09:00', intervalMinutes: 120, extraRunTimes: [] };
    const input = templateInput({ schedule });
    const all = triggers(parseXml(renderWindowsTask(input, { encoding: null })).root);
    expect(all).toHaveLength(5);
    expect(all.every((trigger) => childrenNamed(trigger, 'Repetition').length === 0)).toBe(true);
    expect(scheduleWarnings(input, 'windows').join('\n')).toContain('schedule.intervalMinutes (120) ist länger als das Zeitfenster (60 Minuten)');
  });

  it('sortiert die Arbeitstage von Montag bis Sonntag', () => {
    const schedule = { ...DEFAULTS.schedule, workdays: ['sun' as const, 'wed' as const, 'mon' as const] };
    const all = triggers(parseXml(renderWindowsTask(templateInput({ schedule }), { encoding: null })).root);
    expect(all.slice(0, 3).map(daysOf)).toEqual([['Monday'], ['Wednesday'], ['Sunday']]);
    expect(daysOf(all[3]!)).toEqual(['Monday', 'Wednesday', 'Sunday']);
  });
});

describe('cron-Vorlage (AK-08-05)', () => {
  it('erzeugt Zeilen mit CRON_TZ, absoluten Pfaden und dem Kommentar „nicht geprüft“', () => {
    const text = renderCron(templateInput({ nodePath: '/usr/bin/node', cliPath: '/opt/ipa tool/dist/cli.js', repoPath: "/home/anna/projekt's 100%" }));
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe(CRON_UNTESTED_COMMENT);
    expect(lines[0]).toBe('# nicht geprüft – Plattform in V1 nicht getestet');
    expect(lines).toContain('CRON_TZ=Europe/Zurich');
    const command = `'/usr/bin/node' '/opt/ipa tool/dist/cli.js' capture --scheduled --repo '/home/anna/projekt'\\''s 100\\%'`;
    expect(lines.filter((line) => !line.startsWith('#') && !line.startsWith('CRON_TZ='))).toEqual([
      `0 8,10,12,14,16,18 * * 1-5 ${command}`,
      `45 17 * * 1-5 ${command}`,
    ]);
    expect(lines.findIndex((line) => line.startsWith('CRON_TZ='))).toBeLessThan(lines.findIndex((line) => line.startsWith('0 ')));
  });

  it('gruppiert Intervalle, die keine volle Stunde sind, nach Minute und übernimmt --data-dir', () => {
    const schedule = { ...DEFAULTS.schedule, intervalMinutes: 90, workdays: ['mon' as const, 'wed' as const, 'fri' as const] };
    const text = renderCron(templateInput({ schedule, nodePath: '/n', cliPath: '/c.js', repoPath: '/r', dataDir: '/daten' }));
    const entries = text.split('\n').filter((line) => /^\d/.test(line));
    expect(entries).toEqual([
      "0 8,11,14,17 * * 1,3,5 '/n' '/c.js' capture --scheduled --repo '/r' --data-dir '/daten'",
      "30 9,12,15 * * 1,3,5 '/n' '/c.js' capture --scheduled --repo '/r' --data-dir '/daten'",
      "45 17 * * 1,3,5 '/n' '/c.js' capture --scheduled --repo '/r' --data-dir '/daten'",
    ]);
  });

  it('bildet die Wochentage auf cron-Nummern ab (Sonntag 0)', () => {
    const field = (workdays: ScheduleTemplateInput['schedule']['workdays']) =>
      renderCron(templateInput({ schedule: { ...DEFAULTS.schedule, workdays } })).split('\n').find((line) => line.startsWith('0 '))!.split(' ')[4];
    expect(field(['sat', 'sun'])).toBe('0,6');
    expect(field(['mon', 'tue'])).toBe('1,2');
    expect(field(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).toBe('0-6');
    expect(field(['sun', 'mon', 'tue', 'thu'])).toBe('0-2,4');
  });
});

describe('Hinweise und Randfälle der Vorlagen', () => {
  it('warnt, wenn ein Zusatzlauf ausserhalb des Fensters liegt und durch --scheduled übersprungen würde (Paket 08 §6)', () => {
    const input = templateInput({ schedule: { ...DEFAULTS.schedule, extraRunTimes: ['07:30', '17:45', '18:30'] } });
    const warnings = scheduleWarnings(input, 'windows');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('07:30');
    expect(warnings[1]).toContain('Der Zusatzlauf 18:30 (schedule.extraRunTimes) liegt ausserhalb des Zeitfensters 08:00–18:00');
    expect(warnings[1]).toContain('ipa capture --scheduled würde diesen Lauf überspringen');
    // The template keeps the configured extra runs.
    expect(triggers(parseXml(renderWindowsTask(input, { encoding: null })).root).map((trigger) => textAt(trigger, 'StartBoundary')).slice(5)).toEqual([
      '2026-10-06T07:30:00',
      '2026-10-06T17:45:00',
      '2026-10-06T18:30:00',
    ]);
  });

  it('warnt nur für Windows, wenn claude.timeoutSeconds die Reserve von 10 Minuten übersteigt', () => {
    expect(scheduleWarnings(templateInput(), 'windows')).toEqual([]);
    const input = templateInput({ claudeTimeoutSeconds: 900 });
    expect(scheduleWarnings(input, 'windows').join('\n')).toContain('claude.timeoutSeconds (900 s)');
    expect(scheduleWarnings(input, 'cron')).toEqual([]);
  });

  it('lehnt eine Konfiguration ohne Arbeitstag mit Exit-Code 2 ab', () => {
    const input = templateInput({ schedule: { ...DEFAULTS.schedule, workdays: [] } });
    for (const render of [() => renderWindowsTask(input, { encoding: null }), () => renderCron(input)]) {
      expect(render).toThrow(IpaError);
      try {
        render();
      } catch (error) {
        expect((error as IpaError).exitCode).toBe(2);
        expect((error as IpaError).message).toContain('schedule.workdays');
      }
    }
  });

  it('nennt die Startzeiten eines Arbeitstags einschliesslich Fensterende und Zusatzlauf', () => {
    expect(runTimesOfDay(DEFAULTS.schedule)).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '17:45', '18:00']);
  });

  it('quotet Argumente nach den Regeln der Windows-Befehlszeile und für /bin/sh', () => {
    expect(quoteWindowsArg('C:\\Program Files\\node.exe')).toBe('"C:\\Program Files\\node.exe"');
    expect(quoteWindowsArg('C:\\')).toBe('"C:\\\\"');
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
    expect(quotePosixArg("it's")).toBe(`'it'\\''s'`);
    expect(quotePosixArg('50%')).toBe(`'50\\%'`);
  });

  it('schreibt Dauern als xs:duration', () => {
    expect(formatDuration(7200)).toBe('PT2H');
    expect(formatDuration(5400)).toBe('PT1H30M');
    expect(formatDuration(2405)).toBe('PT40M5S');
    expect(formatDuration(0)).toBe('PT0S');
  });
});
