import {
  diffNodes,
  isWord,
  parseXnl,
  wordToString,
  XNL,
  type DataElementNode,
  type TextElementNode,
  type XnlMutation,
  type XnlNode,
} from "xnl.ts";
import {
  isClientToServerMessage,
  jsonParseMessage,
  jsonStringifyMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type VersionId,
} from "@braid-demo/realtime-protocol";
import { ulid } from "@braid-demo/realtime-core";

export type PeerClientStatus = "disconnected" | "connecting" | "connected";

export type PeerClientState = {
  status: PeerClientStatus;
  docId: string;
  identity: string;
  clientId: string;

  headVersionId: VersionId | null;
  baseVersionId: VersionId | null;

  text: string;
  dirty: boolean;
  sending: boolean;
  error: string | null;

  revLabel: string;
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: any) => void): void;
  removeEventListener(type: string, listener: (ev: any) => void): void;
};

export type PeerClientOptions = {
  docId: string;
  identity: string;
  wsUrl: string | (() => string);
  createWebSocket?: (url: string) => WebSocketLike;

  autoApplyRemote?: boolean;
  onServerMessage?: (msg: ServerToClientMessage) => void;
};

export type CommitResult =
  | { ok: true; canonicalText?: string }
  | { ok: false; error: string };

type OutgoingOp = {
  opId: string;
  baseVersionId: VersionId;
  mutations: XnlMutation[];
  baseNodesAfter: XnlNode[];
  canonicalText: string;
};

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

