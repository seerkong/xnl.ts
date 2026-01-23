import {
  AttributeMap,
  DataElementNode,
  ElementNode,
  ExtendBody,
  TextElementNode,
  XnlDocument,
  XnlNode,
  isWord,
  wordToString,
  XnlWord,
} from "../types";

export type PathItemType = "UniqueName" | "MetadataSelector" | "InstanceProperty" | "MapKey" | "ListIndex";

export interface PathItem {
  type: PathItemType;
  value: string;
}

export type XnlPath = PathItem[];

export interface ResolveOptions {
  strict?: boolean;
}

export interface SetOptions extends ResolveOptions {
  mode?: "insert" | "replace";
}

export class XnlPathError extends Error {}

export function parsePath(input: string): XnlPath {
  if (!input) return [];
  const items: PathItem[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];
    if (c === "#") {
      i += 1;
      const { value, length } = readWordToken(input, i);
      items.push({ type: "UniqueName", value });
      i += length;
      continue;
    }
    if (c === "{") {
      const parsed = parseMetadataSelector(input, i);
      items.push(parsed.item);
      i = parsed.nextIndex;
      continue;
    }
    if (c === ":" && next === ":") {
      i += 2;
      if (input[i] === "'") {
        i += 1;
        const end = input.indexOf("'", i);
        if (end === -1) throw new XnlPathError("Unterminated map key literal");
        const key = input.slice(i, end);
        items.push({ type: "MapKey", value: key });
        i = end + 1;
      } else {
        const digits = readWhile(input, i, (ch) => /[0-9]/.test(ch));
        if (!digits) throw new XnlPathError("ListIndex must be numeric");
        items.push({ type: "ListIndex", value: digits });
        i += digits.length;
      }
      continue;
    }
    if (c === ":") {
      i += 1;
      const value = readUntilDelimiter(input, i);
      if (!value) throw new XnlPathError("InstanceProperty cannot be empty");
      items.push({ type: "InstanceProperty", value });
      i += value.length;
      continue;
    }
    if (c === ".") {
      throw new XnlPathError("Namespace/static segments are not supported for XNL paths");
    }
    throw new XnlPathError(`Unexpected character '${c}' at position ${i}`);
  }
  return items;
}

