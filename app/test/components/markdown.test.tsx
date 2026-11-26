import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownView } from '../../src/renderer/markdown/MarkdownView';
import { parseRef, rowLabel, sectionLabel, shortHash, splitReferences } from '../../src/renderer/markdown/plugins';

const HOSTILE = `# Titel

<script>window.__pwned = 1</script>

<img src=x onerror="window.__pwned = 2">

<iframe src="https://evil.example/"></iframe>

<!-- versteckter Kommentar -->

[Klick mich](javascript:window.__pwned=3)

[Datei](file:///C:/Windows/win.ini)

[Daten](data:text/html,<script>window.__pwned=4</script>)

![Eingebettet](data:image/png;base64,AAAA)

![Extern](https://example.com/bild.png)

[Sicher](https://example.com/seite)

<a href="javascript:window.__pwned=5">roh</a>

Text nach dem Angriff.
`;

describe('Markdown ist sicher (AK-10-28)', () => {
  it('führt nichts aus und zeigt kein rohes HTML', () => {
    const { container } = render(<MarkdownView markdown={HOSTILE} docKind="plain" />);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    for (const tag of ['script', 'iframe', 'img', 'object', 'embed', 'style']) expect(container.querySelector(tag), tag).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|javascript:|data:text|file:\/\//i);
    expect(container.textContent).not.toContain('__pwned');
    expect(container.textContent).not.toContain('<script>');
    expect(container.textContent).not.toContain('versteckter Kommentar');
    expect(container.textContent).toContain('Text nach dem Angriff.');
  });

  it('stellt gefährliche Links als Text und Bilder als Alternativtext dar, ohne etwas zu laden', () => {
    const { container } = render(<MarkdownView markdown={HOSTILE} docKind="plain" />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://example.com/seite']);
    expect(container.textContent).toContain('Klick mich');
    expect(container.textContent).toContain('Eingebettet');
    expect(container.textContent).toContain('Extern');
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
  });

  it('öffnet einen Link nie von selbst, fragt erst und öffnet nur nach Bestätigung', async () => {
    const user = userEvent.setup();
    const onOpenExternal = vi.fn();
    render(<MarkdownView markdown="[Sicher](https://example.com/seite)" docKind="plain" onOpenExternal={onOpenExternal} />);
    await user.click(screen.getByRole('link', { name: 'Sicher' }));
    expect(onOpenExternal).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Link im Browser öffnen?' });
    expect(dialog).toHaveTextContent('https://example.com/seite');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onOpenExternal).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Sicher' }));
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(onOpenExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/seite');
  });

  it('lässt auch http-Links nur nach Bestätigung öffnen und navigiert nie selbst', async () => {
    const user = userEvent.setup();
    render(<MarkdownView markdown="[Alt](http://example.com/)" docKind="plain" />);
    const link = screen.getByRole('link', { name: 'Alt' });
    const prevented = !link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(prevented).toBe(true);
    await user.keyboard('{Escape}');
  });
});

describe('Markdown-Darstellung (AK-10-29)', () => {
  const doc = `# Titel

Fliesstext mit **Fett** und \`Code\`.

> Hinweis im Zitat

- Punkt
  - Unterpunkt

---

\`\`\`
Codeblock
\`\`\`

| Art | Pfad | Hash |
| --- | --- | --- |
| commit_message | src/a.ts | ${'9e859f'}${'0'.repeat(54)}b561 |
| unbekannt | src/b.ts | kurz |
`;

  it('rendert Überschriften, Listen, Zitat, Code, Linie und Tabellen', () => {
    const { container } = render(<MarkdownView markdown={doc} docKind="plain" />);
    expect(container.querySelector('h1')).toHaveTextContent('Titel');
    expect(container.querySelector('strong')).toHaveTextContent('Fett');
    expect(container.querySelector('p code')).toHaveTextContent('Code');
    expect(container.querySelector('blockquote')).toHaveTextContent('Hinweis im Zitat');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('ul ul')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelector('pre code')).toHaveTextContent('Codeblock');
    expect(container.querySelector('.md-table')).not.toBeNull();
    expect(container.querySelector('.md-table table')).not.toBeNull();
  });

  it('zeigt "Art" in Klartext mit Rohwert im Tooltip, unbekannte Werte unverändert', () => {
    render(<MarkdownView markdown={doc} docKind="plain" />);
    const cell = screen.getByRole('cell', { name: 'Commit' });
    expect(cell).toHaveAttribute('title', 'commit_message');
    expect(screen.getByRole('cell', { name: 'unbekannt' })).not.toHaveAttribute('title');
  });

  it('kürzt lange Hashes und kopiert den vollständigen Wert beim Klick', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<MarkdownView markdown={doc} docKind="plain" onCopy={onCopy} />);
    const full = `9e859f${'0'.repeat(54)}b561`;
    const button = screen.getByRole('button', { name: '9e859f…b561' });
    expect(button).toHaveAttribute('title', `Klicken, um den vollständigen Hash zu kopieren: ${full}`);
    await user.click(button);
    expect(onCopy).toHaveBeenCalledWith(full);
    expect(shortHash(full)).toBe('9e859f…b561');
  });
});

