import {
  AttributeMap,
  DataElementNode,
  ElementNode,
  ExtendBody,
  TextElementNode,
  XnlDocument,
  XnlNode,
  XnlWord,
  isWord,
  wordToString,
} from "../types";
import { parseXnl } from "../parser";

export interface LoaderContext {
  prototypes: Record<string, Record<string, DataElementNode>>;
}

const SYSTEM_FIELDS = {
  proto: "proto",
  extendType: "extendType",
  exportFlag: "export",
  remove: "remove",
  name: "name",
  id: "id",
};

export function loadFromString(input: string): XnlDocument {
  const parsed = parseXnl(input);
  const ctx = buildPrototypeContext(parsed.nodes);
  const resolvedNodes = parsed.nodes.map((n) => (isDataElement(n) ? resolveNode(ctx, n, []) : n));
  return { nodes: resolvedNodes, warnings: parsed.warnings };
}

export function resolveNode(
  ctx: LoaderContext,
  node: DataElementNode,
  scope: Record<string, Record<string, DataElementNode>>[]
): DataElementNode {
  const protoName = readStringMeta(node.metadata, SYSTEM_FIELDS.proto);
  const extendType = readStringMeta(node.metadata, SYSTEM_FIELDS.extendType) ?? "Override";

  const localPrefabs = collectTypedPrefabs(node);
  const nextScope = [localPrefabs, ...scope];

  let resolved = cloneDataElement(node);
  if (protoName) {
    const proto = lookupPrototype(ctx, node.tag, protoName, nextScope);
    const merged = mergeNodes(ctx, proto, resolved, extendType, nextScope);
    resolved = merged;
  } else {
    resolved = resolveChildren(ctx, resolved, nextScope);
  }

  resolved.metadata = mergeMaps(ctx, {}, resolved.metadata, nextScope);
  resolved.attributes = mergeMaps(ctx, {}, resolved.attributes ?? {}, nextScope);
  stripControlMetadata(resolved.metadata);
  if (resolved.attributes) stripControlMetadata(resolved.attributes as AttributeMap);
  return resolved;
}

export function batchLoad(batches: DataElementNode[][]): {
  resolved: DataElementNode[][];
  exports: Record<string, Record<string, DataElementNode>>;
} {
  const allNodes = batches.flat();
  const ctx = buildPrototypeContext(allNodes);
  const exportsMap: Record<string, Record<string, DataElementNode>> = {};
  const resolved = batches.map((batch) =>
    batch.map((node) => {
      if (!isDataElement(node)) return node;
      const rawExportName = readExportName(node);
      let resolvedNode = resolveNode(ctx, node, []);
      resolvedNode = resolvePending(resolvedNode, ctx, []);
      const exportName = rawExportName ?? readExportName(resolvedNode);
      if (exportName) {
        exportsMap[resolvedNode.tag] = exportsMap[resolvedNode.tag] ?? {};
        exportsMap[resolvedNode.tag][exportName] = resolvedNode;
      }
      collectExportsFromPrefabs(resolvedNode, exportsMap);
      return resolvedNode;
    })
  );
  return { resolved, exports: exportsMap };
}

function buildPrototypeContext(nodes: XnlNode[]): LoaderContext {
  const prototypes: Record<string, Record<string, DataElementNode>> = {};
  for (const node of nodes) {
    if (!isDataElement(node)) continue;
    collectPrefabs(node, prototypes);
  }
  return { prototypes };
}

function collectPrefabs(node: DataElementNode, store: Record<string, Record<string, DataElementNode>>) {
  const typed = collectTypedPrefabs(node);
  for (const [type, prefabs] of Object.entries(typed)) {
    store[type] = store[type] ?? {};
    for (const [name, prefab] of Object.entries(prefabs)) {
      if (!store[type][name]) {
        store[type][name] = cloneDataElement(prefab);
      }
    }
  }
  if (node.body) {
    for (const child of node.body) {
      if (isDataElement(child)) collectPrefabs(child, store);
    }
  }
  if (node.extend) {
    for (const tag of node.extend.order) {
      const child = node.extend.children[tag];
      if (isDataElement(child)) collectPrefabs(child, store);
    }
  }
}