export function resolvePath(target: XnlDocument | XnlNode, path: string | XnlPath, options: ResolveOptions = {}): any {
  const { strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  let current: any = target;

  for (const item of parsed) {
     if (item.type === "UniqueName") {
       const found = findByUniqueName(target, item.value);
       if (!found) {
         if (strict) throw new XnlPathError(`UniqueName '${item.value}' not found`);
         return undefined;
       }
       current = found;
       continue;
     }
     if (item.type === "MetadataSelector") {
       const found = findByMetadataSelector(target, item.value);
       if (!found) {
         if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
         return undefined;
       }
       current = found;
       continue;
     }

    if (item.type === "InstanceProperty") {
      if (current && isDataElement(current)) {
        current = (current as any)[item.value];
      } else if (current && isTextElement(current)) {
        current = (current as any)[item.value];
      } else if (isPlainObject(current) || isDocument(current)) {
        current = (current as any)[item.value];
      } else {
        if (strict) throw new XnlPathError(`InstanceProperty '${item.value}' not allowed on current node`);
        return undefined;
      }
      if (current === undefined && strict) {
        throw new XnlPathError(`InstanceProperty '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "MapKey") {
      if (isExtendBody(current)) {
        const child = current.children[item.value];
        if (!child && strict) throw new XnlPathError(`Extend child '${item.value}' not found`);
        current = child;
        continue;
      }
      if (!isPlainObject(current)) {
        if (strict) throw new XnlPathError("MapKey requires a map/object target");
        return undefined;
      }
      if (!(item.value in (current as any)) && strict) {
        throw new XnlPathError(`Key '${item.value}' not found`);
      }
      current = (current as any)[item.value];
      continue;
    }
    if (item.type === "ListIndex") {
      const index = Number(item.value);
      if (isExtendBody(current)) {
        const tag = current.order[index];
        if (tag === undefined) {
          if (strict) throw new XnlPathError(`Extend index ${index} out of bounds`);
          return undefined;
        }
        current = current.children[tag];
        continue;
      }
      if (!Array.isArray(current)) {
        if (strict) throw new XnlPathError("ListIndex requires an array target");
        return undefined;
      }
      if (index < 0 || index >= current.length) {
        if (strict) throw new XnlPathError(`Index ${index} out of bounds`);
        return undefined;
      }
      current = current[index];
    }
  }
  return current;
}

export function setPathValue(
  target: XnlDocument | XnlNode,
  path: string | XnlPath,
  value: any,
  options: SetOptions = {}
): any {
  const { mode = "insert", strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  if (parsed.length === 0) {
    return value;
  }
  const { parent, last } = getParentAndLast(target, parsed, { strict, createMissing: true });

  switch (last.type) {
    case "InstanceProperty":
      (parent as any)[last.value] = value;
      return target;
    case "MapKey":
      if (isExtendBody(parent)) {
        parent.children[last.value] = value;
        if (!parent.order.includes(last.value)) {
          parent.order.push(last.value);
        }
        return target;
      }
      ensureMap(parent, strict);
      (parent as any)[last.value] = value;
      return target;
    case "ListIndex": {
      const idx = Number(last.value);
      if (isExtendBody(parent)) {
        if (mode === "insert") {
          parent.order.splice(idx, 0, value.tag ?? String(idx));
          parent.children[value.tag ?? String(idx)] = value;
        } else {
          const tag = parent.order[idx];
          if (tag === undefined && strict) {
            throw new XnlPathError(`Extend index ${idx} out of bounds`);
          }
          const useTag = value?.tag ?? tag;
          parent.order[idx] = useTag;
          parent.children[useTag] = value;
        }
        return target;
      }
      if (!Array.isArray(parent)) {
        throw new XnlPathError("ListIndex requires an array target");
      }
      if (mode === "insert") {
        const insertAt = idx < 0 ? 0 : idx > parent.length ? parent.length : idx;
        parent.splice(insertAt, 0, value);
      } else {
        if (idx < 0 || idx >= parent.length) {
          throw new XnlPathError(`Index ${idx} out of bounds for replace`);
        }
        parent[idx] = value;
      }
      return target;
    }
    default:
      throw new XnlPathError(`Unsupported path item ${last.type}`);
  }
}

export function deleteAtPath(target: XnlDocument | XnlNode, path: string | XnlPath, options: ResolveOptions = {}): any {
  const { strict = true } = options;
  const parsed = Array.isArray(path) ? path : parsePath(path);
  if (parsed.length === 0) return undefined;
  const { parent, last } = getParentAndLast(target, parsed, { strict, createMissing: false });
  switch (last.type) {
    case "InstanceProperty":
      if (isPlainObject(parent) || isDataElement(parent) || isTextElement(parent) || isDocument(parent)) {
        if (!(last.value in (parent as any)) && strict) {
          throw new XnlPathError(`InstanceProperty '${last.value}' not found`);
        }
        delete (parent as any)[last.value];
        return target;
      }
      throw new XnlPathError("InstanceProperty delete requires an object-like target");
    case "MapKey":
      if (isExtendBody(parent)) {
        if (!(last.value in parent.children) && strict) {
          throw new XnlPathError(`Extend child '${last.value}' not found`);
        }
        delete parent.children[last.value];
        parent.order = parent.order.filter((t) => t !== last.value);
        return target;
      }
      ensureMap(parent, strict);
      delete (parent as any)[last.value];
      return target;
    case "ListIndex": {
      const idx = Number(last.value);
      if (isExtendBody(parent)) {
        if (idx < 0 || idx >= parent.order.length) {
          if (strict) throw new XnlPathError(`Extend index ${idx} out of bounds`);
          return target;
        }
        const tag = parent.order[idx];
        parent.order.splice(idx, 1);
        delete parent.children[tag];
        return target;
      }
      if (!Array.isArray(parent)) throw new XnlPathError("ListIndex delete requires an array target");
      if (idx < 0 || idx >= parent.length) {
        if (strict) throw new XnlPathError(`Index ${idx} out of bounds`);
        return target;
      }
      parent.splice(idx, 1);
      return target;
    }
    default:
      throw new XnlPathError(`Unsupported path item ${last.type}`);
  }
}

function getParentAndLast(
  target: XnlDocument | XnlNode,
  path: XnlPath,
  opts: ResolveOptions & { createMissing: boolean }
): { parent: any; last: PathItem } {
  if (path.length === 0) throw new XnlPathError("Path is empty");
  const { createMissing, strict = true } = opts;
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  let current: any = target;
  for (const item of parentPath) {
    if (item.type === "UniqueName") {
      const found = findByUniqueName(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`UniqueName '${item.value}' not found`);
        return { parent: undefined, last };
      }
      current = found;
      continue;
    }
    if (item.type === "MetadataSelector") {
      const found = findByMetadataSelector(target, item.value);
      if (!found) {
        if (strict) throw new XnlPathError(`MetadataSelector '${item.value}' not found`);
        return { parent: undefined, last };
      }
      current = found;
      continue;
    }
    if (item.type === "InstanceProperty") {
      if (current && isDataElement(current)) {
        if ((current as any)[item.value] === undefined && createMissing) {
          if (item.value === "metadata" || item.value === "attributes") {
            (current as any)[item.value] = {};
          } else if (item.value === "body") {
            (current as any)[item.value] = [];
          } else if (item.value === "extend") {
            (current as any)[item.value] = { order: [], children: {} } as ExtendBody;
          }
        }
        current = (current as any)[item.value];
      } else if (current && isTextElement(current)) {
        current = (current as any)[item.value];
      } else if (isPlainObject(current) || isDocument(current)) {
        if ((current as any)[item.value] === undefined && createMissing && isPlainObject(current)) {
          (current as any)[item.value] = {};
        }
        current = (current as any)[item.value];
      } else {
        throw new XnlPathError(`InstanceProperty '${item.value}' not allowed on current node`);
      }
      if (current === undefined && strict) {
        throw new XnlPathError(`InstanceProperty '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "MapKey") {
      if (isExtendBody(current)) {
        const child = current.children[item.value];
        if (!child && createMissing) {
          current.children[item.value] = undefined as any;
          if (!current.order.includes(item.value)) {
            current.order.push(item.value);
          }
        }
        current = current.children[item.value];
        if (current === undefined && strict && !createMissing) {
          throw new XnlPathError(`Extend child '${item.value}' not found`);
        }
        continue;
      }
      ensureMap(current, strict);
      if (!(item.value in (current as any)) && createMissing) {
        (current as any)[item.value] = {};
      }
      current = (current as any)[item.value];
      if (current === undefined && strict && !createMissing) {
        throw new XnlPathError(`Key '${item.value}' not found`);
      }
      continue;
    }
    if (item.type === "ListIndex") {
      const idx = Number(item.value);
      if (isExtendBody(current)) {
        if (idx < 0 || idx > current.order.length) {
          throw new XnlPathError(`Extend index ${idx} out of bounds`);
        }
        const tag = current.order[idx];
        if (!tag && createMissing) {
          const placeholder = String(idx);
          current.order[idx] = placeholder;
          current.children[placeholder] = undefined as any;
          current = current.children[placeholder];
        } else {
          if (tag === undefined && strict) {
            throw new XnlPathError(`Extend index ${idx} out of bounds`);
          }
          current = current.children[tag];
        }
        continue;
      }
      if (!Array.isArray(current)) {
        if (!strict && !current) return { parent: undefined, last };
        throw new XnlPathError("ListIndex requires an array target");
      }
      if (idx < 0 || idx > current.length) {
        throw new XnlPathError(`Index ${idx} out of bounds`);
      }
      if (createMissing && idx === current.length) {
        current.push(undefined as any);
      }
      current = current[idx];
      continue;
    }
  }
  return { parent: current, last };
}

function readUntilDelimiter(input: string, start: number): string {
  let i = start;
  let value = "";
  while (i < input.length) {
    const c = input[i];
    if (c === ":" || c === "#" || c === "." || c === "{") break;
    value += c;
    i++;
  }
  return value;
}

function readWordToken(input: string, start: number): { value: string; length: number } {
  let i = start;
  let value = "";
  while (i < input.length) {
    const c = input[i];
    if (c === ":" || c === "#") break;
    value += c;
    i++;
  }
  if (!value) throw new XnlPathError("UniqueName cannot be empty");
  const segments = value.split(".");
  for (const segment of segments) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment)) {
      throw new XnlPathError("UniqueName must use word identifiers (letters/digits/_/- with dots for namespace)");
    }
  }
  return { value, length: value.length };
}

