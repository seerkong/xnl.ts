import { Elysia } from "elysia";
import {
  createCollabServer,
  jsonStringifyMessage,
  type CollabServer,
  type ConnectionData,
  type ServerToClientMessage,
  type VersionId,
} from "xnl-collab-server";

export type RealtimeClientIdentity = {
  clientId: string;
  docId: string;
};

export type RealtimeElysiaOptions = {
  dataDir: string;
};

export type RealtimeElysiaServer = {
  plugin: ReturnType<typeof createElysiaPlugin>;
  getVersionText(docId: string, versionId: VersionId): string | null;
};

function createElysiaPlugin(server: CollabServer) {
  const connectionDataMap = new Map<string, ConnectionData>();
  const wsMap = new Map<string, { send: (data: string) => void }>();

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

  return new Elysia()
    .ws("/ws", {
      open(ws) {
        const connectionId = ws.id;
        const connData = server.handleOpen();

        connectionDataMap.set(connectionId, connData);
        wsMap.set(connectionId, ws);
      },

      close(ws) {
        const connectionId = ws.id;

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
        const connectionId = ws.id;

        const connData = connectionDataMap.get(connectionId);
        if (!connData) {
          ws.send(jsonStringifyMessage({ type: "error", message: "Connection data not found" }));
          return;
        }

        const messageData = typeof message === "string" ? message : JSON.stringify(message);
        const previousDocId = connData.client?.docId;
        const result = server.handleMessage(connData, messageData);

        const newDocId = connData.client?.docId;
        if (newDocId && newDocId !== previousDocId) {
          if (previousDocId) {
            server.unregisterConnection(previousDocId, connectionId);
          }
          server.registerConnection(newDocId, connectionId);
        }

        for (const msg of result.reply) {
          ws.send(jsonStringifyMessage(msg));
        }

        for (const { docId, message: msg } of result.broadcast) {
          broadcast(docId, msg);
        }
      },
    });
}

export function createRealtimeElysiaServer(opts: RealtimeElysiaOptions): RealtimeElysiaServer {
  const server: CollabServer = createCollabServer({ dataDir: opts.dataDir });
  const plugin = createElysiaPlugin(server);

  const getVersionText = (docId: string, versionId: VersionId): string | null => {
    return server.getVersionText(docId, versionId);
  };

  return { plugin, getVersionText };
}

export type { VersionId } from "xnl-collab-server";
