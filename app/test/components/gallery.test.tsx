import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import Gallery, { GALLERY_THEMES } from '../../src/renderer/gallery/Gallery';
import { createFakeApi } from './fakeApi';

/** AK-10-12: every component in every state, in both themes, renders without errors with roles and names. */
describe('Zustandsgalerie (AD-15)', () => {
  it('rendert alle Komponenten in Hell und Dunkel ohne Fehler', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Gallery />);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    for (const theme of GALLERY_THEMES) {
      const panel = screen.getByTestId(`gallery-${theme}`);
      expect(panel).toHaveAttribute('data-theme', theme);
      for (const section of ['Buttons', 'Split-Button', 'Chips', 'Status-Chips (Analyse)', 'Status-Chips (Lauf)', 'Referenz-Chips', 'Etiketten', 'Chip-Liste', 'Statuspunkte', 'Banner', 'Dialog und Bestätigung', 'Tooltip', 'Tabs', 'Tabelle', 'Felder', 'Laden und leer', 'Icons', 'Darstellung', 'Halt-Banner', 'Claude-Warnung', 'Tageszusammenfassung', 'Hinweise und Lücken', 'Zeitstrahl', 'Kalender', 'Markdown: Work-Log mit KI', 'Markdown: Journal ohne KI', 'Laufanzeige: läuft', 'Laufanzeige: Ergebnis', 'Dialoge: Ausgangspunkt, Überspringen, Erneut versuchen', 'Notiz-Dialog', 'Prüfen', 'Journal: Fehler', 'Zeitplan: Zustände', 'Zeitplan: Formular und Vorschau', 'Zeitplan: Dialoge und Verlauf', 'Konfiguration: Gruppen', 'Konfiguration: Speichern-Leiste und Dialoge', 'Projekt hinzufügen: Schritt 1', 'System: Verbrauch und Live-Test']) {
        expect(within(panel).getByRole('region', { name: section }), `${theme}: ${section}`).toBeInTheDocument();
      }
    }
  });

  it('zeigt alle acht Analyse-Status, alle neun Lauf-Ergebnisse und die drei Bannerstufen je Theme', () => {
    render(<Gallery />);
    for (const theme of GALLERY_THEMES) {
      const panel = screen.getByTestId(`gallery-${theme}`);
      expect(within(panel).getByRole('region', { name: 'Status-Chips (Analyse)' }).querySelectorAll('.chip')).toHaveLength(8);
      expect(within(panel).getByRole('region', { name: 'Status-Chips (Lauf)' }).querySelectorAll('.chip')).toHaveLength(9);
      const banners = within(within(panel).getByRole('region', { name: 'Banner' }));
      expect(banners.getAllByRole('status')).toHaveLength(2);
      expect(banners.getAllByRole('alert')).toHaveLength(1);
    }
  });

  it('ist in Entwicklung und Test über #/gallery erreichbar', async () => {
    window.location.hash = '#/gallery';
    try {
      render(<App api={createFakeApi().api} />);
      expect(await screen.findByTestId('gallery')).toBeInTheDocument();
    } finally {
      window.location.hash = '';
    }
  });

  it('gibt jedem Button, jedem Bild und jedem Eingabefeld einen zugänglichen Namen', () => {
    render(<Gallery />);
    for (const button of screen.getAllByRole('button')) expect(button, button.outerHTML).toHaveAccessibleName();
    for (const image of screen.getAllByRole('img')) expect(image, image.outerHTML).toHaveAccessibleName();
    for (const box of screen.getAllByRole('textbox')) expect(box, box.outerHTML).toHaveAccessibleName();
  });

  it('zeigt jeden Button mit KI-Markierung mit "Claude" im Namen', () => {
    render(<Gallery />);
    const marked = screen.getAllByRole('button').filter((button) => button.querySelector('[data-icon="spark"]') !== null);
    expect(marked.length).toBeGreaterThan(0);
    for (const button of marked) expect(button).toHaveAccessibleName(/Claude/);
    // Only the actions of spec §12.2 carry the mark; the variant without AI stands next to it, equal and unmarked (AK-10-50).
    for (const name of ['Laufanzeige: läuft', 'Laufanzeige: Ergebnis', 'Dialoge: Ausgangspunkt, Überspringen, Erneut versuchen', 'Notiz-Dialog', 'Prüfen', 'Journal: Fehler', 'Zeitplan: Zustände', 'Zeitplan: Formular und Vorschau', 'Zeitplan: Dialoge und Verlauf', 'Konfiguration: Gruppen', 'Konfiguration: Speichern-Leiste und Dialoge', 'Projekt hinzufügen: Schritt 1', 'System: Verbrauch und Live-Test']) {
      for (const region of screen.getAllByRole('region', { name })) {
        for (const button of within(region).queryAllByRole('button').filter((entry) => entry.querySelector('[data-icon="spark"]') !== null)) {
          expect(button.textContent?.trim(), name).toMatch(/^(Jetzt erfassen|Erneut versuchen|Journal erzeugen|Live-Test|Jetzt auslösen)/);
        }
      }
    }
  });
});
