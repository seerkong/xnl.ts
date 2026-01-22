import {
  parseXnl,
  XNL,
  isWord,
  type AttributeMap,
  type DataElementNode,
  type ExtendBody,
  type TextElementNode,
  type XnlDocument,
  type XnlNode,
  type XnlMutation,
  type XnlWord,
  wordToString,
} from "../node_modules/xnl.ts/dist/index.js";
import { diffChars } from "diff";
import { makeId } from "./id";

export type MergeResult = {
  text: string;
  nodes: XnlNode[];
};

type Winner = "left" | "right";

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (value as any).kind === undefined;
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement";
}

function isTextElement(node: any): node is TextElementNode {
  return node && node.kind === "TextElement";
}

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function readNodeId(node: any): string | undefined {
  if (!isDataElement(node) && !isTextElement(node)) return undefined;
  return wordToString(node.id as XnlWord | undefined);
}

function readMetaId(node: any): string | undefined {
  if (!isDataElement(node) && !isTextElement(node)) return undefined;
  const raw = (node as any).metadata?.id;
  if (typeof raw === "string") return raw;
  if (isWord(raw)) return wordToString(raw) ?? undefined;
  return undefined;
}

function readStableId(node: any): string | undefined {
  return readMetaId(node) ?? readNodeId(node);
}

function setMetaId(node: any, id: string) {
  if (!isDataElement(node) && !isTextElement(node)) return;
  if (!node.metadata || typeof node.metadata !== "object" || Array.isArray(node.metadata)) {
    node.metadata = {};
  }
  node.metadata.id = id;
}

function makeMetaId(prefix: string): string {
  return makeId(prefix);
}

export function ensureMetadataIds(root: XnlNode | XnlDocument, prefix: string): void {
  const visit = (node: any) => {
    if (isDataElement(node) || isTextElement(node)) {
      const existing = readMetaId(node);
      if (!existing) {
        setMetaId(node, makeMetaId(prefix));
      } else if ((node as any).metadata?.id && typeof (node as any).metadata.id !== "string") {
        setMetaId(node, existing);
      }

      if (isDataElement(node)) {
        if (node.body) for (const child of node.body) visit(child);
        if (node.extend) {
          for (const tag of node.extend.order) {
            const child = node.extend.children[tag];
            if (child) visit(child);
          }
        }
        if (node.attributes) {
          for (const v of Object.values(node.attributes)) visit(v);
        }
        for (const v of Object.values(node.metadata ?? {})) visit(v);
      } else {
        if (node.attributes) {
          for (const v of Object.values(node.attributes)) visit(v);
        }
        for (const v of Object.values(node.metadata ?? {})) visit(v);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }

    if (isPlainObject(node)) {
      for (const key of Object.keys(node)) visit((node as any)[key]);
    }
  };

  if ((root as any).nodes && Array.isArray((root as any).nodes)) {
    for (const n of (root as any).nodes) visit(n);
  } else {
    visit(root);
  }
}

function winnerForKey(_key: string): Winner {
  return "right";
}

function mergePrimitive(base: any, left: any, right: any, key: string): any {
  if (left === right) return left;
  if (left === base) return right;
  if (right === base) return left;
  return winnerForKey(key) === "right" ? right : left;
}

type Edit = { start: number; end: number; text: string };

function normalizeEdits(edits: Edit[]): Edit[] {
  const sorted = edits
    .slice()
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  const out: Edit[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(e);
      continue;
    }

    if (prev.end === e.start && prev.end === prev.start && e.start === e.end) {
      prev.text += e.text;
      continue;
    }

    if (prev.end === e.start && prev.text.length === 0 && e.text.length === 0) {
      prev.end = e.end;
      continue;
    }

    out.push(e);
  }

  return out;
}

function diffToEdits(base: string, other: string): Edit[] {
  const changes = diffChars(base, other);
  let basePos = 0;
  const edits: Edit[] = [];

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i] as { value: string; added?: boolean; removed?: boolean };

    if (c.removed) {
      const start = basePos;
      const end = basePos + c.value.length;
      basePos = end;

      let inserted = "";
      while (i + 1 < changes.length && (changes[i + 1] as any).added) {
        inserted += (changes[i + 1] as any).value;
        i++;
      }
      edits.push({ start, end, text: inserted });
      continue;
    }

    if (c.added) {
      edits.push({ start: basePos, end: basePos, text: c.value });
      continue;
    }

    basePos += c.value.length;
  }

  return normalizeEdits(edits);
}

