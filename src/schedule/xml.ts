/**
 * Small XML reader for the task definition that the Task Scheduler exports (package 09 §4.3). It reads
 * what the status check needs: elements and their text. Attributes, comments, declarations and
 * namespaces are skipped. No new dependency (spec.md §4.1).
 */

export interface XmlNode {
  /** Local name without namespace prefix. */
  name: string;
  children: XmlNode[];
  /** Decoded, trimmed text of the direct text children. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}

/** Throws `Error` for text that is not well-formed XML with a single root element. */
export function parseXml(source: string): XmlNode {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const match = TOKEN.exec(text);
    if (match === null) throw new Error(`XML ungültig an Zeichen ${TOKEN.lastIndex}`);
    const [token, cdata, closing, opening, , selfClosing, content] = match;
    const top = stack.at(-1);
    if (closing !== undefined) {
      if (top === undefined || top.name !== localName(closing)) throw new Error(`XML ungültig: unerwartetes Ende von ${closing}`);
      stack.pop();
    } else if (opening !== undefined) {
      const node: XmlNode = { name: localName(opening), children: [], text: '' };
      if (top !== undefined) top.children.push(node);
      else if (root === null) root = node;
      else throw new Error('XML ungültig: mehrere Wurzelelemente');
      if (selfClosing !== '/') stack.push(node);
    } else if (cdata !== undefined && top !== undefined) {
      top.text += cdata;
    } else if (content !== undefined) {
      if (top !== undefined) top.text += decode(content);
      else if (content.trim() !== '') throw new Error('XML ungültig: Text ausserhalb der Wurzel');
    } else if (token.startsWith('<![CDATA[')) {
      throw new Error('XML ungültig: CDATA ausserhalb der Wurzel');
    }
  }
  if (root === null || stack.length > 0) throw new Error('XML ungültig: unvollständig');
  const trim = (node: XmlNode): void => {
    node.text = node.text.trim();
    node.children.forEach(trim);
  };
  trim(root);
  return root;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

/** First element at a path of names such as `Settings/Enabled`, or `undefined`. */
export function findPath(node: XmlNode, path: string): XmlNode | undefined {
  let current: XmlNode | undefined = node;
  for (const name of path.split('/')) {
    current = current?.children.find((child) => child.name === name);
  }
  return current;
}

export function textAt(node: XmlNode, path: string): string | null {
  return findPath(node, path)?.text ?? null;
}
