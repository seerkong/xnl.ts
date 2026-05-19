import { join } from "node:path";
import { Elysia } from "elysia";
import { createRealtimeElysiaServer } from "xnl-collab-server-elysia";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const DATA_DIR = join(import.meta.dir, "..", "data");

const realtime = createRealtimeElysiaServer({ dataDir: DATA_DIR });

const app = new Elysia()
  .use(realtime.plugin)
  .get("/api/version", ({ query }) => {
    const docId = query.docId ?? "";
    const versionId = query.versionId ?? "";
    if (!docId || !versionId) {
      return new Response("Missing docId or versionId", { status: 400 });
    }

    const text = realtime.getVersionText(docId, versionId);
    if (text === null) {
      return new Response("Not found", { status: 404 });
    }

    return { docId, versionId, text };
  })
  .get("/*", async ({ path }) => {
    const relPath = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    const filePath = join(PUBLIC_DIR, relPath);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  })
  .listen(PORT);

console.log(`xnl-collab-demo (elysia) server listening on http://localhost:${app.server?.port}`);
