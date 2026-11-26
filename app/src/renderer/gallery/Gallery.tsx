import { useState, type ReactNode } from 'react';
import { ANALYSIS_STATUS, RUN_OUTCOME, type AnalysisStatus, type RunOutcome } from '../../shared/messages';
import type { Project } from '../../shared/types';
import {
  Banner,
  Button,
  Chip,
  ChipList,
  ConfirmDialog,
  ContentLabel,
  Dialog,
  EmptyState,
  Field,
  ICON_NAMES,
  Icon,
  OutcomeChip,
  RefChip,
  Skeleton,
  SplitButton,
  StatusChip,
  Table,
  Tabs,
  Tooltip,
} from '../components';
import { StatusDot } from '../layout/Sidebar';
import { PageStates } from './PageStates';

/**
 * State gallery (spec AD-15): every base component in every state, in both themes. Only in development and
 * test builds. Reach it with `#/gallery`.
 */
export const GALLERY_THEMES = ['light', 'dark'] as const;
export type GalleryTheme = (typeof GALLERY_THEMES)[number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10, marginBottom: 28 }} aria-label={title}>
      <h3 style={{ fontSize: 14, color: 'var(--mut)' }}>{title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>{children}</div>
    </section>
  );
}

const ROWS = [
  { id: 'S000002', kind: 'work', time: '08:15' },
  { id: 'S000001', kind: 'baseline', time: '08:00' },
];

