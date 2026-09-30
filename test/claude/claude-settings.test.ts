import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeConfigDir,
  defaultSettingsLocations,
  parseRegistrySettings,
  readSettingsDocuments,
  type SettingsLocations,
} from '../../src/claude/claude-settings.js';
import { createTempDir } from '../helpers/workspace.js';

describe('Orte der Claude-Einstellungen (Claude Code 2.1.114)', () => {
  it('nimmt CLAUDE_CONFIG_DIR, sonst .claude im Benutzerverzeichnis des claude-Prozesses', () => {
    expect(claudeConfigDir({ claude_config_dir: 'C:/konfig', USERPROFILE: 'C:/Users/x' }, 'win32')).toBe(path.resolve('C:/konfig'));
    expect(claudeConfigDir({ USERPROFILE: 'C:\\Users\\x' }, 'win32')).toBe(path.join('C:\\Users\\x', '.claude'));
    expect(claudeConfigDir({ HOME: '/home/x' }, 'linux')).toBe(path.join('/home/x', '.claude'));
    expect(claudeConfigDir({}, 'linux')).toBe(path.join(os.homedir(), '.claude'));
  });

  it('kennt Benutzer-, Server- und verwaltete Einstellungen, unter Windows auch die Richtlinien der Registry', () => {
    const windows = defaultSettingsLocations({ CLAUDE_CONFIG_DIR: 'C:/konfig' }, 'win32');
    expect(windows.files).toEqual([
      { label: 'Benutzereinstellungen', file: path.join(path.resolve('C:/konfig'), 'settings.json') },
      { label: 'Server-Einstellungen (Cache)', file: path.join(path.resolve('C:/konfig'), 'remote-settings.json') },
      { label: 'verwaltete Einstellungen', file: 'C:\\Program Files\\ClaudeCode\\managed-settings.json' },
    ]);
    expect(windows.dropInDirs).toEqual([{ label: 'verwaltete Einstellungen', dir: 'C:\\Program Files\\ClaudeCode\\managed-settings.d' }]);
    expect(windows.registryKeys.map((entry) => entry.key)).toEqual(['HKLM\\SOFTWARE\\Policies\\ClaudeCode', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode']);

    const linux = defaultSettingsLocations({ HOME: '/home/x' }, 'linux');
    expect(linux.files[2]?.file).toBe('/etc/claude-code/managed-settings.json');
    expect(linux.registryKeys).toEqual([]);
    expect(defaultSettingsLocations({}, 'darwin').dropInDirs[0]?.dir).toBe('/Library/Application Support/ClaudeCode/managed-settings.d');
  });
});

describe('Lesen der Claude-Einstellungen', () => {
  it('liest vorhandene Dokumente mit BOM, Drop-ins alphabetisch ohne versteckte und fremde Dateien, und meldet ungültige', async () => {
    const dir = await createTempDir('einstellungen');
    const dropIns = path.join(dir, 'managed-settings.d');
    await mkdir(dropIns);
    await writeFile(path.join(dir, 'settings.json'), `\uFEFF${JSON.stringify({ model: 'sonnet' })}`);
    await writeFile(path.join(dir, 'kaputt.json'), '{ kaputt');
    await writeFile(path.join(dir, 'liste.json'), '[1, 2]');
    await writeFile(path.join(dropIns, '20-b.json'), '{"b": 2}');
    await writeFile(path.join(dropIns, '10-a.json'), '{"a": 1}');
    await writeFile(path.join(dropIns, '.versteckt.json'), '{"x": 1}');
    await writeFile(path.join(dropIns, 'notiz.txt'), 'kein json');
    const locations: SettingsLocations = {
      files: [
        { label: 'Benutzereinstellungen', file: path.join(dir, 'settings.json') },
        { label: 'fehlt', file: path.join(dir, 'gibt-es-nicht.json') },
        { label: 'kaputt', file: path.join(dir, 'kaputt.json') },
        { label: 'liste', file: path.join(dir, 'liste.json') },
      ],
      dropInDirs: [
        { label: 'verwaltete Einstellungen', dir: dropIns },
        { label: 'ohne Ordner', dir: path.join(dir, 'gibt-es-nicht.d') },
      ],
      registryKeys: [],
    };
    const read = await readSettingsDocuments({}, locations);
    expect(read.documents).toEqual([
      { label: 'Benutzereinstellungen', settings: { model: 'sonnet' } },
      { label: 'verwaltete Einstellungen 10-a.json', settings: { a: 1 } },
      { label: 'verwaltete Einstellungen 20-b.json', settings: { b: 2 } },
    ]);
    expect(read.unreadable).toEqual([`kaputt: ${path.join(dir, 'kaputt.json')}`, `liste: ${path.join(dir, 'liste.json')}`]);
  });

  it('liest den Wert Settings aus der Ausgabe von reg query, auch mehrzeilig und als REG_EXPAND_SZ', () => {
    const key = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ClaudeCode';
    expect(parseRegistrySettings(`\r\n${key}\r\n    Settings    REG_SZ    {"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}\r\n\r\n`)).toBe('{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}');
    expect(parseRegistrySettings(`\r\n${key}\r\n    Settings    REG_EXPAND_SZ    {\r\n  "apiKeyHelper": "x"\r\n}\r\n\r\n`)).toBe('{\r\n  "apiKeyHelper": "x"\r\n}');
    expect(parseRegistrySettings(`\r\n${key}\r\n    Andere    REG_SZ    {}\r\n`)).toBeNull();
  });

  it.skipIf(process.platform !== 'win32')('behandelt einen fehlenden Registry-Schlüssel als nicht vorhanden', async () => {
    const read = await readSettingsDocuments(process.env, {
      files: [],
      dropInDirs: [],
      registryKeys: [{ label: 'Richtlinie HKCU', key: 'HKCU\\SOFTWARE\\IpaAssistantTest\\GibtEsNicht' }],
    });
    expect(read).toEqual({ documents: [], unreadable: [] });
  });
});
