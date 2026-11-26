import { isValidElement, useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReferenceIndex } from '../../shared/views';
import { ConfirmDialog, ContentLabel, RefChip } from '../components';
import { SHA256, isHttpUrl, rowLabel, sectionLabel, shortHash, slug, type DocKind, type RefInfo } from './plugins';
import { remarkEvidenceKinds, remarkReferences } from './remark';

export interface MarkdownViewProps {
  markdown: string;
  docKind: DocKind;
  /** Snapshot of a work log, so that a bare `E001` can become `S000002:E001`. */
  snapshotId?: string | null;
  /** Used to tell which note references exist (spec §11.4). */
  references?: ReferenceIndex | null;
  /** Context references (`C01`) to their path, from the sources of a journal. */
  contexts?: Record<string, string>;
  onReference?: (ref: RefInfo) => void;
  /** Called after the user confirmed to open a link (spec §11.1). */
  onOpenExternal?: (url: string) => void;
  /** Evidence reference to highlight in the table "Belege". */
  highlight?: string | null;
  /** Called with a hash the user clicked, to copy it. */
  onCopy?: (text: string) => void;
}

/** Text of a React subtree, used to read the wording of headings, list lines and cells. */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode; refid?: string }>(node)) {
    // A reference chip carries its text in a property, not in children.
    return typeof node.props.refid === 'string' ? node.props.refid : textOf(node.props.children);
  }
  return '';
}

/**
 * Renders Markdown into React elements, never into HTML (spec §11.1, AD-10): raw HTML is skipped, images show their
 * alternative text, only http and https links are links, and a click asks before anything opens.
 */
export function MarkdownView({ markdown, docKind, snapshotId = null, references = null, contexts = {}, onReference, onOpenExternal, highlight = null, onCopy }: MarkdownViewProps) {
  const [pendingLink, setPendingLink] = useState<string | null>(null);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkReferences({ snapshotId }), remarkEvidenceKinds()], [snapshotId]);

  const requestLink = useCallback((url: string) => setPendingLink(url), []);

  const components = useMemo(() => {
    const Chip: ComponentType<Record<string, string>> = (props) => {
      const kind = props['refkind'] as RefInfo['kind'];
      const id = props['refid'] ?? '';
      const target: RefInfo = { kind, id, snapshotId: props['refsnapshot'] === '' ? null : (props['refsnapshot'] ?? null) };
      if (kind === 'context') {
        const path = contexts[id];
        return (
          <span title={path === undefined ? 'Kontext-Referenz' : path}>
            <RefChip id={id} kind="commit" />
          </span>
        );
      }
      if (kind === 'note' && references !== null && references !== undefined && references.notes[id] === undefined) {
        return (
          <span title="Notiz nicht gefunden" className="md-ref--missing">
            <RefChip id={id} kind="note" />
          </span>
        );
      }
      return <RefChip id={id} kind={kind === 'note' ? 'note' : 'snapshot'} {...(onReference !== undefined ? { onOpen: () => onReference(target) } : {})} />;
    };

    const map = {
      refchip: Chip,
      h2: ({ children }: { children?: ReactNode }) => {
        const title = textOf(children);
        const label = sectionLabel(docKind, title);
        return (
          <h2 id={slug(title)}>
            {children}
            {label === null ? null : (
              <>
                {' '}
                <span className="md-label">
                  <ContentLabel kind={label} />
                </span>
              </>
            )}
          </h2>
        );
      },
      li: ({ children }: { children?: ReactNode }) => {
        const label = rowLabel(textOf(children));
        return (
          <li>
            {children}
            {label === null ? null : (
              <>
                {' '}
                <span className="md-label">
                  <ContentLabel kind={label} />
                </span>
              </>
            )}
          </li>
        );
      },
      a: ({ href, children }: { href?: string; children?: ReactNode }) =>
        isHttpUrl(href) ? (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              requestLink(href);
            }}
          >
            {children}
          </a>
        ) : (
          // javascript:, file:, data: and the like are plain text, never links.
          <span>{children}</span>
        ),
      img: ({ alt }: { alt?: string }) => <span className="md-img">{alt ?? ''}</span>,
      table: ({ children }: { children?: ReactNode }) => (
        <div className="md-table" tabIndex={0} role="region" aria-label="Tabelle im Dokument">
          <table>{children}</table>
        </div>
      ),
      tr: ({ children }: { children?: ReactNode }) => {
        const text = textOf(children);
        const marked = highlight !== null && text.includes(highlight);
        return <tr className={marked ? 'md-row--hit' : undefined}>{children}</tr>;
      },
      td: ({ children, title }: { children?: ReactNode; title?: string }) => {
        const text = textOf(children).trim();
        if (SHA256.test(text)) {
          return (
            <td>
              <button type="button" className="md-hash" title={`Klicken, um den vollständigen Hash zu kopieren: ${text}`} onClick={() => onCopy?.(text)}>
                {shortHash(text)}
              </button>
            </td>
          );
        }
        return <td title={title}>{children}</td>;
      },
    };
    return map as unknown as Components;
  }, [docKind, references, contexts, onReference, requestLink, onCopy, highlight]);

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} skipHtml components={components} urlTransform={(url) => url}>
        {markdown}
      </ReactMarkdown>
      {pendingLink !== null ? (
        <ConfirmDialog
          title="Link im Browser öffnen?"
          confirmLabel="Öffnen"
          onClose={() => setPendingLink(null)}
          onConfirm={() => {
            const url = pendingLink;
            setPendingLink(null);
            onOpenExternal?.(url);
          }}
        >
          <p className="mono" style={{ overflowWrap: 'anywhere' }}>
            {pendingLink}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