export function GalleryContent() {
  const [tab, setTab] = useState('snapshots');
  const statuses = Object.keys(ANALYSIS_STATUS) as AnalysisStatus[];
  const outcomes = Object.keys(RUN_OUTCOME) as RunOutcome[];
  const projectStatuses: Project['status'][] = ['ok', 'warning', 'error', 'halt'];

  return (
    <div>
      <Section title="Buttons">
        <Button variant="primary">Hauptaktion</Button>
        <Button>Nebenaktion</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Gefahr</Button>
        <Button ai>Jetzt erfassen</Button>
        <Button disabled>Gesperrt</Button>
        <Button ai disabled disabledReason="Ein Lauf ist aktiv. Jetzt erfassen ist gesperrt, bis er endet.">
          Jetzt erfassen
        </Button>
      </Section>
      <Section title="Split-Button">
        <SplitButton ai label="Jetzt erfassen" onClick={() => undefined} items={[{ id: 'a', label: 'Nur aufnehmen', onSelect: () => undefined }]} />
        <SplitButton label="Gesperrt" disabled onClick={() => undefined} items={[]} />
      </Section>
      <Section title="Chips">
        <Chip>Neutral</Chip>
        <Chip tone="accent">Akzent</Chip>
        <Chip tone="warn" icon="warning">
          Warnung
        </Chip>
        <Chip tone="err" icon="warning">
          Fehler
        </Chip>
      </Section>
      <Section title="Status-Chips (Analyse)">
        {statuses.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </Section>
      <Section title="Status-Chips (Lauf)">
        {outcomes.map((outcome) => (
          <OutcomeChip key={outcome} outcome={outcome} />
        ))}
      </Section>
      <Section title="Referenz-Chips">
        <RefChip id="S000002" onOpen={() => undefined} />
        <RefChip id="N20261014T081500Z-0c1d" kind="note" onOpen={() => undefined} />
        <RefChip id="a1b2c3d" kind="commit" />
      </Section>
      <Section title="Etiketten">
        <ContentLabel kind="ai" />
        <ContentLabel kind="noAi" />
        <ContentLabel kind="tool" />
        <ContentLabel kind="note" />
      </Section>
      <Section title="Chip-Liste">
        <ChipList label="Dateien" items={['src/a.ts', 'src/b.ts', 'README.md']} max={2} />
      </Section>
      <Section title="Statuspunkte">
        {projectStatuses.map((status) => (
          <span key={status} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <StatusDot status={status} /> {status}
          </span>
        ))}
      </Section>
      <Section title="Banner">
        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
          <Banner title="Information">Ein Lauf wurde beendet.</Banner>
          <Banner level="warn" title="Warnung">
            Claude ist nicht bereit.
          </Banner>
          <Banner level="err" title="Fehler" details={'Code: spawn_failed\nENOENT'}>
            Das CLI liess sich nicht starten.
          </Banner>
        </div>
      </Section>
      <Section title="Dialog und Bestätigung">
        <div style={{ display: 'grid', gap: 12, width: '100%', maxWidth: 560 }}>
          <Dialog inline title="Dialog" onClose={() => undefined} footer={<Button variant="primary">Speichern</Button>}>
            Inhalt des Dialogs.
          </Dialog>
          <ConfirmDialog inline title="Lauf wirklich abbrechen?" confirmLabel="Abbrechen" danger onClose={() => undefined} onConfirm={() => undefined}>
            Ein abgebrochener Claude-Aufruf zählt als gescheiterter Versuch.
          </ConfirmDialog>
          <ConfirmDialog
            inline
            title="Kostenpflichtige Nutzung zulassen?"
            confirmLabel="Zulassen"
            onClose={() => undefined}
            onConfirm={() => undefined}
            secondStep={{ title: 'Bitte bestätigen', children: <p>Das Tool darf dann kostenpflichtige Wege nutzen.</p>, acknowledgeLabel: 'Ich habe verstanden', confirmLabel: 'Zulassen' }}
          >
            Zweistufige Bestätigung.
          </ConfirmDialog>
        </div>
      </Section>
      <Section title="Tooltip">
        <Tooltip text="ruft Claude auf">
          <Button ai>Mit Tooltip</Button>
        </Tooltip>
      </Section>
      <Section title="Tabs">
        <div style={{ width: '100%' }}>
          <Tabs
            label="Beispiel"
            tabs={[
              { id: 'snapshots', label: 'Work-Logs', count: 5 },
              { id: 'notes', label: 'Notizen', count: 6 },
              { id: 'journal', label: 'Journal', count: 2 },
            ]}
            selected={tab}
            onSelect={setTab}
          >
            <p>Inhalt von {tab}</p>
          </Tabs>
        </div>
      </Section>
      <Section title="Tabelle">
        <div style={{ width: '100%' }}>
          <Table
            caption="Beispieltabelle"
            columns={[
              { key: 'id', header: 'ID', render: (row) => <span className="mono">{row.id}</span> },
              { key: 'kind', header: 'Art', render: (row) => row.kind },
              { key: 'time', header: 'Zeit', render: (row) => row.time },
            ]}
            rows={ROWS}
            rowKey={(row) => row.id}
            selectedKey="S000002"
          />
          <Table caption="Leere Tabelle" columns={[{ key: 'id', header: 'ID', render: () => null }]} rows={[]} rowKey={() => ''} />
        </div>
      </Section>
      <Section title="Felder">
        <Field label="Grund" hint="Wird nicht angezeigt.">
          {(props) => <input className="input" {...props} />}
        </Field>
        <Field label="Minuten" error="Bitte eine ganze Zahl angeben.">
          {(props) => <input className="input" {...props} defaultValue="abc" />}
        </Field>
      </Section>
      <Section title="Laden und leer">
        <div style={{ width: 320 }}>
          <Skeleton />
        </div>
        <EmptyState title="Noch kein Projekt" text="Richte ein Projekt ein." action={<Button variant="primary">Projekt hinzufügen</Button>} />
      </Section>
      <Section title="Icons">
        {ICON_NAMES.map((name) => (
          <span key={name} title={name}>
            <Icon name={name} />
          </span>
        ))}
      </Section>
      <PageStates />
    </div>
  );
}

export default function Gallery() {
  return (
    <div data-testid="gallery">
      {GALLERY_THEMES.map((theme) => (
        <div key={theme} data-theme={theme} data-testid={`gallery-${theme}`} style={{ background: 'var(--bg)', color: 'var(--fg)', padding: 24 }}>
          <h2 style={{ marginBottom: 16 }}>{theme === 'light' ? 'Hell' : 'Dunkel'}</h2>
          <GalleryContent />
        </div>
      ))}
    </div>
  );
}