function collectExportsFromPrefabs(node: DataElementNode, exportsMap: Record<string, Record<string, DataElementNode>>) {
  if (!node.extend) return;
  const typed = collectTypedPrefabs(node);
  for (const [type, prefabs] of Object.entries(typed)) {
    for (const [name, prefab] of Object.entries(prefabs)) {
      exportsMap[type] = exportsMap[type] ?? {};
      exportsMap[type][name] = prefab;
    }
  }
}

function lookupPrototype(
  ctx: LoaderContext,
  type: string,
  name: string,
  scope: Record<string, Record<string, DataElementNode>>[]
): DataElementNode {
  for (const prefabs of scope) {
    const foundScoped = prefabs[type]?.[name];
    if (foundScoped) return foundScoped;
  }
  const found = ctx.prototypes[type]?.[name];
  if (!found) {
    throw new Error(`Prototype not found for type '${type}' name '${name}'`);
  }
  return found;
}

function mergeNodes(
  ctx: LoaderContext,
  base: DataElementNode,
  override: DataElementNode,
  extendType: string,
  scope: Record<string, Record<string, DataElementNode>>[]
): DataElementNode {
  if (extendType !== "Override") {
    throw new Error(`Unsupported extendType '${extendType}'`);
  }
  const merged: DataElementNode = cloneDataElement(base);
  merged.id = override.id ?? base.id;
  merged.metadata = mergeMaps(ctx, base.metadata, override.metadata, scope);
  merged.attributes = mergeMaps(ctx, base.attributes ?? {}, override.attributes ?? {}, scope);
  merged.body = mergeBody(ctx, base.body ?? [], override.body ?? [], scope);
  merged.extend = mergeExtend(ctx, base.extend, override.extend, scope);

  stripControlMetadata(merged.metadata);
  if (merged.attributes) stripControlMetadata(merged.attributes as AttributeMap);
  return merged;
}

function resolveChildren(
  ctx: LoaderContext,
  node: DataElementNode,
  scope: Record<string, Record<string, DataElementNode>>[]
): DataElementNode {
  const copy = cloneDataElement(node);
  if (copy.body) {
    copy.body = copy.body.map((item) => resolveValue(ctx, item, scope));
  }
  if (copy.extend) {
    const nextChildren: Record<string, ElementNode> = {};
    for (const tag of copy.extend.order) {
      const child = copy.extend.children[tag];
      nextChildren[tag] = resolveValue(ctx, child, scope) as ElementNode;
    }
    copy.extend = { order: [...copy.extend.order], children: nextChildren };
  }
  return copy;
}

function mergeBody(
  ctx: LoaderContext,
  baseBody: XnlNode[],
  overrideBody: XnlNode[],
  scope: Record<string, Record<string, DataElementNode>>[]
): XnlNode[] {
  const result: XnlNode[] = [];
  const baseById: Record<string, XnlNode> = {};
  for (const item of baseBody) {
    const id = readElementId(item);
    if (id) baseById[id] = item;
    result.push(resolveValue(ctx, item, scope));
  }
  for (const item of overrideBody) {
    if (isRemoveFlag(item) || isRemoveMarker(item)) {
      const id = readElementId(item);
      if (id && baseById[id]) {
        const index = result.findIndex((n) => readElementId(n) === id);
        if (index >= 0) {
          result.splice(index, 1);
        }
      }
      continue;
    }
    const id = readElementId(item);
    if (id && baseById[id] && isDataElement(baseById[id]) && isDataElement(item)) {
      const merged = mergeNodes(ctx, baseById[id] as DataElementNode, item, "Override", scope);
      const idx = result.findIndex((n) => readElementId(n) === id);
      if (idx >= 0) {
        result[idx] = merged;
        continue;
      }
    }
    result.push(resolveValue(ctx, item, scope));
  }
  return result;
}

function mergeExtend(
  ctx: LoaderContext,
  baseExtend: ExtendBody | undefined,
  overrideExtend: ExtendBody | undefined,
  scope: Record<string, Record<string, DataElementNode>>[]
): ExtendBody | undefined {
  if (!baseExtend && !overrideExtend) return undefined;
  if (!baseExtend) return resolveExtend(ctx, overrideExtend, scope);
  if (!overrideExtend) return resolveExtend(ctx, baseExtend, scope);

  const order: string[] = [...baseExtend.order];
  const children: Record<string, ElementNode> = { ...baseExtend.children };

  for (const tag of overrideExtend.order) {
    const child = overrideExtend.children[tag];
    const existing = children[tag];
    if (isDataElement(child) && (isRemoveFlag(child) || isRemoveMarker(child))) {
      delete children[tag];
      const idx = order.indexOf(tag);
      if (idx >= 0) order.splice(idx, 1);
      continue;
    }
    if (existing && isDataElement(existing) && isDataElement(child)) {
      children[tag] = mergeNodes(ctx, existing, child, "Override", scope);
    } else {
      children[tag] = resolveValue(ctx, child, scope) as ElementNode;
    }
    if (!order.includes(tag)) order.push(tag);
  }
  return { order, children };
}

