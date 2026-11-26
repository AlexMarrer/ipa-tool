import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Banner,
  Button,
  ChipList,
  ConfirmDialog,
  ContentLabel,
  Dialog,
  EmptyState,
  ErrorBoundary,
  Field,
  LoadingSkeleton,
  OutcomeChip,
  RefChip,
  SplitButton,
  StatusChip,
  Table,
  Tabs,
  Tooltip,
} from '../../src/renderer/components';

afterEach(() => vi.useRealTimers());

describe('Button und KI-Markierung (AK-10-12, spec §12.2)', () => {
  it('trägt bei KI-Buttons das Funkensymbol und "Claude" im zugänglichen Namen', () => {
    render(<Button ai>Jetzt erfassen</Button>);
    const button = screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ });
    expect(button.querySelector('[data-icon="spark"]')).not.toBeNull();
    expect(screen.getByRole('tooltip')).toHaveTextContent('ruft Claude auf');
  });

  it('trägt Buttons ohne Claude keine Markierung', () => {
    render(<Button>Nur aufnehmen</Button>);
    expect(screen.getByRole('button', { name: 'Nur aufnehmen' }).querySelector('[data-icon="spark"]')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('zeigt den Grund der Sperre als Beschreibung', () => {
    render(
      <Button ai disabled disabledReason="Ein Lauf ist aktiv.">
        Jetzt erfassen
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Jetzt erfassen/ });
    expect(button).toBeDisabled();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ein Lauf ist aktiv.');
    expect(button).toHaveAccessibleDescription('Ein Lauf ist aktiv.');
  });
});