function editsOverlap(a: Edit, b: Edit): boolean {
  const aIsIns = a.start === a.end;
  const bIsIns = b.start === b.end;

  if (aIsIns && bIsIns) {
    return a.start === b.start;
  }

  if (aIsIns && !bIsIns) {
    return b.start <= a.start && a.start <= b.end;
  }

  if (!aIsIns && bIsIns) {
    return a.start <= b.start && b.start <= a.end;
  }

  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

function hasOverlappingEdits(left: Edit[], right: Edit[]): boolean {
  let i = 0;
  let j = 0;

  const l = left.slice().sort((a, b) => a.start - b.start);
  const r = right.slice().sort((a, b) => a.start - b.start);

  while (i < l.length && j < r.length) {
    const le = l[i];
    const re = r[j];

    if (editsOverlap(le, re)) return true;

    const leEnd = le.end;
    const reEnd = re.end;

    if (leEnd < re.start || (le.end === le.start && le.start < re.start)) {
      i++;
      continue;
    }
    if (reEnd < le.start || (re.end === re.start && re.start < le.start)) {
      j++;
      continue;
    }

    if (le.start <= re.start) i++;
    else j++;
  }

  return false;
}

function applyEdits(base: string, edits: Edit[]): string {
  const sorted = edits
    .slice()
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  let out = "";
  let cursor = 0;

  for (const e of sorted) {
    out += base.slice(cursor, e.start);
    out += e.text;
    cursor = e.end;
  }

  out += base.slice(cursor);
  return out;
}

function mergeText3(base: string, left: string, right: string): string {
  if (left === right) return left;
  if (left === base) return right;
  if (right === base) return left;

  const editsL = diffToEdits(base, left);
  const editsR = diffToEdits(base, right);

  if (hasOverlappingEdits(editsL, editsR)) {
    return winnerForKey("text") === "right" ? right : left;
  }

  return applyEdits(base, [...editsL, ...editsR]);
}

function mergePlainObject(base: Record<string, any>, left: Record<string, any>, right: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const keys = new Set<string>([...Object.keys(base || {}), ...Object.keys(left || {}), ...Object.keys(right || {})]);

  for (const key of keys) {
    const b = (base || {})[key];
    const l = (left || {})[key];
    const r = (right || {})[key];

    if (l === undefined && r === undefined) continue;

    out[key] = mergeAny(b, l, r, key);
  }

  return out;
}

function stableUnique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mergeIdOrder(baseIds: string[], leftIds: string[], rightIds: string[]): string[] {
  const present = new Set<string>([...leftIds, ...rightIds]);
  const nodes = Array.from(present);

  const edges = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();

  for (const id of nodes) {
    edges.set(id, new Set());
    indeg.set(id, 0);
  }

  const addEdge = (from: string, to: string) => {
    if (!present.has(from) || !present.has(to)) return;
    if (from === to) return;
    const s = edges.get(from) as Set<string>;
    if (s.has(to)) return;
    s.add(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  };

  const addEdgesFromOrder = (order: string[]) => {
    for (let i = 0; i + 1 < order.length; i++) addEdge(order[i] as string, order[i + 1] as string);
  };

  addEdgesFromOrder(leftIds);
  addEdgesFromOrder(rightIds);

  const basePos = new Map<string, number>();
  baseIds.forEach((id, idx) => basePos.set(id, idx));
  const leftPos = new Map<string, number>();
  leftIds.forEach((id, idx) => leftPos.set(id, idx));
  const rightPos = new Map<string, number>();
  rightIds.forEach((id, idx) => rightPos.set(id, idx));

  const rank = (id: string): [number, number, number, string] => {
    return [basePos.get(id) ?? 1e9, leftPos.get(id) ?? 1e9, rightPos.get(id) ?? 1e9, id];
  };

  const compare = (a: string, b: string): number => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  };

  const zeros: string[] = nodes.filter((id) => (indeg.get(id) ?? 0) === 0).sort(compare);
  const out: string[] = [];

  while (zeros.length) {
    const id = zeros.shift() as string;
    out.push(id);

    for (const to of edges.get(id) ?? []) {
      indeg.set(to, (indeg.get(to) ?? 0) - 1);
      if ((indeg.get(to) ?? 0) === 0) {
        zeros.push(to);
      }
    }

    zeros.sort(compare);
  }

  if (out.length !== nodes.length) {
    return stableUnique([...leftIds, ...rightIds]);
  }

  return out;
}

function mergeNodeList(base: XnlNode[], left: XnlNode[], right: XnlNode[]): XnlNode[] {
  const baseById = new Map<string, XnlNode>();
  const leftById = new Map<string, XnlNode>();
  const rightById = new Map<string, XnlNode>();

  const baseIds: string[] = [];
  const leftIds: string[] = [];
  const rightIds: string[] = [];

  const collect = (arr: XnlNode[], ids: string[], map: Map<string, XnlNode>) => {
    for (const n of arr) {
      const id = readStableId(n);
      if (!id) continue;
      ids.push(id);
      if (!map.has(id)) map.set(id, n);
    }
  };

  collect(base, baseIds, baseById);
  collect(left, leftIds, leftById);
  collect(right, rightIds, rightById);

  const order = mergeIdOrder(baseIds, leftIds, rightIds);

  const merged: XnlNode[] = [];

  for (const id of order) {
    const b = baseById.get(id);
    const l = leftById.get(id);
    const r = rightById.get(id);

    const m = mergeAny(b, l, r, "node");
    if (m !== undefined) merged.push(m);
  }

  const seenAnon = new Set<string>();
  const pushAnon = (n: XnlNode) => {
    const key = JSON.stringify(n);
    if (seenAnon.has(key)) return;
    seenAnon.add(key);
    merged.push(n);
  };

  for (const n of left) {
    if (readStableId(n)) continue;
    pushAnon(n);
  }
  for (const n of right) {
    if (readStableId(n)) continue;
    pushAnon(n);
  }

  return merged;
}

function mergeExtend(base: ExtendBody | undefined, left: ExtendBody | undefined, right: ExtendBody | undefined): ExtendBody | undefined {
  if (!base && !left && !right) return undefined;

  const b = base ?? { order: [], children: {} };
  const l = left ?? { order: [], children: {} };
  const r = right ?? { order: [], children: {} };

  const mergedChildren: Record<string, any> = {};
  const keys = new Set([...Object.keys(b.children), ...Object.keys(l.children), ...Object.keys(r.children)]);

  for (const k of keys) {
    const bv = b.children[k];
    const lv = l.children[k];
    const rv = r.children[k];

    if (lv === undefined && rv === undefined) continue;
    const merged = mergeAny(bv, lv, rv, k);
    if (merged !== undefined) mergedChildren[k] = merged;
  }

  const present = new Set(Object.keys(mergedChildren));
  const order = stableUnique([...l.order, ...r.order, ...b.order]).filter((t) => present.has(t));

  return { order, children: mergedChildren };
}

function mergeTextElement(base: TextElementNode, left: TextElementNode, right: TextElementNode): TextElementNode {
  const tag = mergePrimitive(base.tag, left.tag, right.tag, "tag");
  const id = mergePrimitive(base.id, left.id, right.id, "id");

  const metadata = mergePlainObject(base.metadata ?? {}, left.metadata ?? {}, right.metadata ?? {}) as AttributeMap;
  const attributes = mergePlainObject(base.attributes ?? {}, left.attributes ?? {}, right.attributes ?? {}) as AttributeMap;

  const baseText = base.text ?? "";
  const leftText = left.text ?? "";
  const rightText = right.text ?? "";
  const text = mergeText3(baseText, leftText, rightText);

  const baseMarker = base.textMarker ?? "";
  const leftMarker = left.textMarker ?? "";
  const rightMarker = right.textMarker ?? "";
  const textMarker = mergeText3(baseMarker, leftMarker, rightMarker);

  const out: TextElementNode = {
    kind: "TextElement",
    tag,
    id,
    metadata,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    text: text.length ? text : undefined,
    textMarker: textMarker.length ? textMarker : undefined,
  };

  const sid = readMetaId(left) ?? readMetaId(right) ?? readMetaId(base);
  if (sid) setMetaId(out, sid);

  return out;
}

function mergeDataElement(base: DataElementNode, left: DataElementNode, right: DataElementNode): DataElementNode {
  const tag = mergePrimitive(base.tag, left.tag, right.tag, "tag");
  const id = mergePrimitive(base.id, left.id, right.id, "id");

  const metadata = mergePlainObject(base.metadata ?? {}, left.metadata ?? {}, right.metadata ?? {}) as AttributeMap;
  const attributes = mergePlainObject(base.attributes ?? {}, left.attributes ?? {}, right.attributes ?? {}) as AttributeMap;

  const body = mergeNodeList(base.body ?? [], left.body ?? [], right.body ?? []);
  const extend = mergeExtend(base.extend, left.extend, right.extend);

  const out: DataElementNode = {
    kind: "DataElement",
    tag,
    id,
    metadata,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    body: body.length ? body : undefined,
    extend,
  };

  const sid = readMetaId(left) ?? readMetaId(right) ?? readMetaId(base);
  if (sid) setMetaId(out, sid);

  return out;
}

function mergeAny(base: any, left: any, right: any, key: string): any {
  if (left === undefined && right === undefined) return undefined;
  if (left === undefined) return right;
  if (right === undefined) return left;

  if (left === right) return left;

  if (base === undefined) {
    if (isDataElement(left) && isDataElement(right)) {
      return mergeDataElement(left, left, right);
    }
    if (isTextElement(left) && isTextElement(right)) {
      return mergeTextElement(left, left, right);
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      return mergeNodeList([], left, right);
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      return mergePlainObject({}, left, right);
    }
    return winnerForKey(key) === "right" ? right : left;
  }

  if (typeof base === "string" || typeof base === "number" || typeof base === "boolean" || base === null) {
    return mergePrimitive(base, left, right, key);
  }

  if (Array.isArray(base) && Array.isArray(left) && Array.isArray(right)) {
    return mergeNodeList(base, left, right);
  }

  if (isPlainObject(base) && isPlainObject(left) && isPlainObject(right)) {
    return mergePlainObject(base, left, right);
  }

  if (isTextElement(base) && isTextElement(left) && isTextElement(right)) {
    return mergeTextElement(base, left, right);
  }

  if (isDataElement(base) && isDataElement(left) && isDataElement(right)) {
    return mergeDataElement(base, left, right);
  }

  return mergePrimitive(base, left, right, key);
}

export function mergeDocuments3(baseText: string, leftText: string, rightText: string): MergeResult {
  const base = parseXnl(baseText);
  const left = parseXnl(leftText);
  const right = parseXnl(rightText);

  const mergedNodes = mergeNodeList(base.nodes, left.nodes, right.nodes);

  ensureMetadataIds({ nodes: mergedNodes }, "m_");

  const mergedText = XNL.stringify({ nodes: mergedNodes });
  const canonical = parseXnl(mergedText);
  const canonicalText = XNL.stringify(canonical);

  return { text: canonicalText, nodes: canonical.nodes };
}

export function canonicalizeText(text: string, prefix: string): MergeResult {
  const parsed = parseXnl(text);
  const nodes = cloneJson(parsed.nodes);
  ensureMetadataIds({ nodes }, prefix);

  const withIdsText = XNL.stringify({ nodes });
  const canonical = parseXnl(withIdsText);
  const canonicalText = XNL.stringify(canonical);

  return { text: canonicalText, nodes: canonical.nodes };
}

export function applyIntent(baseText: string, mutations: XnlMutation[]): MergeResult {
  const base = canonicalizeText(baseText, "s_");
  const root = cloneJson(base.nodes);

  const next = XNL.mutation.apply(root, mutations);
  if (!Array.isArray(next)) {
    throw new Error("Root must remain array");
  }

  ensureMetadataIds({ nodes: next }, "s_");

  const nextText = XNL.stringify({ nodes: next });
  const canonical = parseXnl(nextText);
  const canonicalText = XNL.stringify(canonical);

  return { text: canonicalText, nodes: canonical.nodes };
}

export function mergeExample(baseText: string, leftText: string, rightText: string): string {
  return mergeDocuments3(baseText, leftText, rightText).text;
}
