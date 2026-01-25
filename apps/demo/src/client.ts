import {
  diffNodes,
  parseXnl,
  XNL,
  isWord,
  wordToString,
  type DataElementNode,
  type TextElementNode,
  type XnlMutation,
  type XnlNode,
} from "xnl.ts";
import {
  jsonParseMessage,
  jsonStringifyMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type VersionId,
  type VersionSummary,
} from "./shared-protocol";
import { makeId, ulid } from "./id";

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el;
}

function requireTextarea(id: string): HTMLTextAreaElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`#${id} must be a textarea`);
  return el;
}

function requireButton(id: string): HTMLButtonElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`#${id} must be a button`);
  return el;
}

function requireSpan(id: string): HTMLSpanElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLSpanElement)) throw new Error(`#${id} must be a span`);
  return el;
}

function requirePre(id: string): HTMLPreElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLPreElement)) throw new Error(`#${id} must be a pre`);
  return el;
}

type UserId = 1 | 2 | 3 | 4;

type OpRecord = {
  id: string;
  userId: UserId;
  docId: string;
  baseVersionId: VersionId;
  opVersionId?: VersionId;
  headVersionId?: VersionId;
  ts: string;
  mutations: XnlMutation[];
};

type OutgoingOp = {
  opId: string;
  baseVersionId: VersionId;
  mutations: XnlMutation[];
  baseNodesAfter: XnlNode[];
  editorTextAfter: string;
};

type UserClientState = {
  userId: UserId;
  clientId: string;
  docId: string;
  socket: WebSocket | null;

  headVersionId: VersionId | null;
  baseVersionId: VersionId | null;
  baseNodes: XnlNode[];
  headText: string;

  inflight: OutgoingOp | null;
  sending: boolean;

  editor: HTMLTextAreaElement;
  setButton: HTMLButtonElement;
  peerButtonsEl: HTMLDivElement;
  peerButtons: Map<UserId, HTMLButtonElement>;
  inbox: Map<UserId, Array<{ headVersionId: VersionId; headText: string }>>;
  pendingClearInboxFrom: UserId | null;
  statusEl: HTMLSpanElement;
  revEl: HTMLSpanElement;
  parseErrorEl: HTMLPreElement;

  dirty: boolean;
  lastValidText: string | null;
  lastCanonicalText: string | null;
  suppressInput: boolean;
};

function nowId(): string {
  return ulid();
}

function requireDiv(id: string): HTMLDivElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLDivElement)) throw new Error(`#${id} must be a div`);
  return el;
}

function parseToNodes(text: string): XnlNode[] {
  return parseXnl(text).nodes;
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement";
}

function isTextElement(node: any): node is TextElementNode {
  return node && node.kind === "TextElement";
}

function readTag(node: any): string | undefined {
  if (!isDataElement(node) && !isTextElement(node)) return undefined;
  return node.tag;
}

