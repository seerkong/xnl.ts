import { diffNodes, parseXnl, XNL, isWord, wordToString, type DataElementNode, type TextElementNode, type XnlMutation, type XnlNode } from "xnl.ts";
import { jsonParseMessage, jsonStringifyMessage, type ClientToServerMessage, type ServerToClientMessage, type VersionId } from "./shared-protocol";
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

function nowId(): string {
  return ulid();
}

function wsUrl(): string {
  const u = new URL("/ws", window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
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
        if (key in bMeta) copyMissingMetaIds(bMeta[key], dMeta[key]);
      }
    }

    if (isDataElement(base) && isDataElement(desired)) {
      if (base.body && desired.body) {
        const len = Math.min(base.body.length, desired.body.length);
        for (let i = 0; i < len; i++) copyMissingMetaIds(base.body[i], desired.body[i]);
      }

      if (base.extend && desired.extend) {
        for (const tag of desired.extend.order) {
          if (tag in base.extend.children) {
            copyMissingMetaIds(base.extend.children[tag], desired.extend.children[tag]);
          }
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

function parseToNodes(text: string): XnlNode[] {
  return parseXnl(text).nodes;
}

function setParseError(state: PeerState, message: string | null) {
  state.parseErrorEl.textContent = message ?? "";
}

function sanitizeIdentity(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return safe.length ? safe.slice(0, 48) : "anonymous";
}

type OutgoingOp = {
  opId: string;
  baseVersionId: VersionId;
  mutations: XnlMutation[];
  baseNodesAfter: XnlNode[];
  editorTextAfter: string;
};

type PeerState = {
  identity: string;
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
  statusEl: HTMLSpanElement;
  revEl: HTMLSpanElement;
  parseErrorEl: HTMLPreElement;

  dirty: boolean;
  lastValidText: string | null;
  lastCanonicalText: string | null;
  suppressInput: boolean;
};

function validateUserInput(state: PeerState): { ok: true; text: string } | { ok: false; error: string } {
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

function computeAndQueueOp(state: PeerState): { ok: true } | { ok: false } {
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

  const opId = `op_${state.identity}_${nowId()}`;
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

function flush(state: PeerState) {
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

  if (inflight.editorTextAfter) {
    state.suppressInput = true;
    state.editor.value = inflight.editorTextAfter;
    state.suppressInput = false;
  }

  state.baseNodes = inflight.baseNodesAfter;
  state.revEl.textContent = "pending";
  state.setButton.disabled = true;
}

function applyServerDoc(state: PeerState, headVersionId: VersionId, headText: string) {
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
}

function onServerMessage(state: PeerState, msg: ServerToClientMessage) {
  if (msg.type === "error") {
    setParseError(state, typeof msg.message === "string" ? msg.message : "Server error");
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

    applyServerDoc(state, msg.headVersionId, msg.headText);
    computeAndQueueOp(state);
    return;
  }

  if (msg.type === "graph_update") {
    state.headVersionId = msg.headVersionId;
    state.headText = msg.headText;

    if (state.sending || state.inflight) return;

    if (!state.dirty) {
      applyServerDoc(state, msg.headVersionId, msg.headText);
      computeAndQueueOp(state);
    }
    return;
  }

  if (msg.type === "ack") {
    if (msg.clientId !== state.clientId) return;
    if (!state.inflight || state.inflight.opId !== msg.opId) return;

    state.baseVersionId = msg.opVersionId;
    state.baseNodes = state.inflight.baseNodesAfter;
    state.revEl.textContent = msg.opVersionId;

    state.inflight = null;
    state.sending = false;

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
      applyServerDoc(state, msg.headVersionId, msg.headText);
    }

    computeAndQueueOp(state);
  }
}

function connectPeer(state: PeerState) {
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

function init() {
  const params = new URL(window.location.href).searchParams;
  const rawDocId = params.get("docId") ?? "default";
  const rawIdentity = params.get("identity") ?? "";

  const docId = rawDocId.trim().length ? rawDocId.trim() : "default";
  const identity = sanitizeIdentity(rawIdentity);

  requireSpan("peerDocId").textContent = docId;
  requireSpan("peerIdentity").textContent = identity;

  const editor = requireTextarea("peerEditor");
  const setButton = requireButton("peerSet");
  const statusEl = requireSpan("peerStatus");
  const revEl = requireSpan("peerRev");
  const parseErrorEl = requirePre("peerParseError");

  const state: PeerState = {
    identity,
    clientId: `id_${identity}_${nowId()}`,
    docId,

    socket: null,

    headVersionId: null,
    baseVersionId: null,
    baseNodes: [],
    headText: "",

    inflight: null,
    sending: false,

    editor,
    setButton,
    statusEl,
    revEl,
    parseErrorEl,

    dirty: false,
    lastValidText: null,
    lastCanonicalText: null,
    suppressInput: false,
  };

  setButton.disabled = true;

  if (!params.get("identity")) {
    setParseError(state, "Missing required query param: identity");
  }

  editor.addEventListener("input", () => {
    if (state.suppressInput) return;
    state.dirty = true;
    state.setButton.disabled = false;
    state.lastValidText = null;
    state.lastCanonicalText = null;
    setParseError(state, null);
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
  });

  connectPeer(state);
}

init();
