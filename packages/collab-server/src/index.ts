import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePath } from "xnl-core";
import type { DataElementNode, PathItem, TextElementNode, XnlMutation, XnlNode } from "xnl-core";
import { applyIntent, canonicalizeText, makeId, mergeDocuments3 } from "xnl-collab-core";
import {
  isClientToServerMessage,
  jsonParseMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type VersionId,
  type VersionKind,
  type VersionSummary,
} from "xnl-collab-protocol";

export type RealtimeClientIdentity = {
  clientId: string;
  docId: string;
};

export type VersionNode = {
  id: VersionId;
  kind: VersionKind;
  parents: VersionId[];
  ts: string;
  clientId?: string;
  opId?: string;
  mutations?: XnlMutation[];
  text: string;
  nodes: XnlNode[];
};

export type DocState = {
  docId: string;
  headVersionId: VersionId;
  versions: Map<VersionId, VersionNode>;
  leaves: Set<VersionId>;
  rootTag?: string;
};

export type CollabServerOptions = {
  dataDir: string;
};

export type WebSocketConnection<TData = unknown> = {
  data: TData;
  send(data: string): void;
};

export type ConnectionData = {
  client: RealtimeClientIdentity | null;
};

export type MessageHandlerResult = {
  reply: ServerToClientMessage[];
  broadcast: Array<{ docId: string; message: ServerToClientMessage }>;
};

function sanitizeMutations(mutations: XnlMutation[]): XnlMutation[] {
  const out: XnlMutation[] = mutations.slice();

  const groups = new Map<string, Array<{ pos: number; idx: number; mutation: XnlMutation }>>();

  for (let pos = 0; pos < out.length; pos++) {
    const m = out[pos];
    if (m.type !== "TREE_DELETE") continue;

    const pathItems = Array.isArray(m.path) ? (m.path as PathItem[]) : (parsePath(m.path) as PathItem[]);
    if (pathItems.length === 0) continue;

    const last = pathItems[pathItems.length - 1];
    if (!last || last.type !== "ListIndex") continue;

    const idx = Number(last.value);
    if (!Number.isFinite(idx)) continue;

    const parentKey = JSON.stringify(pathItems.slice(0, -1));
    const arr = groups.get(parentKey) ?? [];
    arr.push({ pos, idx, mutation: m });
    groups.set(parentKey, arr);
  }

  for (const arr of groups.values()) {
    if (arr.length <= 1) continue;

    const positions = arr
      .slice()
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.pos);

    const sortedDeletes = arr.slice().sort((a, b) => b.idx - a.idx);

    for (let i = 0; i < positions.length; i++) {
      out[positions[i]] = sortedDeletes[i].mutation;
    }
  }

  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summaryOf(v: VersionNode): VersionSummary {
  const out: VersionSummary = {
    id: v.id,
    parents: [...v.parents],
    kind: v.kind,
    ts: v.ts,
  };
  if (v.clientId) out.clientId = v.clientId;
  if (v.opId) out.opId = v.opId;
  if (v.mutations) out.mutations = v.mutations;
  return out;
}

function computeHeadText(doc: DocState): string {
  const head = doc.versions.get(doc.headVersionId);
  return head ? head.text : "";
}

function isDataElement(node: unknown): node is DataElementNode {
  return node !== null && typeof node === "object" && (node as Record<string, unknown>)["kind"] === "DataElement";
}

function isTextElement(node: unknown): node is TextElementNode {
  return node !== null && typeof node === "object" && (node as Record<string, unknown>)["kind"] === "TextElement";
}

function readRootTagFromNodes(nodes: XnlNode[]): string | undefined {
  const n = nodes[0];
  if (!n) return undefined;
  if (!isDataElement(n) && !isTextElement(n)) return undefined;
  return n.tag;
}

function applyRootTagLock(doc: DocState, nodes: XnlNode[]): boolean {
  const tag = readRootTagFromNodes(nodes);

  if (doc.rootTag) {
    return typeof tag === "string" && tag === doc.rootTag;
  }

  if (tag) doc.rootTag = tag;
  return true;
}

function rootNodeRequired(doc: DocState, nodes: XnlNode[]): boolean {
  if (!doc.rootTag) return true;
  return nodes.length === 1;
}

function recomputeLeaves(doc: DocState) {
  const maybeLeaves = new Set<VersionId>(doc.versions.keys());
  for (const v of doc.versions.values()) {
    for (const p of v.parents) maybeLeaves.delete(p);
  }
  doc.leaves = maybeLeaves;
}