describe('SplitButton', () => {
  it('öffnet das Menü mit Pfeil nach unten, wählt mit Enter und schliesst mit Esc', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SplitButton ai label="Jetzt erfassen" onClick={() => undefined} items={[{ id: 'a', label: 'Nur aufnehmen', onSelect }]} />);
    const toggle = screen.getByRole('button', { name: 'Weitere Optionen' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await user.keyboard('{ArrowDown}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Nur aufnehmen' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(toggle);
    await user.click(screen.getByRole('menuitem', { name: 'Nur aufnehmen' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ruft die Hauptaktion auf und sperrt beide Teile', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<SplitButton label="Aktion" onClick={onClick} items={[]} />);
    await user.click(screen.getByRole('button', { name: 'Aktion' }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<SplitButton label="Aktion" disabled onClick={onClick} items={[]} />);
    expect(screen.getByRole('button', { name: 'Aktion' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Weitere Optionen' })).toBeDisabled();
  });
});

describe('Chips und Etiketten', () => {
  it('zeigt Status nie nur als Farbe: Icon und Text', () => {
    render(
      <>
        <StatusChip status="exhausted" />
        <StatusChip status="complete" />
        <OutcomeChip outcome="analysis_failed" />
      </>,
    );
    const exhausted = screen.getByText('Versuche erschöpft');
    expect(exhausted.closest('.chip')).toHaveClass('chip--err');
    expect(exhausted.closest('.chip')?.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Analyse abgeschlossen').closest('.chip')).not.toHaveClass('chip--warn', 'chip--err');
    expect(screen.getByText('Analyse gescheitert')).toBeInTheDocument();
  });

  it('zeigt die Etiketten aus §1.2', () => {
    render(
      <>
        <ContentLabel kind="ai" />
        <ContentLabel kind="noAi" />
        <ContentLabel kind="tool" />
        <ContentLabel kind="note" />
      </>,
    );
    for (const text of ['KI-Entwurf', 'ohne KI', 'vom Tool', 'Notiz']) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('macht Referenz-Chips klickbar und zeigt IDs in Monospace', async () => {
    const onOpen = vi.fn();
    render(<RefChip id="S000002" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: 'S000002' }));
    expect(onOpen).toHaveBeenCalledWith('S000002');
    expect(screen.getByRole('button', { name: 'S000002' })).toHaveClass('chip--ref');
  });

  it('kürzt Chip-Listen mit Rest', () => {
    render(<ChipList label="Dateien" items={['a', 'b', 'c', 'd']} max={2} />);
    const list = screen.getByRole('list', { name: 'Dateien' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('+2')).toBeInTheDocument();
  });
});

describe('Banner', () => {
  it('meldet Fehler sofort und Hinweise höflich, Details eingeklappt', () => {
    render(
      <>
        <Banner level="err" title="Fehler" details="Code: x">
          Text
        </Banner>
        <Banner level="warn" title="Warnung" />
        <Banner title="Info" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Fehler');
    expect(screen.getAllByRole('status')).toHaveLength(2);
    const details = screen.getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
  });
});

describe('Dialog (Fokusfalle, Esc, Strg+Enter)', () => {
  function Host({ onConfirm = () => undefined }: { onConfirm?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Öffnen</button>
        {open ? (
          <Dialog title="Titel" onClose={() => setOpen(false)} onConfirm={onConfirm} footer={<Button>Speichern</Button>}>
            <input aria-label="Feld" />
          </Dialog>
        ) : null}
      </>
    );
  }

  it('hat Rolle, Namen, setzt den Fokus hinein und gibt ihn bei Esc zurück', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Öffnen' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Titel' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('hält den Fokus mit Tab und Umschalt+Tab im Dialog', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    const dialog = screen.getByRole('dialog');
    const field = screen.getByLabelText('Feld');
    const save = screen.getByRole('button', { name: 'Speichern' });
    expect(field).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(field).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('bestätigt mit Strg+Enter', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Host onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('ConfirmDialog', () => {
  it('bestätigt in einem Schritt', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="Lauf wirklich abbrechen?" confirmLabel="Lauf abbrechen" danger onClose={() => undefined} onConfirm={onConfirm}>
        Text
      </ConfirmDialog>,
    );
    expect(screen.getByText('Strg+Enter bestätigt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lauf abbrechen' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('verlangt im zweiten Schritt eine ausdrückliche Bestätigung', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Zulassen?"
        confirmLabel="x"
        onClose={() => undefined}
        onConfirm={onConfirm}
        secondStep={{ title: 'Bitte bestätigen', children: <p>Wirklich?</p>, acknowledgeLabel: 'Ich habe verstanden', confirmLabel: 'Zulassen' }}
      >
        Erster Schritt
      </ConfirmDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Zulassen?' })).toBeInTheDocument();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Bitte bestätigen' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Zulassen' });
    expect(confirm).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Ich habe verstanden' }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('Tooltip', () => {
  it('erscheint bei Fokus und verschwindet mit Esc', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip text="Hilfe">
        <button>Knopf</button>
      </Tooltip>,
    );
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveClass('sr-only');
    await user.tab();
    expect(tip).toHaveClass('tip');
    expect(screen.getByRole('button', { name: 'Knopf' })).toHaveAccessibleDescription('Hilfe');
    await user.keyboard('{Escape}');
    expect(tip).toHaveClass('sr-only');
  });
});

describe('Tabs', () => {
  function Host() {
    const [selected, setSelected] = useState('a');
    return (
      <Tabs
        label="Tage"
        tabs={[
          { id: 'a', label: 'Work-Logs', count: 5 },
          { id: 'b', label: 'Notizen', count: 6 },
          { id: 'c', label: 'Journal', count: 2 },
        ]}
        selected={selected}
        onSelect={setSelected}
      >
        Inhalt {selected}
      </Tabs>
    );
  }

  it('folgt dem ARIA-Muster und bedient sich mit Pfeiltasten, Pos1 und Ende', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByRole('tablist', { name: 'Tage' })).toBeInTheDocument();
    const [first, second, third] = screen.getAllByRole('tab');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAccessibleName('Work-Logs 5');
    expect(second).toHaveAttribute('tabindex', '-1');
    first?.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Inhalt b');
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(third).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Journal 2');
  });
});

describe('Table und Field', () => {
  it('benennt die Tabelle, hat Spaltenköpfe und eine Leerzeile', () => {
    const { rerender } = render(
      <Table caption="Läufe" columns={[{ key: 'id', header: 'ID', render: (row: { id: string }) => row.id }]} rows={[{ id: 'R1' }]} rowKey={(row) => row.id} selectedKey="R1" />,
    );
    expect(screen.getByRole('table', { name: 'Läufe' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument();
    expect(screen.getByRole('row', { selected: true })).toHaveTextContent('R1');
    expect(screen.getByRole('region', { name: 'Läufe' })).toHaveAttribute('tabindex', '0');
    rerender(<Table caption="Läufe" columns={[{ key: 'id', header: 'ID', render: () => null }]} rows={[]} rowKey={() => ''} empty="Keine Läufe." />);
    expect(screen.getByText('Keine Läufe.')).toBeInTheDocument();
  });

  it('verknüpft Label, Hinweis und Fehler mit dem Feld', () => {
    render(
      <Field label="Minuten" hint="Ganze Zahl" error="Pflichtfeld">
        {(props) => <input {...props} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Minuten' });
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('Ganze Zahl Pflichtfeld');
    expect(screen.getByRole('alert')).toHaveTextContent('Pflichtfeld');
  });
});

describe('Lade-, Leer- und Fehlerzustände (AK-10-13)', () => {
  it('zeigt das Skelett erst nach 150 ms', () => {
    vi.useFakeTimers();
    render(<LoadingSkeleton loading />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => void vi.advanceTimersByTime(149));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(screen.getByRole('status', { name: 'Wird geladen' })).toBeInTheDocument();
  });

  it('zeigt bei kurzem Laden nie ein Skelett', () => {
    vi.useFakeTimers();
    const { rerender } = render(<LoadingSkeleton loading />);
    act(() => void vi.advanceTimersByTime(100));
    rerender(<LoadingSkeleton loading={false} />);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('zeigt leere Zustände mit einem Satz und einer Hauptaktion', () => {
    render(<EmptyState title="Noch kein Projekt" text="Richte ein Projekt ein." action={<Button variant="primary">Projekt hinzufügen</Button>} />);
    expect(screen.getByText('Noch kein Projekt')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('fängt einen Renderfehler ab, zeigt ein Fehlerbanner mit Details und lässt die App weiterlaufen', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('kaputte Komponente');
    }
    render(
      <>
        <p>Rest der App</p>
        <ErrorBoundary area="Die Tagesansicht">
          <Broken />
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByText('Rest der App')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Die Tagesansicht konnte nicht angezeigt werden');
    expect(screen.getByText('kaputte Komponente')).toBeInTheDocument();
    errorLog.mockRestore();
  });
});