function readMetaId(node: any): string | undefined {
  if (!isDataElement(node) && !isTextElement(node)) return undefined;
  const raw = (node as any).metadata?.id;
  if (typeof raw === "string") return raw;
  if (isWord(raw)) return wordToString(raw) ?? undefined;
  return undefined;
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

function ensureMetadataIds(nodes: XnlNode[], prefix: string): XnlNode[] {
  const clone = JSON.parse(JSON.stringify(nodes)) as XnlNode[];

  const visit = (node: any) => {
    if (isDataElement(node) || isTextElement(node)) {
      const id = readMetaId(node);
      if (!id) {
        setMetaId(node, makeMetaId(prefix));
      } else if ((node as any).metadata?.id && typeof (node as any).metadata.id !== "string") {
        setMetaId(node, id);
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

    if (node && typeof node === "object" && !isWord(node)) {
      for (const v of Object.values(node)) visit(v);
    }
  };

  for (const n of clone) visit(n);
  return clone;
}

function copyMissingMetaIds(base: any, desired: any): void {
  if (!base || !desired) return;

  if (Array.isArray(base) && Array.isArray(desired)) {
    const len = Math.min(base.length, desired.length);
    for (let i = 0; i < len; i++) copyMissingMetaIds(base[i], desired[i]);
    return;
  }

  const baseIsEl = isDataElement(base) || isTextElement(base);
  const desiredIsEl = isDataElement(desired) || isTextElement(desired);

  if (baseIsEl && desiredIsEl) {
    const baseId = readMetaId(base);
    const desiredId = readMetaId(desired);

    if (!desiredId && baseId && base.kind === desired.kind && base.tag === desired.tag) {
      setMetaId(desired, baseId);
    }

    const bAttrs = (base as any).attributes;
    const dAttrs = (desired as any).attributes;
    if (bAttrs && dAttrs && typeof bAttrs === "object" && typeof dAttrs === "object") {
      for (const key of Object.keys(dAttrs)) {
        if (key in bAttrs) copyMissingMetaIds(bAttrs[key], dAttrs[key]);
      }
    }

    const bMeta = (base as any).metadata;
    const dMeta = (desired as any).metadata;
    if (bMeta && dMeta && typeof bMeta === "object" && typeof dMeta === "object") {
      for (const key of Object.keys(dMeta)) {
        if (key === "id") continue;
        if (key in bMeta) copyMissingMetaIds(bMeta[key], dMeta[key]);
      }
    }

    if (isDataElement(base) && isDataElement(desired)) {
      const bBody = (base as any).body;
      const dBody = (desired as any).body;
      if (Array.isArray(bBody) && Array.isArray(dBody)) {
        const len = Math.min(bBody.length, dBody.length);
        for (let i = 0; i < len; i++) copyMissingMetaIds(bBody[i], dBody[i]);
      }

      const bExtend = (base as any).extend;
      const dExtend = (desired as any).extend;
      const dOrder = dExtend && Array.isArray(dExtend.order) ? dExtend.order : null;
      if (bExtend && dExtend && dOrder && bExtend.children && dExtend.children) {
        for (const tag of dOrder) {
          const bChild = bExtend.children[tag];
          const dChild = dExtend.children[tag];
          if (bChild && dChild) copyMissingMetaIds(bChild, dChild);
        }
      }
    }

    return;
  }

  if (
    base &&
    desired &&
    typeof base === "object" &&
    typeof desired === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(desired) &&
    !isWord(base) &&
    !isWord(desired)
  ) {
    for (const key of Object.keys(desired)) {
      if (key in base) copyMissingMetaIds((base as any)[key], (desired as any)[key]);
    }
  }
}

function isMetaIdObjectMutation(m: XnlMutation): boolean {
  if (m.type !== "OBJECT_ADD" && m.type !== "OBJECT_UPDATE" && m.type !== "OBJECT_DELETE") return false;
  if (!Array.isArray(m.path)) return false;

  const path = m.path as any[];
  const n = path.length;
  return (
    n >= 2 &&
    path[n - 2]?.type === "InstanceProperty" &&
    path[n - 2]?.value === "metadata" &&
    path[n - 1]?.type === "MapKey" &&
    path[n - 1]?.value === "id"
  );
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function parseUserId(value: string | undefined): UserId | null {
  if (!value) return null;
  const m1 = value.match(/^op_([1-4])_/);
  if (m1) return Number(m1[1]) as UserId;
  const m2 = value.match(/^c([1-4])_/);
  if (m2) return Number(m2[1]) as UserId;
  return null;
}

function colorForUser(userId: UserId): string {
  if (userId === 1) return "#F15E5E";
  if (userId === 2) return "#0167FF";
  if (userId === 3) return "#24B04B";
  return "#B04BB0";
}

function makeArrowSvg(color: string): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 22 22");

  const poly = document.createElementNS(svgNS, "polygon");
  poly.setAttribute("points", "11,0 22,11 16.5,11 16.5,22 5.5,22 5.5,11 0,11");
  poly.setAttribute("fill", color);
  poly.setAttribute("opacity", "0.95");

  svg.appendChild(poly);
  return svg;
}

function updatePeerButtonLabel(btn: HTMLButtonElement, color: string, pending: number): void {
  btn.style.display = pending <= 0 ? "none" : "inline-flex";
  btn.disabled = pending <= 0;
  btn.title = pending > 0 ? `Apply ${pending} pending update(s)` : "No pending updates";
  btn.textContent = "";
  btn.appendChild(makeArrowSvg(color));

  if (pending > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(pending);
    badge.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    badge.style.fontSize = "10px";
    badge.style.marginLeft = "4px";
    badge.style.opacity = "0.85";
    btn.appendChild(badge);
  }
}

const mutationItems = requireElement("mutationItems");
const mutationCount = requireElement("mutationCount");
const timeDag = requireElement("timeDag");
const spaceDag = requireElement("spaceDag");

const ops: OpRecord[] = [];
let selectedOpId: string | null = null;

const graphVersions = new Map<VersionId, VersionSummary>();
let graphHeadVersionId: VersionId | null = null;

function isAncestorVersion(ancestor: VersionId, descendant: VersionId): boolean {
  if (ancestor === descendant) return true;

  const seen = new Set<VersionId>();
  const stack: VersionId[] = [descendant];

  while (stack.length) {
    const id = stack.pop() as VersionId;
    if (id === ancestor) return true;
    if (seen.has(id)) continue;
    seen.add(id);

    const v = graphVersions.get(id);
    if (!v) continue;
    for (const p of v.parents) stack.push(p);
  }

  return false;
}

function pruneIntegratedInbox(state: UserClientState): void {
  const base = state.baseVersionId;
  if (!base) return;

  for (const [from, q] of state.inbox.entries()) {
    let write = 0;
    for (let i = 0; i < q.length; i++) {
      const item = q[i];
      if (!isAncestorVersion(item.headVersionId, base)) {
        q[write++] = item;
      }
    }
    q.length = write;

    const btn = state.peerButtons.get(from);
    if (btn) updatePeerButtonLabel(btn, colorForUser(from), q.length);
  }
}

function setSelectedOp(opId: string | null) {
  selectedOpId = opId;
  const items = mutationItems.querySelectorAll<HTMLElement>(".mutationEntry");
  items.forEach((el) => {
    el.classList.toggle("selected", el.dataset.opId === opId);
  });

  if (!opId) return;
  const target = mutationItems.querySelector<HTMLElement>(`.mutationEntry[data-op-id="${CSS.escape(opId)}"]`);
  if (target) {
    target.scrollIntoView({ block: "nearest" });
  }

  renderDags();
}

function renderMutationList() {
  mutationCount.textContent = String(ops.length);
  mutationItems.textContent = "";

  for (const op of ops.slice().reverse()) {
    const li = document.createElement("li");
    li.className = "mutationEntry";
    li.dataset.opId = op.id;

    const meta = document.createElement("div");
    meta.className = "mutationMeta";
    meta.textContent = `#${op.id} u${op.userId} base=${op.baseVersionId} opV=${op.opVersionId ?? "?"} head=${op.headVersionId ?? "?"} ${op.ts}`;

    const pre = document.createElement("pre");
    pre.className = "mutationContent";
    pre.textContent = JSON.stringify(op.mutations, null, 2);

    li.append(meta, pre);

    li.addEventListener("click", () => {
      setSelectedOp(op.id);
    });

    mutationItems.append(li);
  }
}

function upsertOpFromVersion(docId: string, headVersionId: VersionId, v: VersionSummary) {
  if (v.kind !== "op" || !v.opId) return;

  const userId = parseUserId(v.opId) ?? parseUserId(v.clientId) ?? 1;
  const baseVersionId = v.parents[0] ?? headVersionId;

  const existing = ops.find((o) => o.id === v.opId);
  if (existing) {
    existing.userId = userId;
    existing.baseVersionId = baseVersionId;
    existing.opVersionId = v.id;
    existing.headVersionId = headVersionId;
    existing.ts = v.ts;
    if (existing.mutations.length === 0 && v.mutations) existing.mutations = v.mutations;
    return;
  }

  ops.push({
    id: v.opId,
    userId,
    docId,
    baseVersionId,
    opVersionId: v.id,
    headVersionId,
    ts: v.ts,
    mutations: v.mutations ?? [],
  });
}

function renderDags() {
  renderTimeDag();
  renderSpaceDag();
}

function renderTimeDag() {
  timeDag.textContent = "";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");

  const versions = graphVersions;
  const headId = graphHeadVersionId;

  const layerCache = new Map<VersionId, number>();
  const getLayer = (id: VersionId): number => {
    const cached = layerCache.get(id);
    if (cached !== undefined) return cached;

    const v = versions.get(id);
    if (!v) {
      layerCache.set(id, 0);
      return 0;
    }

    if (!v.parents.length) {
      layerCache.set(id, 0);
      return 0;
    }

    let maxParent = 0;
    for (const p of v.parents) {
      maxParent = Math.max(maxParent, getLayer(p));
    }

    const layer = maxParent + 1;
    layerCache.set(id, layer);
    return layer;
  };

  type NodeLayout = {
    id: VersionId;
    x: number;
    y: number;
    v: VersionSummary;
    layer: number;
    col: number;
  };

  const byLayer = new Map<number, VersionId[]>();
  for (const id of versions.keys()) {
    const layer = getLayer(id);
    const arr = byLayer.get(layer) ?? [];
    arr.push(id);
    byLayer.set(layer, arr);
  }

  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);

  const nodeGapX = 92;
  const nodeGapY = 64;
  const paddingX = 24;
  const paddingY = 24;

  const layerNodes: NodeLayout[] = [];

  let maxCount = 1;
  for (const layer of layers) {
    const ids = byLayer.get(layer) ?? [];
    maxCount = Math.max(maxCount, ids.length);
  }

  const width = paddingX * 2 + Math.max(0, maxCount - 1) * nodeGapX + 120;
  const height = paddingY * 2 + Math.max(0, layers.length - 1) * nodeGapY + 80;

  for (const layer of layers) {
    const ids = byLayer.get(layer) ?? [];
    ids.sort((a, b) => {
      const va = versions.get(a);
      const vb = versions.get(b);
      const ca = va?.kind === "op" && va.opId ? parseUserId(va.opId) ?? 9 : 0;
      const cb = vb?.kind === "op" && vb.opId ? parseUserId(vb.opId) ?? 9 : 0;
      if (ca !== cb) return ca - cb;
      const ta = va?.ts ?? "";
      const tb = vb?.ts ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a < b ? -1 : 1;
    });

    const count = ids.length;
    const layerWidth = Math.max(0, count - 1) * nodeGapX;
    const offsetX = paddingX + (Math.max(0, (maxCount - 1) * nodeGapX - layerWidth) / 2);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const v = versions.get(id);
      if (!v) continue;

      const col = v.kind === "op" && v.opId ? parseUserId(v.opId) ?? 0 : 0;
      const x = offsetX + i * nodeGapX;
      const y = paddingY + layer * nodeGapY;
      layerNodes.push({ id, x, y, v, layer, col: col as number });
    }
  }

  const pos = new Map<VersionId, { x: number; y: number; v: VersionSummary }>();
  for (const n of layerNodes) pos.set(n.id, { x: n.x, y: n.y, v: n.v });

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const defs = document.createElementNS(svgNS, "defs");
  const marker = document.createElementNS(svgNS, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "10");
  marker.setAttribute("refX", "10");
  marker.setAttribute("refY", "5");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M0,0 L10,5 L0,10 Z");
  path.setAttribute("fill", "rgba(255,255,255,0.42)");
  marker.appendChild(path);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const p of pos.values()) {
    const child = p.v;
    for (const parentId of child.parents) {
      const pp = pos.get(parentId);
      if (!pp) continue;

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(pp.x));
      line.setAttribute("y1", String(pp.y));
      line.setAttribute("x2", String(p.x));
      line.setAttribute("y2", String(p.y));
      line.setAttribute("stroke", "rgba(255,255,255,0.26)");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("marker-end", "url(#arrow)");
      svg.appendChild(line);
    }
  }

  for (const [id, p] of pos.entries()) {
    const v = p.v;
    void id;

    const g = document.createElementNS(svgNS, "g");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(p.x));
    circle.setAttribute("cy", String(p.y));
    circle.setAttribute("r", "11");

    let fill = "rgba(200,200,200,0.7)";
    if (v.kind === "merge") fill = "rgba(180,180,180,0.55)";
    if (v.kind === "op" && v.opId) {
      const uid = parseUserId(v.opId) ?? parseUserId(v.clientId) ?? 1;
      fill = colorForUser(uid);
    }

    circle.setAttribute("fill", fill);

    const stroke = v.kind === "op" && v.opId && selectedOpId === v.opId ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0)";
    circle.setAttribute("stroke", stroke);
    circle.setAttribute("stroke-width", "3");

    if (v.kind === "op" && v.opId) {
      circle.style.cursor = "pointer";
      circle.addEventListener("click", () => setSelectedOp(v.opId ?? null));
    }

    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${v.id}`;
    g.appendChild(title);

    if (headId && id === headId) {
      const ring = document.createElementNS(svgNS, "circle");
      ring.setAttribute("cx", String(p.x));
      ring.setAttribute("cy", String(p.y));
      ring.setAttribute("r", "17");
      ring.setAttribute("fill", "rgba(0,0,0,0)");
      ring.setAttribute("stroke", "rgba(255,255,255,0.35)");
      ring.setAttribute("stroke-width", "2");
      g.appendChild(ring);
    }

    g.appendChild(circle);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", String(p.x));
    label.setAttribute("y", String(p.y + 28));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "rgba(255,255,255,0.7)");
    label.setAttribute("font-size", "12");
    label.setAttribute(
      "font-family",
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    );

    if (v.kind === "op" && v.opId) {
      const uid = parseUserId(v.opId) ?? parseUserId(v.clientId) ?? 1;
      label.textContent = String(uid);
    } else if (v.kind === "merge") {
      label.textContent = "m";
    } else {
      label.textContent = "r";
    }

    g.appendChild(label);
    svg.appendChild(g);
  }

  timeDag.appendChild(svg);
}

function renderSpaceDag() {
  spaceDag.textContent = "";

  const spaceDagMeta = document.getElementById("spaceDagMeta");

  const opList = ops.filter((o) => o.mutations.length > 0 && !o.id.startsWith("pull_"));

  const pathToKey = (path: any[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < path.length && i < 4; i++) {
      const seg = path[i] as any;
      const t = typeof seg?.type === "string" ? seg.type : "?";
      const v = seg && typeof seg === "object" && "value" in seg ? (seg as any).value : undefined;
      parts.push(v === undefined ? t : `${t}:${String(v)}`);
    }
    return parts.join("/");
  };

  const mutationSpaceKey = (m: XnlMutation): string | null => {
    const mm = m as any;

    const byName =
      (typeof mm.targetUniqueName === "string" && mm.targetUniqueName) ||
      (typeof mm.parentUniqueNameAfter === "string" && mm.parentUniqueNameAfter) ||
      (typeof mm.parentUniqueNameBefore === "string" && mm.parentUniqueNameBefore);

    if (byName) return `id:${byName}`;

    const afterId = readMetaId(mm.valueAfter);
    if (afterId) return `id:${afterId}`;

    const beforeId = readMetaId(mm.valueBefore);
    if (beforeId) return `id:${beforeId}`;

    if (Array.isArray(mm.path) && mm.path.length) return `path:${pathToKey(mm.path)}`;

    return null;
  };

  type Lane = { key: string; ops: OpRecord[]; seen: Set<string> };
  const lanesByKey = new Map<string, Lane>();

  for (const op of opList) {
    const keys = new Set<string>();
    for (const m of op.mutations) {
      const k = mutationSpaceKey(m);
      if (k) keys.add(k);
    }
    if (!keys.size) keys.add("other");

    for (const key of keys) {
      let lane = lanesByKey.get(key);
      if (!lane) {
        lane = { key, ops: [], seen: new Set() };
        lanesByKey.set(key, lane);
      }

      if (lane.seen.has(op.id)) continue;
      lane.seen.add(op.id);
      lane.ops.push(op);
    }
  }

  const lanes = Array.from(lanesByKey.values());
  for (const lane of lanes) {
    lane.ops.sort((a, b) => {
      const ta = Date.parse(a.ts);
      const tb = Date.parse(b.ts);
      if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
  }

  lanes.sort((a, b) => {
    if (b.ops.length !== a.ops.length) return b.ops.length - a.ops.length;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });

  if (spaceDagMeta) {
    spaceDagMeta.textContent = `${lanes.length} lanes · ${opList.length} ops`;
  }

  if (lanes.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "10px";
    empty.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    empty.style.color = "rgba(255,255,255,0.7)";
    empty.textContent = "No ops yet. Click Set in any user panel to create mutations.";
    spaceDag.appendChild(empty);
    return;
  }

  const shortenId = (id: string): string => {
    if (id.length <= 22) return id;
    return `${id.slice(0, 10)}…${id.slice(-10)}`;
  };

  const labelForKey = (key: string): string => {
    if (key === "other") return "other";
    if (key.startsWith("id:")) return shortenId(key.slice(3));
    if (key.startsWith("path:")) return key.slice(5);
    return key;
  };

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");

  const paddingX = 16;
  const paddingY = 16;
  const laneWidth = 190;
  const laneGap = 14;
  const headerH = 36;
  const nodeGapY = 54;
  const nodeR = 10;

  const maxOps = Math.max(1, ...lanes.map((l) => l.ops.length));
  const width = paddingX * 2 + lanes.length * laneWidth + Math.max(0, lanes.length - 1) * laneGap;
  const height = paddingY * 2 + headerH + Math.max(0, maxOps - 1) * nodeGapY + nodeR * 2 + 20;

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.display = "block";

  for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
    const lane = lanes[laneIdx] as Lane;

    const laneX = paddingX + laneIdx * (laneWidth + laneGap);
    const centerX = laneX + laneWidth / 2;

    const bg = document.createElementNS(svgNS, "rect");
    bg.setAttribute("x", String(laneX));
    bg.setAttribute("y", String(paddingY));
    bg.setAttribute("width", String(laneWidth));
    bg.setAttribute("height", String(height - paddingY * 2));
    bg.setAttribute("rx", "12");
    bg.setAttribute("fill", "rgba(0,0,0,0.18)");
    bg.setAttribute("stroke", "rgba(255,255,255,0.10)");
    bg.setAttribute("stroke-width", "1");
    svg.appendChild(bg);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", String(centerX));
    label.setAttribute("y", String(paddingY + 18));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "rgba(255,255,255,0.78)");
    label.setAttribute("font-size", "11");
    label.setAttribute(
      "font-family",
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    );
    label.textContent = `${labelForKey(lane.key)} (${lane.ops.length})`;
    svg.appendChild(label);

    const latest = lane.ops[lane.ops.length - 1];
    if (latest) {
      bg.style.cursor = "pointer";
      label.style.cursor = "pointer";
      bg.addEventListener("click", () => setSelectedOp(latest.id));
      label.addEventListener("click", () => setSelectedOp(latest.id));
    }

    const startY = paddingY + headerH;

    for (let i = 0; i < lane.ops.length; i++) {
      const op = lane.ops[i] as OpRecord;
      const y = startY + i * nodeGapY;

      if (i > 0) {
        const prevY = startY + (i - 1) * nodeGapY;
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(centerX));
        line.setAttribute("y1", String(prevY + nodeR));
        line.setAttribute("x2", String(centerX));
        line.setAttribute("y2", String(y - nodeR));
        line.setAttribute("stroke", "rgba(255,255,255,0.22)");
        line.setAttribute("stroke-width", "2");
        svg.appendChild(line);
      }

      const g = document.createElementNS(svgNS, "g");

      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(centerX));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", String(nodeR));
      circle.setAttribute("fill", colorForUser(op.userId));
      circle.setAttribute("opacity", "0.95");

      const selected = selectedOpId === op.id;
      circle.setAttribute("stroke", selected ? "rgba(140,205,255,0.95)" : "rgba(0,0,0,0)");
      circle.setAttribute("stroke-width", selected ? "3" : "0");

      circle.style.cursor = "pointer";
      circle.addEventListener("click", () => setSelectedOp(op.id));

      const title = document.createElementNS(svgNS, "title");
      title.textContent = `${op.id} u${op.userId} ${op.ts}`;

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", String(centerX));
      text.setAttribute("y", String(y + 4));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", "rgba(10,10,10,0.85)");
      text.setAttribute("font-size", "11");
      text.setAttribute(
        "font-family",
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
      );
      text.textContent = String(op.userId);
      text.style.pointerEvents = "none";

      g.appendChild(title);
      g.appendChild(circle);
      g.appendChild(text);
      svg.appendChild(g);
    }
  }

  spaceDag.appendChild(svg);
}

function wsUrl(): string {
  const u = new URL("/ws", window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function connectUser(state: UserClientState) {
  const ws = new WebSocket(wsUrl());
  state.socket = ws;
  state.statusEl.textContent = "connecting";

  ws.addEventListener("open", () => {
    state.statusEl.textContent = "connected";
    const msg: ClientToServerMessage = {
      type: "connect",
      docId: state.docId,
      clientId: state.clientId,
      protocolVersion: 2,
    };
    ws.send(jsonStringifyMessage(msg));
  });

  ws.addEventListener("close", () => {
    state.statusEl.textContent = "disconnected";
    state.socket = null;
  });

  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : "";
    const msg = jsonParseMessage<ServerToClientMessage>(data);
    if (!msg) return;
    onServerMessage(state, msg);
  });
}

function setParseError(state: UserClientState, message: string | null) {
  state.parseErrorEl.textContent = message ?? "";
}

function validateUserInput(state: UserClientState): { ok: true; text: string } | { ok: false; error: string } {
  const text = state.editor.value;
  try {
    const parsed = parseXnl(text);

    if (parsed.nodes.length > 1) {
      return { ok: false, error: `expected 0 or 1 root node, got ${parsed.nodes.length}` };
    }

    const baseRoot = state.baseNodes[0];
    if (baseRoot) {
      if (parsed.nodes.length === 0) {
        return { ok: false, error: "root node required" };
      }

      const baseTag = readTag(baseRoot);
      const desiredTag = readTag(parsed.nodes[0]);
      if (baseTag && desiredTag && baseTag !== desiredTag) {
        return { ok: false, error: `root tag locked to <${baseTag}>` };
      }
    }

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

function computeAndQueueOp(state: UserClientState): { ok: true } | { ok: false } {
  const validation = validateUserInput(state);
  if (!validation.ok) {
    setParseError(state, validation.error);
    state.setButton.disabled = true;
    state.lastValidText = null;
    return { ok: false };
  }

  setParseError(state, null);

  if (!state.baseVersionId) {
    state.setButton.disabled = true;
    state.lastValidText = validation.text;
    return { ok: true };
  }

  state.setButton.disabled = state.sending;
  state.lastValidText = validation.text;
  state.lastCanonicalText = null;

  if (!state.dirty) return { ok: true };

  const desiredParsed = parseXnl(validation.text);

  const canonicalNodes = ensureMetadataIds(desiredParsed.nodes, `c_${state.clientId}:`);
  for (let i = 0; i < canonicalNodes.length && i < state.baseNodes.length; i++) {
    copyMissingMetaIds(state.baseNodes[i], canonicalNodes[i]);
  }

  const canonicalText2 = XNL.stringify({ nodes: canonicalNodes });
  const canonicalParsed = parseXnl(canonicalText2);
  state.lastCanonicalText = XNL.stringify(canonicalParsed);
  state.lastValidText = state.lastCanonicalText;

  const desiredNodes = parseToNodes(state.lastCanonicalText);
  const rawMutations = diffNodes(state.baseNodes, desiredNodes, []);

  const mutations = rawMutations.filter((m) => !isMetaIdObjectMutation(m));

  if (mutations.length === 0) {
    state.dirty = false;
    state.setButton.disabled = true;
    return { ok: true };
  }

  const opId = `op_${state.userId}_${nowId()}`;
  state.inflight = {
    opId,
    baseVersionId: state.baseVersionId,
    mutations,
    baseNodesAfter: desiredNodes,
    editorTextAfter: state.lastValidText,
  };
  state.dirty = false;
  return { ok: true };
}

function flush(state: UserClientState) {
  const ws = state.socket;
  const inflight = state.inflight;

  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!inflight) return;
  if (state.sending) return;

  const msg: ClientToServerMessage = {
    type: "op",
    docId: state.docId,
    clientId: state.clientId,
    opId: inflight.opId,
    baseVersionId: inflight.baseVersionId,
    mutations: inflight.mutations,
  };

  state.sending = true;
  ws.send(jsonStringifyMessage(msg));

  for (const [from, q] of state.inbox.entries()) {
    const btn = state.peerButtons.get(from);
    if (btn) updatePeerButtonLabel(btn, colorForUser(from), q.length);
  }

  const optimistic: OpRecord = {
    id: inflight.opId,
    userId: state.userId,
    docId: state.docId,
    baseVersionId: inflight.baseVersionId,
    ts: new Date().toISOString(),
    mutations: inflight.mutations,
  };
  ops.push(optimistic);
  renderMutationList();

  state.baseNodes = inflight.baseNodesAfter;
  state.revEl.textContent = "pending";
}

function applyDocStateToUser(state: UserClientState, headVersionId: VersionId, headText: string) {
  state.headVersionId = headVersionId;
  state.headText = headText;

  if (state.dirty) return;

  state.baseVersionId = headVersionId;
  state.baseNodes = parseToNodes(headText);
  state.revEl.textContent = headVersionId;

  state.suppressInput = true;
  state.editor.value = headText;
  state.suppressInput = false;

  state.dirty = false;
  state.lastValidText = null;
  state.lastCanonicalText = null;
  state.setButton.disabled = true;
  setParseError(state, null);

  pruneIntegratedInbox(state);
}

function recordIncoming(state: UserClientState, from: UserId, headVersionId: VersionId, headText: string): void {
  const q = state.inbox.get(from);
  if (!q) return;

  const base = state.baseVersionId;
  if (base && isAncestorVersion(headVersionId, base)) {
    return;
  }

  if (q.some((it) => it.headVersionId === headVersionId)) {
    return;
  }

  q.push({ headVersionId, headText });

  const btn = state.peerButtons.get(from);
  if (btn) updatePeerButtonLabel(btn, colorForUser(from), q.length);
}

function applyIncoming(state: UserClientState, from: UserId): void {
  const q = state.inbox.get(from);
  if (!q || q.length === 0) return;

  if (state.sending) return;

  if (state.dirty) {
    const ok = computeAndQueueOp(state);
    if (!ok.ok) return;

    if (state.lastValidText) {
      state.suppressInput = true;
      state.editor.value = state.lastValidText;
      state.suppressInput = false;
      state.dirty = false;
    }

    state.pendingClearInboxFrom = from;
    flush(state);
    state.setButton.disabled = true;
    return;
  }

  const item = q.shift() as { headVersionId: VersionId; headText: string };

  state.suppressInput = true;
  state.editor.value = item.headText;
  state.suppressInput = false;

  state.baseVersionId = item.headVersionId;
  state.baseNodes = parseToNodes(item.headText);
  state.revEl.textContent = item.headVersionId;

  pruneIntegratedInbox(state);

  state.dirty = false;
  state.lastValidText = null;
  state.lastCanonicalText = null;
  state.setButton.disabled = true;
  setParseError(state, null);

  const btn = state.peerButtons.get(from);
  if (btn) updatePeerButtonLabel(btn, colorForUser(from), q.length);
}

function onServerMessage(state: UserClientState, msg: ServerToClientMessage) {
  if (msg.type === "error") {
    const message = typeof msg.message === "string" ? msg.message : "Server error";
    setParseError(state, message);
    return;
  }
  if (msg.docId !== state.docId) return;

  if (msg.type === "doc_state") {
    state.inflight = null;
    state.sending = false;
    state.baseVersionId = msg.headVersionId;
    state.baseNodes = parseToNodes(msg.headText);
    state.revEl.textContent = msg.headVersionId;

    state.dirty = false;
    state.lastValidText = null;
    state.lastCanonicalText = null;
    state.setButton.disabled = true;

    graphHeadVersionId = msg.headVersionId;
    graphVersions.clear();
    for (const v of msg.versions) graphVersions.set(v.id, v);

    for (const v of msg.versions) upsertOpFromVersion(msg.docId, msg.headVersionId, v);

    renderMutationList();
    renderDags();

    applyDocStateToUser(state, msg.headVersionId, msg.headText);
    computeAndQueueOp(state);
    return;
  }

  if (msg.type === "graph_update") {
    graphHeadVersionId = msg.headVersionId;
    for (const v of msg.added) graphVersions.set(v.id, v);

    for (const v of msg.added) upsertOpFromVersion(msg.docId, msg.headVersionId, v);

    renderMutationList();
    renderDags();

    state.headVersionId = msg.headVersionId;
    state.headText = msg.headText;

    let origin: UserId | null = null;
    for (const added of msg.added) {
      origin = parseUserId(added.opId) ?? parseUserId(added.clientId);
      if (origin) break;
    }

    if (!origin || origin === state.userId) {
      if (!state.dirty) {
        state.baseVersionId = msg.headVersionId;
        state.baseNodes = parseToNodes(msg.headText);
        state.revEl.textContent = msg.headVersionId;
      }
      computeAndQueueOp(state);
      return;
    }

    recordIncoming(state, origin, msg.headVersionId, msg.headText);
    return;
  }

  if (msg.type === "ack") {
    if (msg.clientId !== state.clientId) return;

    if (state.sending && !state.inflight && msg.opId.startsWith("pull_")) {
      state.sending = false;
      return;
    }

    if (!state.inflight || state.inflight.opId !== msg.opId) return;

    const op = ops.find((o) => o.id === msg.opId);
    if (op) {
      op.opVersionId = msg.opVersionId;
      op.headVersionId = msg.headVersionId;
    }

    state.baseVersionId = msg.opVersionId;
    state.baseNodes = state.inflight.baseNodesAfter;
    state.revEl.textContent = state.baseVersionId;

    state.inflight = null;
    state.sending = false;

    if (state.pendingClearInboxFrom) {
      const from = state.pendingClearInboxFrom;
      state.pendingClearInboxFrom = null;

      const q = state.inbox.get(from);
      const btn = state.peerButtons.get(from);

      if (q && q.length) {
        applyIncoming(state, from);
      } else {
        if (btn) updatePeerButtonLabel(btn, colorForUser(from), 0);
      }
    }

    renderMutationList();
    renderDags();

    computeAndQueueOp(state);
    return;
  }

  if (msg.type === "resync") {
    state.inflight = null;
    state.sending = false;

    if (!state.dirty) {
      state.baseVersionId = msg.headVersionId;
      state.baseNodes = parseToNodes(msg.headText);
      state.revEl.textContent = msg.headVersionId;

      pruneIntegratedInbox(state);
    }

    applyDocStateToUser(state, msg.headVersionId, msg.headText);
    computeAndQueueOp(state);
  }
}

function makeUserState(userId: UserId): UserClientState {
  const editor = requireTextarea(`user${userId}Editor`);
  const setButton = requireButton(`user${userId}Set`);
  const statusEl = requireSpan(`user${userId}Status`);
  const revEl = requireSpan(`user${userId}Rev`);
  const parseErrorEl = requirePre(`user${userId}ParseError`);

  const peerButtonsEl = requireDiv(`user${userId}PeerButtons`);
  peerButtonsEl.textContent = "";

  const state: UserClientState = {
    userId,
    clientId: `c${userId}_${nowId()}`,
    docId: "default",
    socket: null,

    headVersionId: null,
    baseVersionId: null,
    baseNodes: [],
    headText: "",

    inflight: null,
    sending: false,

    editor,
    setButton,
    peerButtonsEl,
    peerButtons: new Map<UserId, HTMLButtonElement>(),
    inbox: new Map<UserId, Array<{ headVersionId: VersionId; headText: string }>>(),
    pendingClearInboxFrom: null,
    statusEl,
    revEl,
    parseErrorEl,

    dirty: false,
    lastValidText: null,
    lastCanonicalText: null,
    suppressInput: false,
  };

  setButton.disabled = true;

  for (const other of [1, 2, 3, 4] as UserId[]) {
    if (other === userId) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "peerSyncButton";
    const color = colorForUser(other);
    btn.style.borderColor = color;
    btn.style.color = color;
    btn.setAttribute("data-from", String(other));

    state.peerButtons.set(other, btn);
    state.inbox.set(other, []);

    updatePeerButtonLabel(btn, color, 0);

    const btnUser = other;
    btn.addEventListener("click", () => {
      applyIncoming(state, btnUser);
    });

    state.peerButtonsEl.appendChild(btn);
  }


  editor.addEventListener("input", () => {
    if (state.suppressInput) return;
    state.dirty = true;
    state.setButton.disabled = false;
    state.lastValidText = null;
    state.lastCanonicalText = null;
  });

  setButton.addEventListener("click", () => {
    const ok = computeAndQueueOp(state);
    if (!ok.ok) return;

    if (state.lastValidText) {
      state.suppressInput = true;
      state.editor.value = state.lastValidText;
      state.suppressInput = false;
      state.dirty = false;
    }

    flush(state);
    state.setButton.disabled = true;
  });

  return state;
}

const users: UserClientState[] = [makeUserState(1), makeUserState(2), makeUserState(3), makeUserState(4)];

for (const u of users) {
  connectUser(u);
}

renderMutationList();
renderDags();
