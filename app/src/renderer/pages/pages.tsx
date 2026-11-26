import { SECTION_LABEL } from '../../shared/messages';
import type { Page } from '../../shared/types';
import { EmptyState } from '../components';

/**
 * Empty frames of the areas. Their content arrives with later packages (overview, day: package 11; schedule,
 * configuration: 13; system, add project: 14). They show no invented data (spec §8.1).
 */
const TITLES: Record<Page, string> = {
  ...SECTION_LABEL,
  system: 'System',
  'add-project': 'Projekt hinzufügen',
};

export function PlaceholderPage({ page }: { page: Page }) {
  return (
    <EmptyState
      title={TITLES[page]}
      text={page === 'add-project' ? 'Projekte richtest du vorerst in der Konsole mit "ipa init" ein, die App liest sie aus der Projektliste.' : 'Diese Ansicht ist in dieser Version noch nicht umgesetzt.'}
    />
  );
}