function resolveExtend(
  ctx: LoaderContext,
  extend: ExtendBody | undefined,
  scope: Record<string, Record<string, DataElementNode>>[]
): ExtendBody | undefined {
  if (!extend) return undefined;
  const children: Record<string, ElementNode> = {};
  for (const tag of extend.order) {
    const child = extend.children[tag];
    children[tag] = resolveValue(ctx, child, scope) as ElementNode;
  }
  return { order: [...extend.order], children };
}

function cloneDataElement(node: DataElementNode): DataElementNode {
  return {
    kind: "DataElement",
    tag: node.tag,
    id: node.id ? cloneWord(node.id) : undefined,
    metadata: cloneMap(node.metadata),
    attributes: node.attributes ? cloneMap(node.attributes) : undefined,
    body: node.body ? node.body.map((n) => cloneNode(n)) : undefined,
    extend: node.extend ? cloneExtend(node.extend) : undefined,
  };
}

function cloneExtend(extend: ExtendBody): ExtendBody {
  const children: Record<string, ElementNode> = {};
  for (const tag of extend.order) {
    children[tag] = cloneNode(extend.children[tag]) as ElementNode;
  }
  return { order: [...extend.order], children };
}

function cloneNode<T extends XnlNode>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((n) => cloneNode(n)) as unknown as T;
  }
  if (isWord(node)) {
    return cloneWord(node) as unknown as T;
  }
  if (isPlainObject(node)) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(node)) {
      out[key] = cloneNode((node as any)[key]);
    }
    return out as T;
  }
  if (isDataElement(node)) return cloneDataElement(node) as unknown as T;
  return node;
}

function cloneMap(map: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of Object.keys(map || {})) {
    out[key] = cloneNode(map[key]);
  }
  return out;
}

function mergeMaps(
  ctx: LoaderContext,
  base: Record<string, any>,
  override: Record<string, any>,
  scope: Record<string, Record<string, DataElementNode>>[]
): Record<string, any> {
  const result = cloneMap(base || {});
  for (const key of Object.keys(override || {})) {
    const value = override[key];
    if (isRemoveMarker(value)) {
      delete result[key];
      continue;
    }
    const resolvedValue = resolveValue(ctx, value, scope);
    if (isPlainObject(resolvedValue) && isPlainObject(result[key])) {
      result[key] = mergeMaps(ctx, result[key], resolvedValue, scope);
    } else if (Array.isArray(resolvedValue) && Array.isArray(result[key])) {
      result[key] = mergeArray(ctx, result[key], resolvedValue, scope);
    } else {
      result[key] = resolvedValue;
    }
  }
  return result;
}

function mergeArray(
  ctx: LoaderContext,
  baseArr: any[],
  overrideArr: any[],
  scope: Record<string, Record<string, DataElementNode>>[]
): any[] {
  const result = baseArr.map((v) => resolveValue(ctx, v, scope));
  for (let i = 0; i < overrideArr.length; i++) {
    const value = overrideArr[i];
    if (isRemoveMarker(value)) {
      if (i < result.length) result.splice(i, 1);
      continue;
    }
    const resolved = resolveValue(ctx, value, scope);
    if (i < result.length) {
      const baseVal = result[i];
      if (isPlainObject(baseVal) && isPlainObject(resolved)) {
        result[i] = mergeMaps(ctx, baseVal, resolved, scope);
      } else if (Array.isArray(baseVal) && Array.isArray(resolved)) {
        result[i] = mergeArray(ctx, baseVal, resolved, scope);
      } else {
        result[i] = resolved;
      }
    } else {
      result.push(resolved);
    }
  }
  return result;
}

function stripControlMetadata(meta: AttributeMap) {
  delete (meta as any)[SYSTEM_FIELDS.proto];
  delete (meta as any)[SYSTEM_FIELDS.extendType];
  delete (meta as any)[SYSTEM_FIELDS.exportFlag];
  delete (meta as any)[SYSTEM_FIELDS.remove];
}

