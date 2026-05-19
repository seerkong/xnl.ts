import { diffNodes, isWord, parseXnl, wordToString, type DataElementNode, XNL } from "xnl-core";
import {
  jsonParseMessage,
  jsonStringifyMessage,
  type ClientToServerMessage,
  type ServerToClientMessage,
  type VersionId,
} from "./shared-protocol";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { ulid } from "./id";

function nowId(): string {
  return ulid();
}

function wsUrl(): string {
  const port = process.env.PORT ?? "8787";
  return `ws://localhost:${port}/ws`;
}

function openWs(): WebSocket {
  return new WebSocket(wsUrl());
}

function isDataElement(node: any): node is DataElementNode {
  return node && node.kind === "DataElement";
}

function readMetaId(node: any): string | undefined {
  if (!isDataElement(node)) return undefined;
  const raw = (node as any).metadata?.id;
  if (typeof raw === "string") return raw;
  if (isWord(raw)) return wordToString(raw) ?? undefined;
  return undefined;
}

function hasMetaIds(text: string): boolean {
  const doc = parseXnl(text);
  return doc.nodes.some((n) => typeof readMetaId(n) === "string");
}

function loadPersistedHeadText(docId: string): string {
  const dataDir = join(import.meta.dir, "..", "data");
  const fp = join(dataDir, `${encodeURIComponent(docId)}.json`);
  const raw = readFileSync(fp, "utf8");
  const parsed = JSON.parse(raw) as { headVersionId: string; versions: Array<{ id: string; text: string }> };
  const head = parsed.versions.find((v) => v.id === parsed.headVersionId);
  return head?.text ?? "";
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    if (ws.readyState === WebSocket.CLOSED) {
      reject(new Error("ws closed before open"));
      return;
    }

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("ws error before open"));
    };

    const t = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for open"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(t);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
  });
}

function waitForMessage(
  ws: WebSocket,
  pred: (msg: ServerToClientMessage) => boolean,
  timeoutMs: number
): Promise<ServerToClientMessage> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);

    const onMessage = (ev: MessageEvent) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      const msg = jsonParseMessage<ServerToClientMessage>(data);
      if (!msg) return;
      if (!pred(msg)) return;

      ws.removeEventListener("message", onMessage);
      clearTimeout(t);
      resolve(msg);
    };

    ws.addEventListener("message", onMessage);
  });
}

async function main() {
  const clientId1 = `c1_${nowId()}`;
  const clientId2 = `c2_${nowId()}`;
  const docId = "default";

  const ws1 = openWs();
  const ws2 = openWs();

  await new Promise((r) => setTimeout(r, 200));

  await Promise.all([waitForOpen(ws1, 2000), waitForOpen(ws2, 2000)]);

  const connect1: ClientToServerMessage = { type: "connect", docId, clientId: clientId1, protocolVersion: 2 };
  const connect2: ClientToServerMessage = { type: "connect", docId, clientId: clientId2, protocolVersion: 2 };

  const state1P = waitForMessage(ws1, (m) => m.type === "doc_state" && m.docId === docId, 2000);
  const state2P = waitForMessage(ws2, (m) => m.type === "doc_state" && m.docId === docId, 2000);

  ws1.send(jsonStringifyMessage(connect1));
  ws2.send(jsonStringifyMessage(connect2));

  const state1 = await state1P;
  const state2 = await state2P;

  if (state1.type !== "doc_state" || state2.type !== "doc_state") throw new Error("expected doc_state");
  if (state1.headVersionId !== state2.headVersionId || state1.headText !== state2.headText) {
    throw new Error("doc_state differs");
  }

  const baseVersionId: VersionId = state1.headVersionId;
  const baseNodes = parseXnl(state1.headText).nodes;

  const desiredText = "<a>";
  const desiredNodes = parseXnl(desiredText).nodes;
  const mutations = diffNodes(baseNodes, desiredNodes, []);

  const opId = `op_1_${nowId()}`;
  const op: ClientToServerMessage = {
    type: "op",
    docId,
    clientId: clientId1,
    opId,
    baseVersionId,
    mutations,
  };

  ws1.send(jsonStringifyMessage(op));

  const ack = await waitForMessage(
    ws1,
    (m) => m.type === "ack" && m.docId === docId && m.clientId === clientId1 && m.opId === opId,
    2000
  );
  if (ack.type !== "ack") throw new Error("expected ack");

  const update = await waitForMessage(ws2, (m) => m.type === "graph_update" && m.docId === docId, 2000);
  if (update.type !== "graph_update") throw new Error("expected graph_update");

  const ws3 = openWs();
  await waitForOpen(ws3, 2000);
  const clientId3 = `c3_${nowId()}`;
  ws3.send(jsonStringifyMessage({ type: "connect", docId, clientId: clientId3, protocolVersion: 2 }));
  const state3 = await waitForMessage(ws3, (m) => m.type === "doc_state" && m.docId === docId, 2000);
  if (state3.type !== "doc_state") throw new Error("expected doc_state");

  const finalText = XNL.stringify(parseXnl(state3.headText));
  const persistedText = loadPersistedHeadText(docId);

  if (!hasMetaIds(finalText)) {
    throw new Error(`expected final headText to contain metadata.id, got '${finalText}'`);
  }

  if (XNL.stringify(parseXnl(persistedText)) !== finalText) {
    throw new Error(`expected persisted headText to match, got '${XNL.stringify(parseXnl(persistedText))}'`);
  }

  console.log("OK");

  ws1.close();
  ws2.close();
  ws3.close();
}

await main();
