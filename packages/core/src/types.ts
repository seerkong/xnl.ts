import { isLiteralObject } from "./value-context";
import { isCapturedDenseArray, isCapturedImmutableData } from 'immutable-data-core';

export type ValueLiteral = string | boolean | null | number;

export type AttributeMap = Record<string, XnlNode>;

export interface ExtendBody {
  order: string[];
  children: Record<string, ElementNode>;
}

export type ElementNode = DataElementNode | TextElementNode;
export type ElementNodeKind = 'DataElement' | 'TextElement';

export interface DataElementNode {
  kind: "DataElement";
  tag: string;
  id?: XnlWord;
  metadata: AttributeMap;
  attributes?: AttributeMap;
  body?: XnlNode[];
  extend?: ExtendBody;
}

export interface XnlWord {
  kind: "Word";
  namespace: string[];
  name: string;
}

export interface TextElementNode {
  kind: "TextElement";
  tag: string;
  id?: XnlWord;
  metadata: AttributeMap;
  attributes?: AttributeMap;
  text?: string;
  textMarker?: string;
}

export interface CommentNode {
  kind: "Comment";
  value: string;
}

export type ContainerNode = Array<XnlNode> | Object | ElementNode;

export type XnlNode = ValueLiteral | XnlWord | ContainerNode | CommentNode;

export function isWord(value: any): value is XnlWord {
  return value !== null && typeof value === "object" && !isLiteralObject(value) && (value as any).kind === "Word";
}

const nonCanonicalWord = Symbol('non-canonical-word');
const wordDescriptor = Object.getOwnPropertyDescriptor;
const wordDescriptors = Object.getOwnPropertyDescriptors;
const wordOwnKeys = Reflect.ownKeys;
const wordArray = Array.isArray;
const wordOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (value: object, key: PropertyKey) => boolean;

function wordData(descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined && wordOwn(descriptor, 'value');
}

function finishWord(prefix: string, name: string): string | undefined {
  const value = prefix.length ? `${prefix}.${name}` : name;
  return value.length ? value : undefined;
}

/** Snapshot raw canonical data without invoking accessors or array hooks.
 * Unknown shapes keep the legacy extension behavior in wordToString. */
function rawDataWord(word: unknown): string | undefined | typeof nonCanonicalWord {
  if (!word || typeof word !== 'object' || wordArray(word)) return nonCanonicalWord;
  try {
    const kind = wordDescriptor(word, 'kind'), name = wordDescriptor(word, 'name'), namespace = wordDescriptor(word, 'namespace');
    if (!wordData(kind) || kind.value !== 'Word' || !wordData(name) || typeof name.value !== 'string'
      || !wordData(namespace) || !wordArray(namespace.value)) return nonCanonicalWord;
    const descriptors = wordDescriptors(namespace.value as object);
    const length = wordOwn(descriptors, 'length') ? descriptors.length : undefined;
    if (!wordData(length) || typeof length.value !== 'number'
      || wordOwnKeys(descriptors).length !== length.value + 1) return nonCanonicalWord;
    let prefix = '';
    for (let index = 0; index < length.value; index++) {
      const key = `${index}`;
      const descriptor = wordOwn(descriptors, key) ? descriptors[key] : undefined;
      if (!wordData(descriptor) || typeof descriptor.value !== 'string') return nonCanonicalWord;
      const part = descriptor.value;
      if (part.length) prefix = prefix.length ? `${prefix}.${part}` : part;
    }
    return finishWord(prefix, name.value);
  } catch { return nonCanonicalWord; }
}

/** Canonical Word identities are string data, independent of mutable global
 * array algorithms. Accessor/extended/noncanonical inputs retain the legacy
 * fallback, including their explicit formatting capabilities. */
export function wordToString(word?: XnlWord | null): string | undefined {
  if (!word) return undefined;
  if (isCapturedImmutableData(word) && !wordArray(word) && word.kind === 'Word' && typeof word.name === 'string'
    && isCapturedDenseArray(word.namespace)) {
    let prefix = '', canonical = true;
    for (let index = 0; index < word.namespace.length; index++) {
      const part = word.namespace[index];
      if (typeof part !== 'string') { canonical = false; break; }
      if (part.length) prefix = prefix.length ? `${prefix}.${part}` : part;
    }
    if (canonical) return finishWord(prefix, word.name);
  }
  const data = rawDataWord(word);
  if (data !== nonCanonicalWord) return data;
  const ns = word.namespace ?? [];
  const parts = [...ns.filter(Boolean), word.name].filter((p) => p !== undefined && p !== null);
  const str = parts.join(".");
  return str.length ? str : undefined;
}


export type ParseWarningCode = "DUPLICATE_CHILD";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  parentName: string;
  childName: string;
}

export interface XnlDocument {
  nodes: XnlNode[];
  warnings?: ParseWarning[];
}

export interface SingleNodeResult {
  node: XnlNode;
  warnings: ParseWarning[];
}

export interface UniqueChildrenResult {
  node: XnlNode;
  warnings: ParseWarning[];
}
