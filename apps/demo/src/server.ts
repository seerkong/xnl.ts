import { join } from "node:path";
import { createRealtimeBunServer, type RealtimeWSData } from "@braid-demo/realtime-server-bun";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const DATA_DIR = join(import.meta.dir, "..", "data");

const realtime = createRealtimeBunServer({ dataDir: DATA_DIR });

const server = Bun.serve<RealtimeWSData>({
  port: PORT,
  async fetch(req: Request, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const ok = serverInstance.upgrade(req, { data: { client: null } });
      return ok ? new Response(null) : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/version") {
      const docId = url.searchParams.get("docId") ?? "";
      const versionId = url.searchParams.get("versionId") ?? "";
      if (!docId || !versionId) {
        return new Response("Missing docId or versionId", { status: 400 });
      }

      const text = realtime.getVersionText(docId, versionId);
      if (text === null) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(JSON.stringify({ docId, versionId, text }), {
        headers: { "content-type": "application/json" },
      });
    }

    const relPath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = join(PUBLIC_DIR, relPath);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    return new Response(file);
  },
  websocket: {
    open(ws) {
      realtime.websocket.open(ws);
    },
    message(ws, message) {
      realtime.websocket.message(ws, message);
    },
    close(ws) {
      realtime.websocket.close(ws);
    },
  },
});

console.log(`braid-demo server listening on http://localhost:${server.port}`);
