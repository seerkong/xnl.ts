import { deleteAtPath, parsePath, resolvePath, setPathValue, XnlPath, XnlPathError, PathItem } from "../path";
import { DataElementNode, TextElementNode, XnlNode, isWord, wordToString } from "../types";

export type MutationType =
  | "TREE_ADD"
  | "TREE_DELETE"
  | "TREE_MOVE"
  | "TREE_UPDATE"
  | "TREE_MOVE_SAME_LEVEL"
  | "TREE_MOVE_CROSS_LEVEL"
  | "OBJECT_ADD"
  | "OBJECT_DELETE"
  | "OBJECT_UPDATE";

export interface XnlMutation {
  type: MutationType;
  path: string | XnlPath;
  pathBefore?: string | XnlPath;
  valueBefore?: XnlNode;
  valueAfter?: XnlNode;
  metadata?: Record<string, unknown>;
  targetUniqueName?: string;
  parentUniqueNameBefore?: string;
  parentUniqueNameAfter?: string;
}

export type MetadataIdMode = "identity" | "metadata";

export interface XnlMutationOptions {
  metadataIdMode?: MetadataIdMode;
}

function resolveMetaIdMode(opts: XnlMutationOptions): MetadataIdMode {
  return opts.metadataIdMode ?? "identity";
}

function isMetadataIdPath(path: XnlPath): boolean {
  const n = path.length;
  return (
    n >= 2 &&
    path[n - 2]?.type === "InstanceProperty" &&
    path[n - 2]?.value === "metadata" &&
    path[n - 1]?.type === "MapKey" &&
    path[n - 1]?.value === "id"
  );
}

function isMetadataMapPath(path: XnlPath): boolean {
  const last = path[path.length - 1];
  return last?.type === "InstanceProperty" && last.value === "metadata";
}

export function applyMutations(root: XnlNode, mutations: XnlMutation[], opts: XnlMutationOptions = {}): XnlNode {
  let current = root;
  for (const mutation of mutations) {
    current = applySingle(current, mutation, opts);
  }
  return current;
}

export function diffNodes(
  oldNode: XnlNode,
  newNode: XnlNode,
  basePath: string | XnlPath = [],
  opts: XnlMutationOptions = {}
): XnlMutation[] {
  const pathItems = Array.isArray(basePath) ? basePath : parsePath(basePath);
  if (!sameKind(oldNode, newNode)) {
    throw new XnlPathError("Root kinds must match to diff");
  }
  if (isValueLiteral(oldNode) || isComment(oldNode)) {
    return oldNode === newNode ? [] : [{ type: "OBJECT_UPDATE", path: pathItems, valueAfter: newNode }];
  }
  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    return diffArray(oldNode, newNode, pathItems, undefined, undefined, opts);
  }
  if (isPlainObject(oldNode) && isPlainObject(newNode)) {
    return diffMap(oldNode as Record<string, any>, newNode as Record<string, any>, pathItems, undefined, undefined, opts);
  }
  if (isTextElement(oldNode) && isTextElement(newNode)) {
    return diffTextElement(oldNode, newNode, pathItems, opts);
  }
  if (isDataElement(oldNode) && isDataElement(newNode)) {
    const mutations = diffDataElement(oldNode, newNode, pathItems, opts);
    return reconcileMoves(mutations);
  }
  return [];
}

function applySingle(root: XnlNode, mutation: XnlMutation, opts: XnlMutationOptions): XnlNode {
  const { type, path, valueAfter } = mutation;
  const pathItems = Array.isArray(path) ? path : parsePath(path);

  if (resolveMetaIdMode(opts) === "identity" && isMetadataIdPath(pathItems)) {
    return root;
  }

  if (type === "TREE_MOVE" || type === "TREE_MOVE_SAME_LEVEL" || type === "TREE_MOVE_CROSS_LEVEL") {
    if (!mutation.targetUniqueName && !mutation.pathBefore) {
      throw new XnlPathError("TREE_MOVE requires targetUniqueName or pathBefore");
    }
    const fromPath = mutation.pathBefore
      ? Array.isArray(mutation.pathBefore)
        ? mutation.pathBefore
        : parsePath(mutation.pathBefore)
      : [];
    let moved = mutation.targetUniqueName ? extractByUniqueId(root, mutation.targetUniqueName) : undefined;
    if (moved === undefined && fromPath.length > 0) {
      try {
        const found = resolvePath(root, fromPath, { strict: false });
        if (moved === undefined) moved = found;
        deleteAtPath(root, fromPath, { strict: false });
      } catch {
        /* ignore */
      }
    }
    if (moved === undefined && mutation.targetUniqueName) {
      throw new XnlPathError(`TREE_MOVE could not find node '${mutation.targetUniqueName}' to move`);
    }
    return applySingle(root, { ...mutation, type: "TREE_ADD", path, valueAfter: moved }, opts);
  }

  switch (type) {
    case "TREE_ADD":
      setPathValue(root, pathItems, valueAfter, { mode: "insert" });
      return root;
    case "TREE_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    case "TREE_UPDATE":
      setPathValue(root, pathItems, valueAfter, { mode: "replace" });
      return root;
    case "OBJECT_ADD":
    case "OBJECT_UPDATE":
      setPathValue(root, pathItems, valueAfter, { mode: "replace" });
      return root;
    case "OBJECT_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    default:
      throw new XnlPathError(`Unknown mutation type ${type}`);
  }
}