function readExportName(node: DataElementNode): string | undefined {
  const exported = node.metadata?.[SYSTEM_FIELDS.exportFlag];
  if (exported !== true && exported !== "true") return undefined;
  const id = wordToString(node.id);
  if (id) return id;
  const nameVal = (node.metadata as any)?.[SYSTEM_FIELDS.name];
  const name = asString(nameVal);
  return name;
}

function readElementId(node: XnlNode): string | undefined {
  if (isDataElement(node) || isTextElement(node)) {
    const idVal = (node as any).id as XnlWord | undefined;
    const id = wordToString(idVal);
    if (id) return id;
    const metaId = (node as any).metadata?.[SYSTEM_FIELDS.id];
    const metaIdStr = asString(metaId);
    if (metaIdStr) return metaIdStr;
  }
  return undefined;
}

function readStringMeta(meta: AttributeMap, key: string): string | undefined {
  const val = meta?.[key];
  return asString(val);
}

function isRemoveFlag(node: any): boolean {
  return !!(node && (node.metadata?.[SYSTEM_FIELDS.remove] === true || node.metadata?.[SYSTEM_FIELDS.remove] === "true"));
}

function isRemoveMarker(node: any): boolean {
  return isDataElement(node) && node.tag === "delta" && isRemoveFlag(node);
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement" && typeof node.tag === "string" && node.metadata !== null && typeof node.metadata === "object" && !Array.isArray(node.metadata);
}

function isTextElement(node: any): node is TextElementNode {
  return node && node.kind === "TextElement" && typeof node.tag === "string" && node.metadata !== null && typeof node.metadata === "object" && !Array.isArray(node.metadata);
}

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement(value) && !isWord(value);
}

function resolveValue(
  ctx: LoaderContext,
  value: XnlNode,
  scope: Record<string, Record<string, DataElementNode>>[]
): XnlNode {
  if (isDataElement(value)) {
    const proto = readStringMeta(value.metadata, SYSTEM_FIELDS.proto);
    if (proto) {
      return resolveNode(ctx, value, scope);
    }
    const resolved = resolveChildren(ctx, value, scope);
    resolved.attributes = mergeMaps(ctx, {}, resolved.attributes ?? {}, scope);
    resolved.metadata = mergeMaps(ctx, {}, resolved.metadata ?? {}, scope);
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(ctx, v, scope));
  }
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = resolveValue(ctx, (value as any)[key], scope);
    }
    return out;
  }
  return cloneNode(value);
}

function collectTypedPrefabs(node: DataElementNode): Record<string, Record<string, DataElementNode>> {
  const result: Record<string, Record<string, DataElementNode>> = {};
  if (!node.extend) return result;
  const suffix = "Prefabs";
  for (const tag of node.extend.order) {
    const child: ElementNode | undefined = node.extend.children[tag];
    if (!isDataElement(child) || !child.body) continue;
    if (tag === "Prefabs") {
      for (const prefab of child.body as XnlNode[]) {
        if (!isDataElement(prefab)) continue;
        const name = readExportName(prefab) ?? readElementId(prefab);
        if (!name) continue;
        const type = prefab.tag;
        result[type] = result[type] ?? {};
        result[type][name] = cloneDataElement(prefab);
      }
      continue;
    }
    if (tag.endsWith(suffix)) {
      const type = tag.slice(0, tag.length - suffix.length);
      for (const prefab of child.body as XnlNode[]) {
        if (!isDataElement(prefab)) continue;
        const name = readExportName(prefab) ?? readElementId(prefab);
        if (!name) continue;
        result[type] = result[type] ?? {};
        result[type][name] = cloneDataElement(prefab);
      }
    }
  }
  return result;
}

function resolvePending(
  node: DataElementNode,
  ctx: LoaderContext,
  scope: Record<string, Record<string, DataElementNode>>[]
): DataElementNode {
  const resolved = resolveNode(ctx, node, scope);
  return resolved;
}

function cloneWord(word: XnlWord): XnlWord {
  return { kind: "Word", namespace: [...(word.namespace ?? [])], name: word.name };
}

function asString(value: any): string | undefined {
  if (isWord(value)) return wordToString(value) ?? undefined;
  if (typeof value === "string") return value;
  return undefined;
}
