import type { ReactNode } from 'react';
import { ANALYSIS_STATUS, CONTENT_LABELS, RUN_OUTCOME, type AnalysisStatus, type ContentLabelKind, type RunOutcome, type Tone } from '../../shared/messages';
import { Icon, type IconName } from '../theme/icons/Icon';

export type ChipTone = 'neutral' | 'accent' | Tone;

export interface ChipProps {
  tone?: ChipTone;
  icon?: IconName;
  children: ReactNode;
}

const TONE_CLASS: Record<ChipTone, string> = { neutral: '', accent: 'chip--accent', warn: 'chip--warn', err: 'chip--err' };

export function Chip({ tone = 'neutral', icon, children }: ChipProps) {
  return (
    <span className={['chip', TONE_CLASS[tone]].filter(Boolean).join(' ')}>
      {icon !== undefined ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

const TONE_ICON: Record<Tone, IconName> = { neutral: 'check', warn: 'warning', err: 'warning' };

/** Colour + icon + short text, never colour alone (spec §9.2). */
export function StatusChip({ status }: { status: AnalysisStatus }) {
  const entry = ANALYSIS_STATUS[status];
  return (
    <Chip tone={entry.tone} icon={status === 'baseline' ? 'bookmark' : TONE_ICON[entry.tone]}>
      {entry.label}
    </Chip>
  );
}

export function OutcomeChip({ outcome }: { outcome: RunOutcome }) {
  const entry = RUN_OUTCOME[outcome];
  return (
    <Chip tone={entry.tone} icon={TONE_ICON[entry.tone]}>
      {entry.label}
    </Chip>
  );
}

export interface RefChipProps {
  /** Monospace ID such as `S000002` or a note ID. */
  id: string;
  kind?: 'snapshot' | 'note' | 'commit' | 'run';
  onOpen?: (id: string) => void;
}

const REF_ICON: Record<NonNullable<RefChipProps['kind']>, IconName> = { snapshot: 'bookmark', note: 'info', commit: 'branch', run: 'refresh' };

export function RefChip({ id, kind = 'snapshot', onOpen }: RefChipProps) {
  const content = (
    <>
      <Icon name={REF_ICON[kind]} />
      {id}
    </>
  );
  return onOpen === undefined ? (
    <span className="chip chip--ref" style={{ cursor: 'default' }}>
      {content}
    </span>
  ) : (
    <button type="button" className="chip chip--ref" onClick={() => onOpen(id)}>
      {content}
    </button>
  );
}

/** "KI-Entwurf", "ohne KI", "vom Tool", "Notiz" (spec §1.2). */
export function ContentLabel({ kind }: { kind: ContentLabelKind }) {
  return <span className={kind === 'ai' || kind === 'aiWorkLog' ? 'label label--ai' : 'label'}>{CONTENT_LABELS[kind]}</span>;
}

export function ChipList({ label, items, max = 6 }: { label: string; items: string[]; max?: number }) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <ul className="chip-list" aria-label={label}>
      {shown.map((item) => (
        <li key={item}>
          <Chip>{item}</Chip>
        </li>
      ))}
      {rest > 0 ? (
        <li>
          <Chip>+{rest}</Chip>
        </li>
      ) : null}
    </ul>
  );
}