function diffTextElement(
  oldNode: TextElementNode,
  newNode: TextElementNode,
  basePath: XnlPath,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, [...basePath, ip("metadata")], oldNode, newNode, opts));
  if (oldNode.attributes || newNode.attributes) {
    mutations.push(...diffMap(oldNode.attributes ?? {}, newNode.attributes ?? {}, [...basePath, ip("attributes")], oldNode, newNode, opts));
  }
  if (oldNode.text !== newNode.text) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("text")],
      valueAfter: newNode.text,
    });
  }
  if (oldNode.textMarker !== newNode.textMarker) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("textMarker")],
      valueAfter: newNode.textMarker,
    });
  }
  return mutations;
}

function diffDataElement(
  oldNode: DataElementNode,
  newNode: DataElementNode,
  basePath: XnlPath,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  const metaPath = [...basePath, ip("metadata")];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, metaPath, oldNode, newNode, opts));
  const attrPath = [...basePath, ip("attributes")];
  mutations.push(...diffMap(oldNode.attributes ?? {}, newNode.attributes ?? {}, attrPath, oldNode, newNode, opts));

  if (oldNode.body || newNode.body) {
    mutations.push(
      ...diffArray(oldNode.body ?? [], newNode.body ?? [], [...basePath, ip("body")], oldNode, newNode, opts)
    );
  }
  if (oldNode.extend || newNode.extend) {
    mutations.push(...diffExtend(oldNode.extend, newNode.extend, [...basePath, ip("extend")], oldNode, newNode, opts));
  }
  return mutations;
}

function diffArray(
  oldArr: XnlNode[],
  newArr: XnlNode[],
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];

  const parentId =
    resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : undefined;

  const pathBase = parentId ? [ms("id", parentId) as PathItem, ip("body")] : basePath;
  const oldById: Record<string, { index: number; value: XnlNode }> = {};
  const newById: Record<string, { index: number; value: XnlNode }> = {};
  oldArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) oldById[id] = { index: idx, value: item };
  });
  newArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) newById[id] = { index: idx, value: item };
  });

  const max = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < max; i++) {
    const oldItem = oldArr[i];
    const newItem = newArr[i];
    const path = [...pathBase, li(i)];
    if (oldItem === undefined && newItem !== undefined) {
      const id = readIdOrMetadaataId(newItem);
      mutations.push({
        type: "TREE_ADD",
        path,
        valueAfter: newItem,
        targetUniqueName: id,
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      continue;
    }
    if (oldItem !== undefined && newItem === undefined) {
      const id = readIdOrMetadaataId(oldItem);
      mutations.push({
        type: "TREE_DELETE",
        path,
        valueBefore: oldItem,
        targetUniqueName: id,
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
      });
      continue;
    }
    if (oldItem !== undefined && newItem !== undefined) {
      const useIdentity = resolveMetaIdMode(opts) === "identity";

      const oldId = readIdOrMetadaataId(oldItem);
      const newId = readIdOrMetadaataId(newItem);

      if (useIdentity && oldId && newId && oldId !== newId) {
        mutations.push({
          type: "TREE_DELETE",
          path,
          valueBefore: oldItem,
          targetUniqueName: oldId,
          parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
        });
        mutations.push({
          type: "TREE_ADD",
          path,
          valueAfter: newItem,
          targetUniqueName: newId,
          parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
        });
        continue;
      }

      if (isEqual(oldItem, newItem)) {
        continue;
      }

      const nested = diffNodes(oldItem, newItem, path, opts);
      if (nested.length === 0) {
        if (!useIdentity) {
          mutations.push({ type: "TREE_UPDATE", path, valueAfter: newItem, targetUniqueName: readIdOrMetadaataId(newItem) });
        }
      } else {
        mutations.push(...nested);
      }
    }
  }

  if (resolveMetaIdMode(opts) === "identity") {
    const oldIds = oldArr.map(readIdOrMetadaataId).filter(Boolean) as string[];
    const newIds = newArr.map(readIdOrMetadaataId).filter(Boolean) as string[];
    if (oldIds.length && newIds.length) {
      for (const id of oldIds) {
        if (!(id in newById)) continue;
        const oldIdx = oldById[id]?.index ?? -1;
        const newIdx = newById[id]?.index ?? -1;
        if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
          mutations.push({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: [...pathBase, li(oldIdx)],
            path: [...pathBase, li(newIdx)],
            targetUniqueName: id,
            parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
            parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
          });
        }
      }
    }
  }
  return mutations;
}

