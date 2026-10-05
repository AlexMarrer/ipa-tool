/**
 * Minimal strict XML reader for the scheduler template tests (package 08 §8), without a new dependency:
 * declaration, comments, elements, attributes, text and character references. It rejects what a
 * conforming parser rejects for these documents: unbalanced tags, several roots, a bare `&` or `<` in
 * text, unknown entities, duplicate attributes and `--` inside a comment.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Decoded text of the direct text children. */
  text: string;
}

export interface XmlDocument {
  declaration: Record<string, string> | null;
  /** Comment contents in document order. */
  comments: string[];
  root: XmlElement;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

class Reader {
  private position = 0;
  readonly comments: string[] = [];

  constructor(private readonly source: string) {}

  fail(message: string): never {
    const line = this.source.slice(0, this.position).split('\n').length;
    throw new Error(`XML ungültig in Zeile ${line}: ${message}`);
  }

  get done(): boolean {
    return this.position >= this.source.length;
  }

  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.position);
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.source[this.position]!)) this.position += 1;
  }

  expect(text: string): void {
    if (!this.startsWith(text)) this.fail(`erwartet "${text}"`);
    this.position += text.length;
  }

  name(): string {
    const match = NAME.exec(this.source.slice(this.position));
    if (match === null) this.fail('Name erwartet');
    this.position += match[0].length;
    return match[0];
  }

  decode(raw: string): string {
    if (raw.includes('<')) this.fail('"<" im Text');
    return raw.replace(/&([^;]*);?/g, (whole, entity: string) => {
      if (!whole.endsWith(';')) this.fail('"&" ohne Entität');
      if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      const value = ENTITIES[entity];
      if (value === undefined) this.fail(`unbekannte Entität &${entity};`);
      return value;
    });
  }

  attributes(): Record<string, string> {
    const result: Record<string, string> = {};
    for (;;) {
      this.skipWhitespace();
      if (this.startsWith('>') || this.startsWith('/>') || this.startsWith('?>')) return result;
      const key = this.name();
      if (key in result) this.fail(`doppeltes Attribut ${key}`);
      this.skipWhitespace();
      this.expect('=');
      this.skipWhitespace();
      const quote = this.source[this.position];
      if (quote !== '"' && quote !== "'") this.fail('Attributwert ohne Anführungszeichen');
      const end = this.source.indexOf(quote, this.position + 1);
      if (end < 0) this.fail('Attributwert nicht beendet');
      result[key] = this.decode(this.source.slice(this.position + 1, end));
      this.position = end + 1;
    }
  }

  comment(): void {
    this.expect('<!--');
    const end = this.source.indexOf('-->', this.position);
    if (end < 0) this.fail('Kommentar nicht beendet');
    const content = this.source.slice(this.position, end);
    if (content.includes('--') || content.endsWith('-')) this.fail('"--" im Kommentar');
    this.comments.push(content);
    this.position = end + 3;
  }

  element(): XmlElement {
    this.expect('<');
    const name = this.name();
    const attributes = this.attributes();
    const node: XmlElement = { name, attributes, children: [], text: '' };
    if (this.startsWith('/>')) {
      this.position += 2;
      return node;
    }
    this.expect('>');
    for (;;) {
      if (this.done) this.fail(`<${name}> nicht geschlossen`);
      if (this.startsWith('</')) {
        this.position += 2;
        const closing = this.name();
        if (closing !== name) this.fail(`</${closing}> schliesst <${name}>`);
        this.skipWhitespace();
        this.expect('>');
        return node;
      }
      if (this.startsWith('<!--')) {
        this.comment();
      } else if (this.startsWith('<')) {
        node.children.push(this.element());
      } else {
        const next = this.source.indexOf('<', this.position);
        const end = next < 0 ? this.source.length : next;
        node.text += this.decode(this.source.slice(this.position, end));
        this.position = end;
      }
    }
  }
}

export function parseXml(text: string): XmlDocument {
  // Explicitly typed, so that TypeScript treats `reader.fail` as never returning.
  const reader: Reader = new Reader(text.startsWith('﻿') ? text.slice(1) : text);
  let declaration: Record<string, string> | null = null;
  if (reader.startsWith('<?xml')) {
    reader.expect('<?xml');
    declaration = reader.attributes();
    reader.expect('?>');
  }
  let root: XmlElement | null = null;
  for (;;) {
    reader.skipWhitespace();
    if (reader.done) break;
    if (reader.startsWith('<!--')) reader.comment();
    else if (reader.startsWith('<')) {
      if (root !== null) reader.fail('mehr als ein Wurzelelement');
      root = reader.element();
    } else reader.fail('Text ausserhalb des Wurzelelements');
  }
  if (root === null) reader.fail('kein Wurzelelement');
  return { declaration, comments: reader.comments, root };
}

export function childrenNamed(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter((child) => child.name === name);
}

/** The only child of that name; fails if it is missing or repeated. */
export function only(node: XmlElement, name: string): XmlElement {
  const found = childrenNamed(node, name);
  if (found.length !== 1) throw new Error(`<${node.name}> hat ${found.length} Kinder <${name}>, erwartet 1`);
  return found[0]!;
}

/** Text at a path such as `Settings/ExecutionTimeLimit`. */
export function textAt(node: XmlElement, path: string): string {
  return path.split('/').reduce((current, name) => only(current, name), node).text;
}