function computeDistancesFrom(doc: DocState, start: VersionId): Map<VersionId, number> {
  const dist = new Map<VersionId, number>();
  const queue: Array<{ id: VersionId; d: number }> = [{ id: start, d: 0 }];
  while (queue.length) {
    const { id, d } = queue.shift() as { id: VersionId; d: number };
    const prev = dist.get(id);
    if (prev !== undefined && prev <= d) continue;
    dist.set(id, d);

    const v = doc.versions.get(id);
    if (!v) continue;
    for (const p of v.parents) {
      queue.push({ id: p, d: d + 1 });
    }
  }
  return dist;
}

function findLca(doc: DocState, a: VersionId, b: VersionId): VersionId | null {
  const da = computeDistancesFrom(doc, a);
  const db = computeDistancesFrom(doc, b);

  let best: { id: VersionId; score: number } | null = null;

  for (const [id, distA] of da.entries()) {
    const distB = db.get(id);
    if (distB === undefined) continue;
    const score = Math.max(distA, distB);
    if (!best || score < best.score || (score === best.score && id < best.id)) {
      best = { id, score };
    }
  }

  return best ? best.id : null;
}

function docFilePath(dataDir: string, docId: string): string {
  return join(dataDir, `${encodeURIComponent(docId)}.json`);
}

function createRootDoc(docId: string): DocState {
  const rootId: VersionId = makeId("root_");
  const rootCanonical = canonicalizeText("", "r_");

  const root: VersionNode = {
    id: rootId,
    kind: "root",
    parents: [],
    ts: nowIso(),
    text: rootCanonical.text,
    nodes: rootCanonical.nodes,
  };

  const versions = new Map<VersionId, VersionNode>();
  versions.set(rootId, root);

  return {
    docId,
    headVersionId: rootId,
    versions,
    leaves: new Set([rootId]),
    rootTag: undefined,
  };
}

function loadDocFromDisk(dataDir: string, docId: string): DocState | null {
  try {
    const fp = docFilePath(dataDir, docId);
    if (!existsSync(fp)) return null;

    const raw = readFileSync(fp, "utf8");
    const data = JSON.parse(raw) as {
      docId: string;
      headVersionId: VersionId;
      rootTag?: string;
      versions: Array<{
        id: VersionId;
        kind: VersionKind;
        parents: VersionId[];
        ts: string;
        clientId?: string;
        opId?: string;
        mutations?: XnlMutation[];
        text: string;
      }>;
    };

    const hasLegacyIds =
      typeof data.headVersionId === "string" &&
      (data.headVersionId.includes(":") || data.versions.some((v) => typeof v.id === "string" && v.id.includes(":")));

    if (hasLegacyIds) {
      const reset = createRootDoc(docId);
      saveDocToDisk(dataDir, reset);
      return reset;
    }

    const versions = new Map<VersionId, VersionNode>();
    for (const v of data.versions) {
      const canonical = canonicalizeText(v.text, "p_");
      versions.set(v.id, {
        id: v.id,
        kind: v.kind,
        parents: v.parents,
        ts: v.ts,
        clientId: v.clientId,
        opId: v.opId,
        mutations: v.mutations,
        text: canonical.text,
        nodes: canonical.nodes,
      });
    }

    const doc: DocState = {
      docId: data.docId,
      headVersionId: data.headVersionId,
      versions,
      leaves: new Set(),
      rootTag: typeof data.rootTag === "string" ? data.rootTag : undefined,
    };

    recomputeLeaves(doc);

    if (!doc.versions.has(doc.headVersionId)) {
      return createRootDoc(docId);
    }

    if (!doc.rootTag) {
      const head = doc.versions.get(doc.headVersionId);
      if (head) applyRootTagLock(doc, head.nodes);
    }

    return doc;
  } catch {
    return null;
  }
}

function saveDocToDisk(dataDir: string, doc: DocState): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const versions = Array.from(doc.versions.values()).map((v) => ({
    id: v.id,
    kind: v.kind,
    parents: v.parents,
    ts: v.ts,
    clientId: v.clientId,
    opId: v.opId,
    mutations: v.mutations,
    text: v.text,
  }));

  const payload = {
    docId: doc.docId,
    headVersionId: doc.headVersionId,
    rootTag: doc.rootTag,
    versions,
  };

  const fp = docFilePath(dataDir, doc.docId);
  writeFileSync(fp, JSON.stringify(payload, null, 2), "utf8");
}

