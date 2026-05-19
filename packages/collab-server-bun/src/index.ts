import {
  createCollabServer,
  jsonStringifyMessage,
  type CollabServer,
  type ConnectionData,
  type ServerToClientMessage,
  type VersionId,
} from "xnl-collab-server";

type WebSocketLike<T> = {
  data: T;
  send(data: string): void;
};

export type RealtimeClientIdentity = {
  clientId: string;
  docId: string;
};

export type RealtimeWSData = {
  client: RealtimeClientIdentity | null;
  connectionId?: string;
};

export type RealtimeBunOptions = {
  dataDir: string;
};

export type RealtimeBunWebsocketHandlers = {
  open(ws: WebSocketLike<RealtimeWSData>): void;
  message(ws: WebSocketLike<RealtimeWSData>, message: string | ArrayBuffer | Uint8Array): void;
  close(ws: WebSocketLike<RealtimeWSData>): void;
};

export type RealtimeBunServer = {
  websocket: RealtimeBunWebsocketHandlers;
  getVersionText(docId: string, versionId: VersionId): string | null;
};

let connectionCounter = 0;

function generateConnectionId(): string {
  return `conn_${Date.now()}_${++connectionCounter}`;
}

export function createRealtimeBunServer(opts: RealtimeBunOptions): RealtimeBunServer {
  const server: CollabServer = createCollabServer({ dataDir: opts.dataDir });
  const connectionDataMap = new Map<string, ConnectionData>();
  const wsMap = new Map<string, WebSocketLike<RealtimeWSData>>();

  const wsSend = (ws: WebSocketLike<RealtimeWSData>, msg: ServerToClientMessage): void => {
    ws.send(jsonStringifyMessage(msg));
  };

  const broadcast = (docId: string, msg: ServerToClientMessage): void => {
    const data = jsonStringifyMessage(msg);
    const connectionIds = server.getConnectionsForDoc(docId);
    for (const connId of connectionIds) {
      const ws = wsMap.get(connId);
      if (ws) {
        ws.send(data);
      }
    }
  };

  const websocket: RealtimeBunWebsocketHandlers = {
    open(ws) {
      const connectionId = generateConnectionId();
      const connData = server.handleOpen();

      ws.data = {
        client: null,
        connectionId,
      };

      connectionDataMap.set(connectionId, connData);
      wsMap.set(connectionId, ws);
    },

    close(ws) {
      const connectionId = ws.data?.connectionId;
      if (!connectionId) return;

      const connData = connectionDataMap.get(connectionId);
      if (connData) {
        server.handleClose(connData);

        const docId = connData.client?.docId;
        if (docId) {
          server.unregisterConnection(docId, connectionId);
        }
      }

      connectionDataMap.delete(connectionId);
      wsMap.delete(connectionId);
    },

    message(ws, message) {
      const connectionId = ws.data?.connectionId;
      if (!connectionId) {
        wsSend(ws, { type: "error", message: "Connection not initialized" });
        return;
      }

      const connData = connectionDataMap.get(connectionId);
      if (!connData) {
        wsSend(ws, { type: "error", message: "Connection data not found" });
        return;
      }

      const previousDocId = connData.client?.docId;
      const result = server.handleMessage(connData, message);

      const newDocId = connData.client?.docId;
      if (newDocId && newDocId !== previousDocId) {
        if (previousDocId) {
          server.unregisterConnection(previousDocId, connectionId);
        }
        server.registerConnection(newDocId, connectionId);
        ws.data.client = connData.client;
      }

      for (const msg of result.reply) {
        wsSend(ws, msg);
      }

      for (const { docId, message: msg } of result.broadcast) {
        broadcast(docId, msg);
      }
    },
  };

  const getVersionText = (docId: string, versionId: VersionId): string | null => {
    return server.getVersionText(docId, versionId);
  };

  return { websocket, getVersionText };
}

export type { VersionId } from "xnl-collab-server";