describe('KI-Etiketten per Abschnittsname (AK-10-30, §11.3)', () => {
  it('richtet das Etikett nach Wortlaut und Art, ohne zu raten', () => {
    expect(sectionLabel('workLogAi', 'Zusammenfassung')).toBe('ai');
    expect(sectionLabel('workLogNoAi', 'Umgesetzt')).toBe('noAi');
    expect(sectionLabel('workLogAi', 'Belege')).toBe('tool');
    expect(sectionLabel('workLogNoAi', 'Statusänderungen')).toBe('tool');
    expect(sectionLabel('workLogAi', 'Erfassungshinweise')).toBe('tool');
    expect(sectionLabel('journalAi', 'Ausgeführte Arbeiten')).toBe('ai');
    expect(sectionLabel('journalNoAi', 'Erkenntnisse')).toBe('noAi');
    expect(sectionLabel('journalAi', 'Zeitaufwand')).toBe('tool');
    expect(sectionLabel('journalNoAi', 'Quellen')).toBe('tool');
    expect(sectionLabel('journalAi', 'Eine ganz andere Überschrift')).toBeNull();
    expect(sectionLabel('workLogAi', 'Ausgeführte Arbeiten')).toBeNull();
    expect(sectionLabel('workLogNone', 'Zusammenfassung')).toBeNull();
    expect(sectionLabel('plain', 'Zusammenfassung')).toBeNull();
  });

  it('trägt das Etikett hinter der Überschrift der Ebene 2', () => {
    render(<MarkdownView markdown={'# Work-Log\n\n## Zusammenfassung\n\ntext\n\n## Belege\n\ntext\n\n## Fremd\n\ntext'} docKind="workLogAi" />);
    expect(screen.getByRole('heading', { level: 2, name: /Zusammenfassung/ })).toHaveTextContent('KI-Entwurf');
    expect(screen.getByRole('heading', { level: 2, name: /Belege/ })).toHaveTextContent('vom Tool');
    expect(screen.getByRole('heading', { level: 2, name: 'Fremd' })).not.toHaveTextContent(/KI|Tool|ohne/);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(/KI-Entwurf/);
  });

  it('etikettiert einzelne Zeilen: aus Work-Log übernommen und Notizen', () => {
    expect(rowLabel('Etwas getan – aus Work-Log übernommen (S000002) [S000002:E001]')).toBe('aiWorkLog');
    expect(rowLabel('Etwas getan – Notiz (Tätigkeit) [N20261014T081500Z-0c1d]')).toBe('note');
    expect(rowLabel('Etwas ohne Hinweis')).toBeNull();
    render(
      <MarkdownView
        markdown={'## Ausgeführte Arbeiten\n\n- A – aus Work-Log übernommen (S000002) [S000002:E001]\n- B – Notiz (Problem) [N20261014T081500Z-0c1d]\n- C ohne Etikett'}
        docKind="journalNoAi"
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('KI-Entwurf (Work-Log)');
    expect(items[1]).toHaveTextContent('Notiz');
    expect(items[2]).not.toHaveTextContent(/KI|Notiz|Tool/);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ohne KI');
  });
});

describe('Referenz-Chips (AK-10-30, §11.4)', () => {
  const noContext = { snapshotId: null };

  it('erkennt Referenzen nach den Mustern der Spezifikation', () => {
    expect(parseRef('N20261014T081500Z-0c1d', noContext)).toEqual({ kind: 'note', id: 'N20261014T081500Z-0c1d', snapshotId: null });
    expect(parseRef('S000002:E003', noContext)).toEqual({ kind: 'evidence', id: 'S000002:E003', snapshotId: 'S000002' });
    expect(parseRef('C01', noContext)).toEqual({ kind: 'context', id: 'C01', snapshotId: null });
    expect(parseRef('E001', noContext)).toBeNull();
    expect(parseRef('E001', { snapshotId: 'S000002' })).toEqual({ kind: 'evidence', id: 'S000002:E001', snapshotId: 'S000002' });
    expect(parseRef('R20261014T081500Z-0c1d', noContext)).toBeNull();
    expect(parseRef('S0002:E001', noContext)).toBeNull();
  });

  it('teilt Klammerlisten in Chips mit Kommas und lässt Fremdes Text', () => {
    const parts = splitReferences('Siehe [S000002:E001, S000002:E002] und [kein Verweis] oder [E005].', noContext);
    expect(parts.filter((part) => typeof part !== 'string')).toHaveLength(2);
    expect(parts.join('')).toContain('[kein Verweis]');
    expect(splitReferences('[E005]', { snapshotId: 'S000003' })).toEqual([{ kind: 'evidence', id: 'S000003:E005', snapshotId: 'S000003' }]);
    // A bracket that mixes references and other text stays text.
    expect(splitReferences('[S000002:E001, Quatsch]', noContext)).toEqual(['[S000002:E001, Quatsch]']);
  });

  it('macht Chips klickbar und gibt die Referenz an die Seite', async () => {
    const user = userEvent.setup();
    const onReference = vi.fn();
    render(
      <MarkdownView
        markdown="Aus [N20261014T081500Z-0c1d] und [S000002:E003]."
        docKind="journalAi"
        references={{ notes: { 'N20261014T081500Z-0c1d': '2026-10-14' }, snapshots: {} }}
        onReference={onReference}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'N20261014T081500Z-0c1d' }));
    expect(onReference).toHaveBeenLastCalledWith({ kind: 'note', id: 'N20261014T081500Z-0c1d', snapshotId: null });
    await user.click(screen.getByRole('button', { name: 'S000002:E003' }));
    expect(onReference).toHaveBeenLastCalledWith({ kind: 'evidence', id: 'S000002:E003', snapshotId: 'S000002' });
  });

  it('dämpft Chips unbekannter Notizen mit Hinweis und macht Kontext-Chips ohne Sprung', () => {
    render(
      <MarkdownView
        markdown="Notiz [N20261014T081500Z-9999], Kontext [C01]."
        docKind="journalAi"
        references={{ notes: {}, snapshots: {} }}
        contexts={{ C01: 'docs/anforderungen.md' }}
        onReference={() => undefined}
      />,
    );
    expect(screen.getByTitle('Notiz nicht gefunden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'N20261014T081500Z-9999' })).toBeNull();
    expect(screen.getByTitle('docs/anforderungen.md')).toHaveTextContent('C01');
    expect(screen.queryByRole('button', { name: 'C01' })).toBeNull();
  });

  it('macht in Tabellenzellen genau eine Referenz zum Chip, in Code nie', () => {
    const { container } = render(
      <MarkdownView
        markdown={'| Notiz | Text |\n| --- | --- |\n| N20261014T081500Z-0c1d | `[S000002:E001]` und [S000002:E002] |\n\n```\n[S000002:E003]\n```'}
        docKind="journalAi"
        onReference={() => undefined}
      />,
    );
    expect(within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual(['N20261014T081500Z-0c1d', 'S000002:E002']);
    expect(container.querySelector('code')).toHaveTextContent('[S000002:E001]');
    expect(container.querySelector('pre')).toHaveTextContent('[S000002:E003]');
    expect(container.querySelectorAll('pre button, p code button')).toHaveLength(0);
  });

  it('wandelt in einem Work-Log ein nacktes E001 in die Referenz des Snapshots um und hebt die Zeile hervor', () => {
    const { container } = render(
      <MarkdownView markdown={'| ID | Pfad |\n| --- | --- |\n| E001 | src/a.ts |\n| E002 | src/b.ts |'} docKind="workLogAi" snapshotId="S000002" highlight="S000002:E002" onReference={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'S000002:E001' })).toBeInTheDocument();
    expect(container.querySelectorAll('.md-row--hit')).toHaveLength(1);
  });
});