function readWhile(input: string, start: number, pred: (c: string) => boolean): string {
  let i = start;
  let out = "";
  while (i < input.length && pred(input[i])) {
    out += input[i];
    i++;
  }
  return out;
}

function findByUniqueName(target: XnlDocument | XnlNode, id: string): ElementNode | undefined {
  const roots: XnlNode[] = isDocument(target) ? target.nodes : [target as XnlNode];
  for (const root of roots) {
    const found = findInNode(root, id);
    if (found) return found;
  }
  return undefined;
}

function findByMetadataSelector(target: XnlDocument | XnlNode, selector: string): ElementNode | undefined {
  const parsed = parseMetadataSelectorValue(selector);
  const roots: XnlNode[] = isDocument(target) ? target.nodes : [target as XnlNode];
  for (const root of roots) {
    const found = findInNodeByMeta(root, parsed.key, parsed.value);
    if (found) return found;
  }
  return undefined;
}

function findInNodeByMeta(node: XnlNode, key: string, value: string): ElementNode | undefined {
  if (isElementNode(node)) {
    const meta = (node as any).metadata as AttributeMap | undefined;
    const raw = meta ? (meta as any)[key] : undefined;
    const rawStr = typeof raw === "string" ? raw : isWord(raw) ? wordToString(raw) : undefined;
    if (rawStr === value) return node;

    if (node.kind === "DataElement") {
      if (node.body) {
        for (const child of node.body) {
          const found = findInNodeByMeta(child, key, value);
          if (found) return found;
        }
      }
      if (node.extend) {
        for (const tag of node.extend.order) {
          const child = node.extend.children[tag];
          if (!child) continue;
          const found = findInNodeByMeta(child, key, value);
          if (found) return found;
        }
      }
    }

    return undefined;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInNodeByMeta(child, key, value);
      if (found) return found;
    }
  } else if (isPlainObject(node)) {
    for (const k of Object.keys(node)) {
      const found = findInNodeByMeta((node as any)[k], key, value);
      if (found) return found;
    }
  }

  return undefined;
}