function maybeMerge(doc: DocState, dataDir: string): VersionNode[] {
  if (doc.leaves.size <= 1) return [];

  const leaves = Array.from(doc.leaves).sort((a, b) => {
    const va = doc.versions.get(a);
    const vb = doc.versions.get(b);

    const ta = Date.parse(va?.ts ?? "");
    const tb = Date.parse(vb?.ts ?? "");

    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
      return ta - tb;
    }

    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  let head = doc.headVersionId;
  let workingLeaves = leaves;

  const created: VersionNode[] = [];

  while (workingLeaves.length > 1) {
    const leftId = workingLeaves[0];
    const rightId = workingLeaves[1];

    const baseId = findLca(doc, leftId, rightId);
    const base = baseId ? doc.versions.get(baseId) : undefined;
    const left = doc.versions.get(leftId);
    const right = doc.versions.get(rightId);

    if (!left || !right) return [];

    const baseText = base?.text ?? "";
    const merged = mergeDocuments3(baseText, left.text, right.text);
    const canonical = canonicalizeText(merged.text, "m_");

    const mergeNode: VersionNode = {
      id: makeId("merge_"),
      kind: "merge",
      parents: [leftId, rightId],
      ts: nowIso(),
      text: canonical.text,
      nodes: canonical.nodes,
    };

    if (!applyRootTagLock(doc, mergeNode.nodes)) return [];
    if (!rootNodeRequired(doc, mergeNode.nodes)) return [];

    doc.versions.set(mergeNode.id, mergeNode);
    created.push(mergeNode);

    workingLeaves = [mergeNode.id, ...workingLeaves.slice(2)];
    head = mergeNode.id;
  }

  doc.headVersionId = head;
  recomputeLeaves(doc);

  if (created.length > 0) {
    saveDocToDisk(dataDir, doc);
  }

  return created;
}

export function messageToString(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") return message;
  if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
  return new TextDecoder().decode(message);
}

export type CollabServer = {
  handleOpen(): ConnectionData;
  handleClose(data: ConnectionData): void;
  handleMessage(data: ConnectionData, message: string | ArrayBuffer | Uint8Array): MessageHandlerResult;
  getVersionText(docId: string, versionId: VersionId): string | null;
  registerConnection(docId: string, connectionId: string): void;
  unregisterConnection(docId: string, connectionId: string): void;
  getConnectionsForDoc(docId: string): Set<string>;
};

export function createCollabServer(opts: CollabServerOptions): CollabServer {
  const docs = new Map<string, DocState>();
  const connsByDocId = new Map<string, Set<string>>();

  const getOrCreateDoc = (docId: string): DocState => {
    const existing = docs.get(docId);
    if (existing) return existing;

    const loaded = loadDocFromDisk(opts.dataDir, docId);
    const created = loaded ?? createRootDoc(docId);

    docs.set(docId, created);
    return created;
  };

  const handleOpen = (): ConnectionData => {
    return { client: null };
  };

  const handleClose = (_data: ConnectionData): void => {
  };

  const handleMessage = (
    data: ConnectionData,
    message: string | ArrayBuffer | Uint8Array
  ): MessageHandlerResult => {
    const result: MessageHandlerResult = { reply: [], broadcast: [] };

    const rawText = messageToString(message);
    const parsed = jsonParseMessage<unknown>(rawText);
    if (!parsed || !isClientToServerMessage(parsed)) {
      result.reply.push({ type: "error", message: "Invalid message" });
      return result;
    }

    const msg: ClientToServerMessage = parsed;

    if (msg.type === "connect") {
      data.client = { docId: msg.docId, clientId: msg.clientId };

      const doc = getOrCreateDoc(msg.docId);

      result.reply.push({
        type: "doc_state",
        docId: doc.docId,
        headVersionId: doc.headVersionId,
        headText: computeHeadText(doc),
        versions: Array.from(doc.versions.values()).map(summaryOf),
      });

      return result;
    }

    const ident = data.client;
    if (!ident) {
      result.reply.push({ type: "error", message: "Must connect first" });
      return result;
    }

    if (ident.docId !== msg.docId || ident.clientId !== msg.clientId) {
      result.reply.push({ type: "error", docId: msg.docId, message: "Client identity mismatch" });
      return result;
    }

    const doc = getOrCreateDoc(msg.docId);

    if (msg.type === "op") {
      const base = doc.versions.get(msg.baseVersionId);
      if (!base) {
        result.reply.push({
          type: "resync",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          reason: "unknown_base",
        });
        return result;
      }

      try {
        const sanitizedMutations = sanitizeMutations(msg.mutations);
        const next = applyIntent(base.text, sanitizedMutations);

        if (!applyRootTagLock(doc, next.nodes) || !rootNodeRequired(doc, next.nodes)) {
          result.reply.push({
            type: "resync",
            docId: doc.docId,
            headVersionId: doc.headVersionId,
            headText: computeHeadText(doc),
            reason: "apply_failed",
          });
          return result;
        }

        const opVersionId = makeId("op_");

        const opNode: VersionNode = {
          id: opVersionId,
          kind: "op",
          parents: [base.id],
          ts: nowIso(),
          clientId: msg.clientId,
          opId: msg.opId,
          mutations: sanitizedMutations,
          text: next.text,
          nodes: next.nodes,
        };

        doc.versions.set(opNode.id, opNode);
        doc.headVersionId = opNode.id;
        recomputeLeaves(doc);

        saveDocToDisk(opts.dataDir, doc);

        const added: VersionNode[] = [opNode];

        const merges = maybeMerge(doc, opts.dataDir);
        if (merges.length) {
          added.push(...merges);
        }

        result.broadcast.push({
          docId: doc.docId,
          message: {
            type: "graph_update",
            docId: doc.docId,
            headVersionId: doc.headVersionId,
            headText: computeHeadText(doc),
            added: added.map(summaryOf),
          },
        });

        result.reply.push({
          type: "ack",
          docId: doc.docId,
          clientId: msg.clientId,
          opId: msg.opId,
          opVersionId: opNode.id,
          headVersionId: doc.headVersionId,
          status: merges.length ? "merged" : "integrated",
        });
      } catch {
        result.reply.push({
          type: "resync",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          reason: "apply_failed",
        });
      }

      return result;
    }

    if (msg.type === "pull") {
      const base = doc.versions.get(msg.baseVersionId);
      const other = doc.versions.get(msg.otherVersionId);
      if (!base || !other) {
        result.reply.push({
          type: "resync",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          reason: "unknown_base",
        });
        return result;
      }

      const merged = mergeDocuments3(base.text, base.text, other.text);
      const canonical = canonicalizeText(merged.text, "p_");

      if (!applyRootTagLock(doc, canonical.nodes) || !rootNodeRequired(doc, canonical.nodes)) {
        result.reply.push({
          type: "resync",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          reason: "apply_failed",
        });
        return result;
      }

      const opNode: VersionNode = {
        id: makeId("pull_"),
        kind: "op",
        parents: [base.id],
        ts: nowIso(),
        clientId: msg.clientId,
        opId: msg.opId,
        mutations: [],
        text: canonical.text,
        nodes: canonical.nodes,
      };

      doc.versions.set(opNode.id, opNode);
      doc.headVersionId = opNode.id;
      recomputeLeaves(doc);

      saveDocToDisk(opts.dataDir, doc);

      result.broadcast.push({
        docId: doc.docId,
        message: {
          type: "graph_update",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          added: [summaryOf(opNode)],
        },
      });

      result.reply.push({
        type: "ack",
        docId: doc.docId,
        clientId: msg.clientId,
        opId: msg.opId,
        opVersionId: opNode.id,
        headVersionId: doc.headVersionId,
        status: "integrated",
      });

      return result;
    }

    return result;
  };

  const getVersionText = (docId: string, versionId: VersionId): string | null => {
    const doc = getOrCreateDoc(docId);
    const v = doc.versions.get(versionId);
    return v ? v.text : null;
  };

  const registerConnection = (docId: string, connectionId: string): void => {
    const set = connsByDocId.get(docId) ?? new Set<string>();
    set.add(connectionId);
    connsByDocId.set(docId, set);
  };

  const unregisterConnection = (docId: string, connectionId: string): void => {
    const set = connsByDocId.get(docId);
    if (!set) return;
    set.delete(connectionId);
    if (set.size === 0) connsByDocId.delete(docId);
  };

  const getConnectionsForDoc = (docId: string): Set<string> => {
    return connsByDocId.get(docId) ?? new Set();
  };

  return {
    handleOpen,
    handleClose,
    handleMessage,
    getVersionText,
    registerConnection,
    unregisterConnection,
    getConnectionsForDoc,
  };
}

export { jsonStringifyMessage } from "xnl-collab-protocol";
export type { ServerToClientMessage, VersionId } from "xnl-collab-protocol";