function readMetaId(node: DataElementNode | TextElementNode): string | undefined {
  const meta = node.metadata as unknown;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return undefined;

  const raw = (meta as Record<string, unknown>)["id"];
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

function ensureMetadataIdsClone(nodes: XnlNode[], prefix: string): XnlNode[] {
  const clone = JSON.parse(JSON.stringify(nodes)) as XnlNode[];

  const visit = (node: any) => {
    if (isDataElement(node) || isTextElement(node)) {
      const id = readMetaId(node);
      if (!id) {
        setMetaId(node, `${prefix}${ulid()}`);
      } else {
        const meta = node.metadata as unknown;
        const raw =
          meta !== null && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>)["id"] : undefined;
        if (raw !== undefined && typeof raw !== "string") {
          setMetaId(node, id);
        }
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

    const bAttrs = base.attributes;
    const dAttrs = desired.attributes;
    if (bAttrs && dAttrs && typeof bAttrs === "object" && typeof dAttrs === "object") {
      for (const key of Object.keys(dAttrs)) {
        if (key in bAttrs) copyMissingMetaIds(bAttrs[key], dAttrs[key]);
      }
    }

    const bMeta = base.metadata;
    const dMeta = desired.metadata;
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
      const b = base as Record<string, unknown>;
      const d = desired as Record<string, unknown>;
      if (key in b) copyMissingMetaIds(b[key], d[key]);
    }
  }
}

function isMetaIdObjectMutation(m: XnlMutation): boolean {
  if (m.type !== "OBJECT_ADD" && m.type !== "OBJECT_UPDATE" && m.type !== "OBJECT_DELETE") return false;
  if (!Array.isArray(m.path)) return false;

  const path = m.path;
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

function formatXnlMultiline(text: string): string {
  try {
    return XNL.stringify(parseXnl(text), { pretty: true, indent: 2 });
  } catch {
    return text;
  }
}

export type PeerClient = {
  getState(): PeerClientState;
  subscribe(listener: (state: PeerClientState) => void): () => void;
  connect(): void;
  disconnect(): void;
  setText(text: string): void;
  checkout(baseVersionId: VersionId, text: string, opts?: { force?: boolean }): CommitResult;
  commit(): CommitResult;
};

export function createPeerClient(opts: PeerClientOptions): PeerClient {
  const resolveWsUrl = (): string => (typeof opts.wsUrl === "function" ? opts.wsUrl() : opts.wsUrl);

  const createWs =
    opts.createWebSocket ??
    ((url: string): WebSocketLike => {
      const WSUnknown = (globalThis as unknown as Record<string, unknown>)["WebSocket"];
      if (typeof WSUnknown !== "function") {
        throw new Error("WebSocket is not available in this environment");
      }

      const WS = WSUnknown as unknown as new (url: string) => WebSocketLike;
      return new WS(url);
    });

  const listeners = new Set<(state: PeerClientState) => void>();
  const autoApplyRemote = opts.autoApplyRemote !== false;

  let socket: WebSocketLike | null = null;
  let baseNodes: XnlNode[] = [];
  let inflight: OutgoingOp | null = null;
  let pendingRemote: { headVersionId: VersionId; headText: string } | null = null;

  const state: PeerClientState = {
    status: "disconnected",
    docId: opts.docId,
    identity: opts.identity,
    clientId: `c_${opts.identity}_${ulid()}`,

    headVersionId: null,
    baseVersionId: null,

    text: "",
    dirty: false,
    sending: false,
    error: null,

    revLabel: "-",
  };

  const emit = () => {
    for (const l of listeners) l({ ...state });
  };

  const setError = (message: string | null) => {
    state.error = message;
  };

  const applyServerDoc = (headVersionId: VersionId, headText: string) => {
    pendingRemote = null;

    state.headVersionId = headVersionId;
    state.baseVersionId = headVersionId;
    baseNodes = parseToNodes(headText);

    state.revLabel = headVersionId;

    if (!state.dirty) {
      state.text = formatXnlMultiline(headText);
    }
  };

  const callServerMessageHook = (msg: ServerToClientMessage) => {
    if (!opts.onServerMessage) return;
    try {
      opts.onServerMessage(msg);
    } catch (err) {
      setError(`onServerMessage failed: ${formatError(err)}`);
      emit();
    }
  };

  const handleServerMessage = (msg: ServerToClientMessage) => {
    if (msg.type === "error") {
      setError(typeof msg.message === "string" ? msg.message : "Server error");
      emit();
      return;
    }

    if (msg.docId !== state.docId) return;

    if (msg.type === "doc_state") {
      inflight = null;
      state.sending = false;
      setError(null);

      applyServerDoc(msg.headVersionId, msg.headText);
      emit();
      return;
    }

    if (msg.type === "graph_update") {
      state.headVersionId = msg.headVersionId;

      if (autoApplyRemote) {
        if (!state.dirty && !state.sending && !inflight) {
          applyServerDoc(msg.headVersionId, msg.headText);
        } else if (!state.dirty && (state.sending || inflight)) {
          pendingRemote = { headVersionId: msg.headVersionId, headText: msg.headText };
        }
      }

      emit();
      return;
    }

    if (msg.type === "ack") {
      if (msg.clientId !== state.clientId) return;
      if (!inflight || inflight.opId !== msg.opId) return;

      state.baseVersionId = msg.opVersionId;
      baseNodes = inflight.baseNodesAfter;
      state.revLabel = msg.opVersionId;

      state.headVersionId = msg.headVersionId;

      inflight = null;
      state.sending = false;

      if (autoApplyRemote && pendingRemote && !state.dirty) {
        applyServerDoc(pendingRemote.headVersionId, pendingRemote.headText);
      }

      emit();
      return;
    }

    if (msg.type === "resync") {
      inflight = null;
      state.sending = false;

      if (!state.dirty) {
        applyServerDoc(msg.headVersionId, msg.headText);
      } else {
        state.headVersionId = msg.headVersionId;
        pendingRemote = { headVersionId: msg.headVersionId, headText: msg.headText };
      }

      emit();
      return;
    }
  };

  const validateText = (text: string): { ok: true; parsedNodes: XnlNode[]; canonicalText: string } | { ok: false; error: string } => {
    try {
      const parsed = parseXnl(text);

      if (parsed.nodes.length > 1) {
        return { ok: false, error: `expected 0 or 1 root node, got ${parsed.nodes.length}` };
      }

      const baseRoot = baseNodes[0];
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

      const canonicalNodes = ensureMetadataIdsClone(parsed.nodes, `c_${state.clientId}:`);
      for (let i = 0; i < canonicalNodes.length && i < baseNodes.length; i++) {
        copyMissingMetaIds(baseNodes[i], canonicalNodes[i]);
      }

      const canonicalText2 = XNL.stringify({ nodes: canonicalNodes });
      const canonicalParsed = parseXnl(canonicalText2);
      const displayText = XNL.stringify(canonicalParsed, { pretty: true, indent: 2 });

      return { ok: true, parsedNodes: canonicalParsed.nodes, canonicalText: displayText };
    } catch (err) {
      return { ok: false, error: formatError(err) };
    }
  };

  const commit = (): CommitResult => {
    if (!state.baseVersionId) {
      const error = "Not connected";
      setError(error);
      emit();
      return { ok: false, error };
    }

    const validation = validateText(state.text);
    if (!validation.ok) {
      setError(validation.error);
      emit();
      return { ok: false, error: validation.error };
    }

    setError(null);

    const { parsedNodes: desiredNodes, canonicalText } = validation;
    state.text = canonicalText;

    if (!state.dirty) {
      emit();
      return { ok: true, canonicalText };
    }

    const rawMutations = diffNodes(baseNodes, desiredNodes, []);
    const mutations = rawMutations.filter((m) => !isMetaIdObjectMutation(m));

    if (mutations.length === 0) {
      state.dirty = false;
      emit();
      return { ok: true, canonicalText };
    }

    const ws = socket;
    if (!ws || ws.readyState !== 1) {
      const error = "WebSocket not open";
      setError(error);
      emit();
      return { ok: false, error };
    }

    const opId = `op_${state.identity}_${ulid()}`;

    inflight = {
      opId,
      baseVersionId: state.baseVersionId,
      mutations,
      baseNodesAfter: desiredNodes,
      canonicalText,
    };

    const msg: ClientToServerMessage = {
      type: "op",
      docId: state.docId,
      clientId: state.clientId,
      opId,
      baseVersionId: inflight.baseVersionId,
      mutations,
    };

    state.sending = true;
    state.dirty = false;

    ws.send(jsonStringifyMessage(msg));

    baseNodes = inflight.baseNodesAfter;
    state.revLabel = "pending";

    emit();
    return { ok: true, canonicalText };
  };

  const connect = () => {
    if (socket) return;

    const url = resolveWsUrl();
    const ws = createWs(url);
    socket = ws;
    state.status = "connecting";
    emit();

    const onOpen = () => {
      state.status = "connected";
      emit();

      const msg: ClientToServerMessage = {
        type: "connect",
        docId: state.docId,
        clientId: state.clientId,
        protocolVersion: 2,
      };

      ws.send(jsonStringifyMessage(msg));
    };

    const onClose = () => {
      socket = null;
      state.status = "disconnected";
      state.sending = false;
      inflight = null;
      emit();

      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("message", onMessage);
    };

    const onMessage = (ev: any) => {
      const data = typeof ev?.data === "string" ? ev.data : "";
      const msg = jsonParseMessage<unknown>(data);
      if (!msg) return;

      if (isClientToServerMessage(msg)) return;

      const serverMsg = msg as ServerToClientMessage;
      handleServerMessage(serverMsg);
      callServerMessageHook(serverMsg);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onClose);
    ws.addEventListener("message", onMessage);
  };

  const disconnect = () => {
    if (!socket) return;
    try {
      socket.close();
    } catch (err) {
      setError(formatError(err));
      emit();
    }
  };

  const setText = (text: string) => {
    state.text = text;
    state.dirty = true;
    setError(null);
    emit();
  };

  const checkout = (baseVersionId: VersionId, text: string, opts2?: { force?: boolean }): CommitResult => {
    const force = opts2?.force === true;

    if (state.sending || inflight) {
      const error = "Cannot checkout while sending";
      setError(error);
      emit();
      return { ok: false, error };
    }

    if (state.dirty && !force) {
      const error = "Unsaved local changes";
      setError(error);
      emit();
      return { ok: false, error };
    }

    try {
      const parsed = parseXnl(text);

      if (parsed.nodes.length > 1) {
        const error = `expected 0 or 1 root node, got ${parsed.nodes.length}`;
        setError(error);
        emit();
        return { ok: false, error };
      }

      const baseRoot = baseNodes[0];
      if (baseRoot) {
        if (parsed.nodes.length === 0) {
          const error = "root node required";
          setError(error);
          emit();
          return { ok: false, error };
        }

        const baseTag = readTag(baseRoot);
        const desiredTag = readTag(parsed.nodes[0]);
        if (baseTag && desiredTag && baseTag !== desiredTag) {
          const error = `root tag locked to <${baseTag}>`;
          setError(error);
          emit();
          return { ok: false, error };
        }
      }

      const canonicalNodes = ensureMetadataIdsClone(parsed.nodes, `c_${state.clientId}:`);
      const canonicalText2 = XNL.stringify({ nodes: canonicalNodes });
      const canonicalParsed = parseXnl(canonicalText2);
      const displayText = XNL.stringify(canonicalParsed, { pretty: true, indent: 2 });

      pendingRemote = null;

      state.baseVersionId = baseVersionId;
      baseNodes = canonicalParsed.nodes;
      state.text = displayText;
      state.revLabel = baseVersionId;

      state.dirty = false;
      setError(null);
      emit();

      return { ok: true, canonicalText: displayText };
    } catch (err) {
      const error = formatError(err);
      setError(error);
      emit();
      return { ok: false, error };
    }
  };

  return {
    getState: () => ({ ...state }),
    subscribe: (listener) => {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    connect,
    disconnect,
    setText,
    checkout,
    commit,
  };
}