function diffMap(
  oldMap: Record<string, any>,
  newMap: Record<string, any>,
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  const keys = new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
  for (const key of keys) {
    if (resolveMetaIdMode(opts) === "identity" && isMetadataMapPath(basePath) && key === "id") {
      continue;
    }
    const oldVal = (oldMap || {})[key];
    const newVal = (newMap || {})[key];
    const path = [...basePath, mk(key)];
    if (oldVal === undefined && newVal !== undefined) {
      mutations.push({
        type: "OBJECT_ADD",
        path,
        valueAfter: newVal,
        targetUniqueName: readIdOrMetadaataId(newVal),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      continue;
    }
    if (oldVal !== undefined && newVal === undefined) {
      mutations.push({
        type: "OBJECT_DELETE",
        path,
        valueBefore: oldVal,
        targetUniqueName: readIdOrMetadaataId(oldVal),
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
      });
      continue;
    }
    if (!isEqual(oldVal, newVal)) {
      const nested = diffNodes(oldVal, newVal, path, opts);
      if (nested.length === 0) {
        mutations.push({ type: "OBJECT_UPDATE", path, valueAfter: newVal });
      } else {
        mutations.push(...nested);
      }
    }
  }
  return mutations;
}

function diffExtend(
  oldExtend: DataElementNode["extend"] | undefined,
  newExtend: DataElementNode["extend"] | undefined,
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];

  const parentId =
    resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : undefined;

  const pathBase = parentId ? [ms("id", parentId) as PathItem, ip("extend")] : basePath;
  const oldChildren = oldExtend?.children ?? {};
  const newChildren = newExtend?.children ?? {};
  const allTags = new Set([...Object.keys(oldChildren), ...Object.keys(newChildren)]);
  for (const tag of allTags) {
    const oldChild = oldChildren[tag];
    const newChild = newChildren[tag];
    const childPath = [...pathBase, mk(tag)];
    if (!oldChild && newChild) {
      mutations.push({
        type: "TREE_ADD",
        path: childPath,
        valueAfter: newChild,
        targetUniqueName: readIdOrMetadaataId(newChild),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      continue;
    }
    if (oldChild && !newChild) {
      mutations.push({
        type: "TREE_DELETE",
        path: childPath,
        valueBefore: oldChild,
        targetUniqueName: readIdOrMetadaataId(oldChild),
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
      });
      continue;
    }
    if (oldChild && newChild) {
      const nested = diffNodes(oldChild, newChild, childPath, opts);
      if (nested.length === 0) {
        if (!isEqual(oldChild, newChild)) {
          mutations.push({ type: "TREE_UPDATE", path: childPath, valueAfter: newChild });
        }
      } else {
        mutations.push(...nested);
      }
    }
  }

  const oldOrder = oldExtend?.order ?? [];
  const newOrder = newExtend?.order ?? [];
  if (!isEqual(oldOrder, newOrder)) {
    mutations.push({
      type: "TREE_UPDATE",
      path: [...basePath, ip("order")],
      valueAfter: newOrder,
    });
  }
  return mutations;
}

function sameKind(a: XnlNode, b: XnlNode): boolean {
  if (isDataElement(a) && isDataElement(b)) return true;
  if (isTextElement(a) && isTextElement(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject(a) && isPlainObject(b)) return true;
  if (isValueLiteral(a) && isValueLiteral(b)) return true;
  return typeof a === typeof b;
}

function isEqual(a: any, b: any): boolean {
  if (isWord(a) && isWord(b)) {
    return wordToString(a) === wordToString(b);
  }
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => isEqual(item, b[idx]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => isEqual(a[key], (b as any)[key]));
  }
  return false;
}

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement(value) && !isTextElement(value) && !isWord(value);
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement";
}

function isTextElement(node: any): node is TextElementNode {
  return node && node.kind === "TextElement";
}

function isValueLiteral(node: any): boolean {
  return (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean" ||
    node === null ||
    isWord(node)
  );
}

function isComment(node: any): boolean {
  return node && node.kind === "Comment";
}

const ip = (value: string): PathItem => ({ type: "InstanceProperty", value });
const mk = (value: string): PathItem => ({ type: "MapKey", value });
const li = (value: number | string): PathItem => ({ type: "ListIndex", value: String(value) });

function ms(key: string, value: string): PathItem {
  return { type: "MetadataSelector", value: `<${key}=${JSON.stringify(value)}>` } as PathItem;
}

function readIdOrMetadaataId(node: any): string | undefined {
  if (isDataElement(node) || isTextElement(node)) {
    const nodeId = wordToString((node as any).id);
    if (nodeId) return nodeId;

    const metaId = (node as any).metadata?.id;
    if (typeof metaId === "string") return metaId;
    if (isWord(metaId)) return wordToString(metaId);
  }
  return undefined;
}

function extractByUniqueId(root: any, id: string): any {
  if (Array.isArray(root)) {
    const idx = root.findIndex((item) => readIdOrMetadaataId(item) === id);
    if (idx !== -1) {
      const [removed] = root.splice(idx, 1);
      return removed;
    }
    for (const item of root) {
      const found = extractByUniqueId(item, id);
      if (found !== undefined) return found;
    }
  } else if (isDataElement(root)) {
    if (root.body) {
      const idx = root.body.findIndex((item) => readIdOrMetadaataId(item) === id);
      if (idx !== -1) {
        const [removed] = root.body.splice(idx, 1);
        return removed;
      }
      for (const child of root.body) {
        const found = extractByUniqueId(child, id);
        if (found !== undefined) return found;
      }
    }
    if (root.extend) {
      const tags = [...root.extend.order];
      for (const tag of tags) {
        const child = root.extend.children[tag];
        if (readIdOrMetadaataId(child) === id) {
          delete root.extend.children[tag];
          root.extend.order = root.extend.order.filter((t) => t !== tag);
          return child;
        }
        const found = extractByUniqueId(child, id);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

function reconcileMoves(mutations: XnlMutation[]): XnlMutation[] {
  const addsById: Record<string, XnlMutation[]> = {};
  const deletesById: Record<string, XnlMutation[]> = {};
  for (const m of mutations) {
    if (m.type === "TREE_ADD" && m.targetUniqueName) {
      addsById[m.targetUniqueName] = addsById[m.targetUniqueName] ?? [];
      addsById[m.targetUniqueName].push(m);
    }
    if (m.type === "TREE_DELETE" && m.targetUniqueName) {
      deletesById[m.targetUniqueName] = deletesById[m.targetUniqueName] ?? [];
      deletesById[m.targetUniqueName].push(m);
    }
  }

  const result: XnlMutation[] = [];
  const usedAdds = new Set<XnlMutation>();
  const usedDeletes = new Set<XnlMutation>();

  for (const [id, dels] of Object.entries(deletesById)) {
    const adds = addsById[id];
    if (!adds || adds.length === 0) continue;
    const del = dels[0];
    const add = adds[0];
    usedAdds.add(add);
    usedDeletes.add(del);
    const sameParent = add.parentUniqueNameAfter && del.parentUniqueNameBefore && add.parentUniqueNameAfter === del.parentUniqueNameBefore;
    const type: MutationType = sameParent ? "TREE_MOVE_SAME_LEVEL" : "TREE_MOVE_CROSS_LEVEL";
    const move: XnlMutation = {
      type,
      path: add.path,
      pathBefore: del.path,
      targetUniqueName: id,
      parentUniqueNameBefore: del.parentUniqueNameBefore,
      parentUniqueNameAfter: add.parentUniqueNameAfter,
    };
    result.push(move);
  }

  for (const m of mutations) {
    if (usedAdds.has(m) || usedDeletes.has(m)) continue;
    result.push(m);
  }

  const filtered: XnlMutation[] = [];
  const seenMoveKeys = new Set<string>();
  for (const m of result) {
    if ((m.type === "TREE_MOVE_SAME_LEVEL" || m.type === "TREE_MOVE_CROSS_LEVEL") && m.targetUniqueName) {
      const key = `${m.type}:${m.targetUniqueName}:${JSON.stringify(m.path)}:${JSON.stringify(m.pathBefore)}`;
      if (seenMoveKeys.has(key)) continue;
      seenMoveKeys.add(key);
    }
    filtered.push(m);
  }

  return filtered;
}
