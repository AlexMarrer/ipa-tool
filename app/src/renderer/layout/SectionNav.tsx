import { SECTION_LABEL } from '../../shared/messages';
import type { Page, Section } from '../../shared/types';

const SECTIONS = Object.keys(SECTION_LABEL) as Section[];

export interface SectionNavProps {
  page: Page;
  onSelect: (section: Section) => void;
}

/** Übersicht · Tag · Zeitplan · Konfiguration (spec §8.1). The selected one carries `aria-current`. */
export function SectionNav({ page, onSelect }: SectionNavProps) {
  return (
    <nav className="sectionbar" aria-label="Bereiche">
      {SECTIONS.map((section) => (
        <button key={section} type="button" className="tab" aria-current={page === section ? 'page' : undefined} onClick={() => onSelect(section)}>
          {SECTION_LABEL[section]}
        </button>
      ))}
    </nav>
  );
}
