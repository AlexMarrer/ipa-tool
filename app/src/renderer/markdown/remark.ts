import { EVIDENCE_KIND_TEXT, cellReference, splitReferences, type RefContext, type RefInfo } from './plugins';

/** The parts of an mdast node this file needs. */
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const SKIPPED = new Set(['code', 'inlineCode', 'html', 'link', 'linkReference', 'definition']);

function chipNode(ref: RefInfo): MdNode {
  return {
    type: 'refChip',
    children: [],
    // Lower-case property names pass through to the component unchanged.
    data: { hName: 'refchip', hProperties: { refkind: ref.kind, refid: ref.id, refsnapshot: ref.snapshotId ?? '' } },
  };
}

function textOf(node: MdNode): string {
  if (node.value !== undefined) return node.value;
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Turns references in text into chips (spec §11.4). Text inside code, links and raw HTML is never touched, and a
 * table cell that is exactly one reference becomes a chip.
 */
export function remarkReferences(context: RefContext): () => (tree: MdNode) => void {
  const walk = (node: MdNode): void => {
    if (SKIPPED.has(node.type) || node.children === undefined) return;
    if (node.type === 'tableCell' && node.children.length === 1 && node.children[0]?.type === 'text') {
      const ref = cellReference((node.children[0].value ?? '').trim(), context);
      if (ref !== null) {
        node.children = [chipNode(ref)];
        return;
      }
    }
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type !== 'text' || child.value === undefined) {
        walk(child);
        next.push(child);
        continue;
      }
      const parts = splitReferences(child.value, context);
      if (parts.length === 1 && typeof parts[0] === 'string') {
        next.push(child);
        continue;
      }
      for (const part of parts) next.push(typeof part === 'string' ? { type: 'text', value: part } : chipNode(part));
    }
    node.children = next;
  };
  return () => (tree) => walk(tree);
}

/** Replaces known values in the "Art" column of tables by plain text and keeps the raw value as tooltip (spec §11.2). */
export function remarkEvidenceKinds(): () => (tree: MdNode) => void {
  const walk = (node: MdNode): void => {
    if (node.type === 'table' && node.children !== undefined) {
      const header = node.children[0];
      const column = header?.children?.findIndex((cell) => textOf(cell).trim().toLowerCase() === 'art') ?? -1;
      if (column !== -1) {
        for (const row of node.children.slice(1)) {
          const cell = row.children?.[column];
          const only = cell?.children?.length === 1 ? cell.children[0] : undefined;
          const raw = only?.type === 'text' ? (only.value ?? '').trim() : '';
          const plain = EVIDENCE_KIND_TEXT[raw];
          if (cell !== undefined && only !== undefined && plain !== undefined) {
            only.value = plain;
            cell.data = { ...cell.data, hProperties: { ...cell.data?.hProperties, title: raw } };
          }
        }
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  return () => (tree) => walk(tree);
}
