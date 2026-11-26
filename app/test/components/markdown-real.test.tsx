import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarkdownView } from '../../src/renderer/markdown/MarkdownView';
import { EVIDENCE_KIND_TEXT, sectionLabel, type DocKind } from '../../src/renderer/markdown/plugins';
import { createTestEnv, type TestEnv } from '../helpers/env';
import { buildStatesWorkspace, type StatesWorkspace } from '../helpers/rich-workspace';

/** Words of a Markdown source as a reader sees them: syntax removed, hashes and kinds replaced like the view does. */
function visibleWords(source: string): string[] {
  let text = source;
  for (const [raw, plain] of Object.entries(EVIDENCE_KIND_TEXT)) text = text.replaceAll(`| ${raw} |`, `| ${plain} |`);
  text = text
    .replace(/\b[0-9a-f]{64}\b/g, ' ')
    .replace(/^\s*\|?\s*(:?-{3,}:?\s*\|?\s*)+$/gm, ' ')
    .replace(/[|#>*`\\]/g, ' ')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/(^|\s)-\s/g, ' ')
    .replace(/,/g, ' ');
  return text.split(/\s+/).filter((word) => word !== '');
}

/** True if all words appear in the rendered text in the same order (the view may add labels in between). */
function containsInOrder(rendered: string, words: string[]): { ok: true } | { ok: false; at: number; word: string } {
  const flat = rendered.replace(/[,|]/g, ' ');
  let from = 0;
  for (const [index, word] of words.entries()) {
    const found = flat.indexOf(word, from);
    if (found === -1) return { ok: false, at: index, word };
    from = found + word.length;
  }
  return { ok: true };
}

describe('echte Dateien des CLI (AK-10-29, AK-10-30)', () => {
  let env: TestEnv;
  let states: StatesWorkspace;
  const read = (relative: string) => readFile(path.join(states.project.workspacePath, relative), 'utf8');

  beforeAll(async () => {
    env = await createTestEnv();
    states = await buildStatesWorkspace(env);
  }, 420_000);
  afterAll(async () => env.cleanup());

  // S000001 is the deterministic log of the baseline, S000002 the AI log. Later snapshots have no log yet
  // (the exhausted S000003 stops the queue), which the app shows as "Nicht erstellt".
  const workLogCases: [string, DocKind][] = [
    ['S000001', 'workLogNoAi'],
    ['S000002', 'workLogAi'],
  ];

  it.each(workLogCases)('stellt den Work-Log %s ohne Verlust von Text dar', async (id, kind) => {
    const markdown = await read(`logs/${id}.md`);
    const { container, unmount } = render(<MarkdownView markdown={markdown} docKind={kind} snapshotId={id} />);
    const result = containsInOrder(container.textContent ?? '', visibleWords(markdown));
    expect(result, result.ok ? '' : `fehlt: ${result.word}`).toEqual({ ok: true });
    unmount();
  });

  it.each(workLogCases)('etikettiert die Abschnitte des Work-Logs %s nach Wortlaut und Art', async (id, kind) => {
    const markdown = await read(`logs/${id}.md`);
    const { container } = render(<MarkdownView markdown={markdown} docKind={kind} snapshotId={id} />);
    const headings = [...container.querySelectorAll('h2')];
    expect(headings.length).toBeGreaterThanOrEqual(10);
    for (const heading of headings) {
      const title = heading.firstChild?.textContent?.trim() ?? '';
      const label = heading.querySelector('.label');
      const expected = sectionLabel(kind, title);
      if (expected === null) expect(label, title).toBeNull();
      else expect(label?.textContent, title).toBe({ ai: 'KI-Entwurf', noAi: 'ohne KI', tool: 'vom Tool', note: 'Notiz', aiWorkLog: 'KI-Entwurf (Work-Log)', baseline: 'Ausgangslage' }[expected]);
    }
    const byTitle = Object.fromEntries(headings.map((heading) => [heading.firstChild?.textContent?.trim() ?? '', heading.querySelector('.label')?.textContent ?? null]));
    expect(byTitle['Belege']).toBe('vom Tool');
    expect(byTitle['Statusänderungen']).toBe('vom Tool');
    expect(byTitle['Erfassungshinweise']).toBe('vom Tool');
    expect(byTitle['Zusammenfassung']).toBe(kind === 'workLogAi' ? 'KI-Entwurf' : 'ohne KI');
  });

  it('macht Belegreferenzen im KI-Work-Log zu Chips des eigenen Snapshots', async () => {
    const markdown = await read('logs/S000002.md');
    const { container } = render(<MarkdownView markdown={markdown} docKind="workLogAi" snapshotId="S000002" onReference={() => undefined} />);
    const chips = [...container.querySelectorAll('.chip--ref')].map((chip) => chip.textContent);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((chip) => /^S000002:E\d{3,}$/.test(chip ?? ''))).toBe(true);
    // No reference survives as bracketed text.
    expect(container.textContent).not.toMatch(/\[S\d{6}:E\d{3,}\]|\[E\d{3,}\]/);
  });

  it('zeigt "Art" der Belegtabelle in Klartext', async () => {
    const markdown = await read('logs/S000002.md');
    const { container } = render(<MarkdownView markdown={markdown} docKind="workLogAi" snapshotId="S000002" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\b(state_delta|commit_message|commit_diff|staged_diff|unstaged_diff|test_report)\b/);
    expect(text).toMatch(/Datei-Zustand|Commit|Notiz/);
  });

  describe('Journale', () => {
    const drafts = async (): Promise<{ file: string; mode: 'ai' | 'no_ai' }[]> => {
      const { readdir } = await import('node:fs/promises');
      const names = (await readdir(path.join(states.project.workspacePath, 'journal', 'drafts'))).filter((name) => name.endsWith('.json'));
      return Promise.all(
        names.map(async (name) => ({ file: name.slice(0, -5), mode: (JSON.parse(await read(`journal/drafts/${name}`)) as { mode: 'ai' | 'no_ai' }).mode })),
      );
    };

    it.each(['ai', 'no_ai'] as const)('stellt den Entwurf (%s) ohne Verlust dar und etikettiert die 13 Abschnitte', async (mode) => {
      const draft = (await drafts()).find((candidate) => candidate.mode === mode);
      expect(draft, `Fixture ohne Journal-Entwurf ${mode}`).toBeDefined();
      const markdown = await read(`journal/drafts/${draft?.file}.md`);
      const kind: DocKind = mode === 'ai' ? 'journalAi' : 'journalNoAi';
      const { container } = render(<MarkdownView markdown={markdown} docKind={kind} />);
      const words = containsInOrder(container.textContent ?? '', visibleWords(markdown));
      expect(words, words.ok ? '' : `fehlt: ${words.word}`).toEqual({ ok: true });
      const headings = [...container.querySelectorAll('h2')];
      expect(headings.map((heading) => heading.firstChild?.textContent?.trim())).toEqual([
        'Geplante Arbeiten',
        'Ausgeführte Arbeiten',
        'Probleme und Lösungen',
        'Entscheidungen',
        'Tests',
        'Abweichungen von der Planung',
        'Erkenntnisse',
        'Nächste Schritte',
        'Zeitaufwand',
        'Unklare Tageszuordnung',
        'Offene Analysen und Erfassungslücken',
        'Unbekannt/offen',
        'Quellen',
      ]);
      const label = (title: string) => headings.find((heading) => heading.firstChild?.textContent?.trim() === title)?.querySelector('.label')?.textContent;
      expect(label('Ausgeführte Arbeiten')).toBe(mode === 'ai' ? 'KI-Entwurf' : 'ohne KI');
      expect(label('Zeitaufwand')).toBe('vom Tool');
      expect(label('Quellen')).toBe('vom Tool');
      expect(label('Unklare Tageszuordnung')).toBe('vom Tool');
      // The notice box is the first block quote of the draft.
      expect(container.querySelector('blockquote')?.textContent).toMatch(/persönlich prüfen/);
    });

    it('etikettiert Zeilen aus Work-Logs und Notizen und macht Notiz-IDs zu Chips', async () => {
      const draft = (await drafts()).find((candidate) => candidate.mode === 'no_ai');
      const markdown = await read(`journal/drafts/${draft?.file}.md`);
      const { container } = render(<MarkdownView markdown={markdown} docKind="journalNoAi" onReference={() => undefined} />);
      const items = [...container.querySelectorAll('li')];
      const fromWorkLog = items.filter((item) => item.textContent?.includes('aus Work-Log übernommen'));
      const fromNote = items.filter((item) => /– Notiz \(/.test(item.textContent ?? ''));
      expect(fromWorkLog.length + fromNote.length).toBeGreaterThan(0);
      for (const item of fromWorkLog) expect(within(item).getAllByText('KI-Entwurf (Work-Log)').length).toBeGreaterThan(0);
      for (const item of fromNote) expect(within(item).getAllByText('Notiz').length).toBeGreaterThan(0);
      const chips = [...container.querySelectorAll('.chip--ref')].map((chip) => chip.textContent ?? '');
      expect(chips.some((chip) => /^N\d{8}T\d{6}Z-[0-9a-f]{4}$/.test(chip))).toBe(true);
      expect(container.querySelectorAll('pre .chip--ref, code .chip--ref')).toHaveLength(0);
    });
  });
});