export function parseMetadataSelectorValue(selector: string): { key: string; value: string } {
  const m = selector.match(/^\{([A-Za-z_][A-Za-z0-9_-]*)=("([^"]*)"|'([^']*)')\}$/);
  if (!m) throw new XnlPathError("Invalid metadata selector");
  const key = m[1];
  const value = m[3] ?? m[4] ?? "";
  return { key, value };
}

function parseMetadataSelector(input: string, start: number): { item: PathItem; nextIndex: number } {
  if (input[start] !== "{") throw new XnlPathError("Metadata selector must start with '{'");
  const end = input.indexOf("}", start);
  if (end === -1) throw new XnlPathError("Unterminated metadata selector");
  const raw = input.slice(start, end + 1);
  parseMetadataSelectorValue(raw);
  return { item: { type: "MetadataSelector", value: raw }, nextIndex: end + 1 };
}

function findInNode(node: XnlNode, id: string): ElementNode | undefined {
  if (isElementNode(node)) {
    if (readId(node) === id) return node;
    if (node.kind === "DataElement") {
      if (node.body) {
        for (const child of node.body) {
          const found = findInNode(child, id);
          if (found) return found;
        }
      }
      if (node.extend) {
        for (const tag of node.extend.order) {
          const child = node.extend.children[tag];
          if (!child) continue;
          const found = findInNode(child, id);
          if (found) return found;
        }
      }
    }
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findInNode(child, id);
      if (found) return found;
    }
  } else if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      const found = findInNode((node as any)[key], id);
      if (found) return found;
    }
  }
  return undefined;
}

function isElementNode(node: any): node is ElementNode {
  return node && (node.kind === "DataElement" || node.kind === "TextElement");
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement";
}

function isTextElement(node: any): node is TextElementNode {
  return node && node.kind === "TextElement";
}

function isExtendBody(value: any): value is ExtendBody {
  return value && typeof value === "object" && Array.isArray(value.order) && value.children;
}

function isDocument(value: any): value is XnlDocument {
  return value && typeof value === "object" && Array.isArray((value as any).nodes);
}

function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isElementNode(value) &&
    !isExtendBody(value) &&
    !isWord(value)
  );
}

function ensureMap(value: any, strict: boolean) {
  if (!isPlainObject(value)) {
    if (strict) throw new XnlPathError("Target is not a map/object");
  }
}

function readId(node: ElementNode | undefined): string | undefined {
  if (!node) return undefined;
  const idValue = (node as any).id as XnlWord | undefined;
  const wordStr = wordToString(idValue);
  if (wordStr) return wordStr;
  const metaId = (node as any).metadata?.id;
  if (isWord(metaId)) return wordToString(metaId);
  if (typeof metaId === "string") return metaId;
  return undefined;
}
