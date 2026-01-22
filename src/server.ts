import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parsePath } from "../node_modules/xnl.ts/dist/index.js";
import type { PathItem, XnlMutation, XnlNode } from "../node_modules/xnl.ts/dist/index.js";
import { makeId } from "./id";
import { applyIntent, canonicalizeText, mergeDocuments3 } from "./merge";
import type { ServerWebSocket } from "bun";

function sanitizeMutations(mutations: XnlMutation[]): XnlMutation[] {
  const out = mutations.map((m) => {
    if (m.type !== "OBJECT_DELETE") return m;

    const path = Array.isArray(m.path) ? (m.path as PathItem[]) : (parsePath(m.path) as PathItem[]);

    const looksLikeDeleteMetaId =
      path.length >= 3 &&
      path[path.length - 3]?.type === "InstanceProperty" &&
      path[path.length - 3]?.value === "metadata" &&
      path[path.length - 2]?.type === "MapKey" &&
      path[path.length - 2]?.value === "id";

    if (!looksLikeDeleteMetaId) return m;
    return { ...m, type: "OBJECT_UPDATE", valueAfter: m.valueBefore };
  });

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
    arr.push({ pos, idx, mutation: { ...m, path: pathItems } });
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
import {
  isClientToServerMessage,
  jsonParseMessage,
  jsonStringifyMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type VersionId,
  type VersionKind,
  type VersionSummary,
} from "./shared-protocol";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const DATA_DIR = join(import.meta.dir, "..", "data");

function docFilePath(docId: string): string {
  return join(DATA_DIR, `${encodeURIComponent(docId)}.json`);
}

type VersionNode = {
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

type DocState = {
  docId: string;
  headVersionId: VersionId;
  versions: Map<VersionId, VersionNode>;
  leaves: Set<VersionId>;
};

type ClientIdentity = {
  clientId: string;
  docId: string;
};

type WSData = {
  client: ClientIdentity | null;
};

const docs = new Map<string, DocState>();

function docTopic(docId: string): string {
  return `doc:${docId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeVersionId(prefix: string): VersionId {
  return makeId(`${prefix}_`);
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

  const doc: DocState = {
    docId,
    headVersionId: rootId,
    versions,
    leaves: new Set([rootId]),
  };

  return doc;
}

function loadDocFromDisk(docId: string): DocState | null {
  try {
    const fp = docFilePath(docId);
    if (!existsSync(fp)) return null;

    const raw = readFileSync(fp, "utf8");
    const data = JSON.parse(raw) as {
      docId: string;
      headVersionId: VersionId;
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
      saveDocToDisk(reset);
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
    };

    recomputeLeaves(doc);

    if (!doc.versions.has(doc.headVersionId)) {
      const root = createRootDoc(docId);
      return root;
    }

    return doc;
  } catch {
    return null;
  }
}

function saveDocToDisk(doc: DocState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

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
    versions,
  };

  const fp = docFilePath(doc.docId);
  writeFileSync(fp, JSON.stringify(payload, null, 2), "utf8");
}

function getOrCreateDoc(docId: string): DocState {
  const existing = docs.get(docId);
  if (existing) return existing;

  const loaded = loadDocFromDisk(docId);
  const created = loaded ?? createRootDoc(docId);

  docs.set(docId, created);
  return created;
}

function wsSend(ws: ServerWebSocket<WSData>, msg: ServerToClientMessage): void {
  ws.send(jsonStringifyMessage(msg));
}

function messageToString(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") return message;
  if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
  return new TextDecoder().decode(message);
}

function broadcastGraphUpdate(doc: DocState, added: VersionNode[]) {
  const msg: ServerToClientMessage = {
    type: "graph_update",
    docId: doc.docId,
    headVersionId: doc.headVersionId,
    headText: computeHeadText(doc),
    added: added.map(summaryOf),
  };

  server.publish(docTopic(doc.docId), jsonStringifyMessage(msg));
}

function maybeMerge(doc: DocState): VersionNode[] {
  if (doc.leaves.size <= 1) return [];

  const leaves = Array.from(doc.leaves).sort();

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
      id: makeVersionId("merge"),
      kind: "merge",
      parents: [leftId, rightId],
      ts: nowIso(),
      text: canonical.text,
      nodes: canonical.nodes,
    };

    doc.versions.set(mergeNode.id, mergeNode);
    created.push(mergeNode);

    workingLeaves = [mergeNode.id, ...workingLeaves.slice(2)];
    head = mergeNode.id;
  }

  doc.headVersionId = head;
  recomputeLeaves(doc);

  return created;
}

const server = Bun.serve<WSData>({
  port: PORT,
  async fetch(req: Request, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const ok = serverInstance.upgrade(req, { data: { client: null } });
      return ok ? new Response(null) : new Response("WebSocket upgrade failed", { status: 400 });
    }

    const relPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = join(PUBLIC_DIR, relPath);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file);
  },
  websocket: {
    open(ws: ServerWebSocket<WSData>) {
      if (!ws.data.client) ws.data.client = null;
    },
    message(ws: ServerWebSocket<WSData>, message: string | ArrayBuffer | Uint8Array) {
      const rawText = messageToString(message);
      const parsed = jsonParseMessage<unknown>(rawText);
      if (!parsed || !isClientToServerMessage(parsed)) {
        wsSend(ws, { type: "error", message: "Invalid message" });
        return;
      }

      const msg: ClientToServerMessage = parsed;

      if (msg.type === "connect") {
        ws.data.client = { clientId: msg.clientId, docId: msg.docId };
        ws.subscribe(docTopic(msg.docId));

        const doc = getOrCreateDoc(msg.docId);

        const docState: ServerToClientMessage = {
          type: "doc_state",
          docId: doc.docId,
          headVersionId: doc.headVersionId,
          headText: computeHeadText(doc),
          versions: Array.from(doc.versions.values()).map(summaryOf),
        };

        wsSend(ws, docState);
        return;
      }

      const ident = ws.data.client;
      if (!ident) {
        wsSend(ws, { type: "error", message: "Must connect first" });
        return;
      }

      if (ident.docId !== msg.docId || ident.clientId !== msg.clientId) {
        wsSend(ws, { type: "error", docId: msg.docId, message: "Client identity mismatch" });
        return;
      }

      const doc = getOrCreateDoc(msg.docId);

       if (msg.type === "op") {
         const base = doc.versions.get(msg.baseVersionId);
         if (!base) {
           wsSend(ws, {
             type: "resync",
             docId: doc.docId,
             headVersionId: doc.headVersionId,
             headText: computeHeadText(doc),
             reason: "unknown_base",
           });
           return;
         }

         const opVersionId = makeId("op_");

         try {
           const sanitizedMutations = sanitizeMutations(msg.mutations);
           const next = applyIntent(base.text, sanitizedMutations);

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

           saveDocToDisk(doc);

           const added: VersionNode[] = [opNode];

           const merges = maybeMerge(doc);
           if (merges.length) {
             added.push(...merges);
             saveDocToDisk(doc);
           }

           broadcastGraphUpdate(doc, added);

           wsSend(ws, {
             type: "ack",
             docId: doc.docId,
             clientId: msg.clientId,
             opId: msg.opId,
             opVersionId: opNode.id,
             headVersionId: doc.headVersionId,
             status: merges.length ? "merged" : "integrated",
           });
         } catch {
           wsSend(ws, {
             type: "resync",
             docId: doc.docId,
             headVersionId: doc.headVersionId,
             headText: computeHeadText(doc),
             reason: "apply_failed",
           });
         }

         return;
       }

       if (msg.type === "pull") {
         const base = doc.versions.get(msg.baseVersionId);
         const other = doc.versions.get(msg.otherVersionId);
         if (!base || !other) {
           wsSend(ws, {
             type: "resync",
             docId: doc.docId,
             headVersionId: doc.headVersionId,
             headText: computeHeadText(doc),
             reason: "unknown_base",
           });
           return;
         }

         const merged = mergeDocuments3(base.text, base.text, other.text);
         const canonical = canonicalizeText(merged.text, "p_");

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

         saveDocToDisk(doc);

         const added: VersionNode[] = [opNode];
         broadcastGraphUpdate(doc, added);

         wsSend(ws, {
           type: "ack",
           docId: doc.docId,
           clientId: msg.clientId,
           opId: msg.opId,
           opVersionId: opNode.id,
           headVersionId: doc.headVersionId,
           status: "integrated",
         });

         return;
       }


    },
  },
});

console.log(`braid-demo server listening on http://localhost:${server.port}`);
