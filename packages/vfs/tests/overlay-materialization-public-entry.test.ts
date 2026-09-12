import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import type { DataElementNode } from "xnl-core";
import { describe, expect, it } from "vitest";
import { planVfsOverlays as planFromRoot } from "xnl-vfs";
import {
  planVfsOverlays,
  type VfsOverlayIntent,
  type VfsOverlayPlan,
} from "xnl-vfs/overlay-materialization";

const DIST_ROOT = path.resolve(import.meta.dirname, "../dist");
const require = createRequire(import.meta.url);
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((name) => {
    const bare = name.replace(/^node:/, "");
    return [bare, `node:${bare}`];
  }),
);

function fixtureSnapshot(): DataElementNode {
  return {
    kind: "DataElement",
    tag: "folder",
    metadata: { id: "public-root", name: "project" },
    attributes: { nodeType: "folder" },
    body: [],
  };
}

function moduleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function resolveLocalModule(fromFile: string, specifier: string): string {
  const direct = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [direct, `${direct}.js`, `${direct}.cjs`];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Emitted local import ${specifier} from ${fromFile} does not resolve`);
  }
  return resolved;
}

function scanReachableEmittedModules(entryFile: string): { files: string[]; nodeBuiltins: string[] } {
  const pending = [entryFile];
  const visited = new Set<string>();
  const nodeBuiltins = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = readFileSync(current, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (NODE_BUILTINS.has(specifier)) {
        nodeBuiltins.add(specifier);
      } else if (specifier.startsWith(".")) {
        pending.push(resolveLocalModule(current, specifier));
      }
    }
  }

  return {
    files: [...visited].sort(),
    nodeBuiltins: [...nodeBuiltins].sort(),
  };
}

describe("overlay materialization public package entry", () => {
  it("exports the same planner from the package root and dedicated subpath with public types", () => {
    const overlays: VfsOverlayIntent[] = [];
    const result = planVfsOverlays(fixtureSnapshot(), overlays);

    expect(planFromRoot).toBe(planVfsOverlays);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const plan: VfsOverlayPlan = result.plan;
    expect(plan).toMatchObject({
      candidate: fixtureSnapshot(),
      mutations: [],
      xnlMutations: [],
      overlays: [],
    });

    const cjsEntry = require("xnl-vfs/overlay-materialization") as typeof import("xnl-vfs/overlay-materialization");
    expect(cjsEntry.planVfsOverlays(fixtureSnapshot(), [])).toMatchObject({
      status: "planned",
      plan: { mutations: [], xnlMutations: [], overlays: [] },
    });
  });

  it.each(["overlay-materialization.js", "overlay-materialization.cjs"])(
    "keeps the emitted %s transitive graph free of Node builtins",
    (entryName) => {
      const entryFile = path.join(DIST_ROOT, entryName);
      expect(existsSync(entryFile)).toBe(true);

      const graph = scanReachableEmittedModules(entryFile);
      expect(graph.files).toContain(entryFile);
      expect(graph.nodeBuiltins).toEqual([]);
    },
  );
});
