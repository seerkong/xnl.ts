import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXnl, type DataElementNode, type XnlMutation } from "xnl-core";
import { describe, expect, it } from "vitest";
import { resolveHandler, xnlFileHandler } from "../src/handlers";
import { LocalFsVfsPersistence } from "../src/local-fs-persistence";
import { applyVfsSnapshotMutations, diffVfsSnapshots, type VfsMutation } from "../src/vfs-mutations";
import { VirtualFileSystem } from "../src/vfs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = path.join(TEST_DIR, "resources", "diff-apply-xnl");

type AssertionNode = {
  path: string;
  kind: "folder" | "file";
  id: string;
  fileType: string | null;
  content: string | null;
  owner: string | null;
};

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-vfs-diff-apply-xnl-"));
}

function rmTmpDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function loadSnapshot(workspaceRootPath: string): { snapshot: DataElementNode; warnings: string[]; dirty: boolean } {
  const persistence = new LocalFsVfsPersistence({ workspaceRootPath });
  return persistence.loadSnapshot();
}

function normalizeUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type PathItemLike = {
  type: string;
  value: string;
};

function escapeSingle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function pathItemsToDsl(pathItems: PathItemLike[]): string {
  let out = "";
  for (const item of pathItems) {
    if (item.type === "UniqueName") {
      out += `#${item.value}`;
      continue;
    }
    if (item.type === "MetadataSelector") {
      out += item.value;
      continue;
    }
    if (item.type === "InstanceProperty") {
      out += `:${item.value}`;
      continue;
    }
    if (item.type === "MapKey") {
      out += `::'${escapeSingle(item.value)}'`;
      continue;
    }
    if (item.type === "ListIndex") {
      out += `::${item.value}`;
      continue;
    }
    throw new Error(`Unsupported path item type: ${item.type}`);
  }
  return out;
}

function normalizeXnlMutationPaths<T>(mutations: T): T {
  if (!Array.isArray(mutations)) {
    return mutations;
  }
  return mutations.map((mutation) => {
    if (!mutation || typeof mutation !== "object") {
      return mutation;
    }
    const next = { ...(mutation as Record<string, unknown>) };
    if (Array.isArray(next.path)) {
      next.path = pathItemsToDsl(next.path as PathItemLike[]);
    }
    if (Array.isArray(next.pathBefore)) {
      next.pathBefore = pathItemsToDsl(next.pathBefore as PathItemLike[]);
    }
    return next;
  }) as T;
}

function normalizeMutationPayloadPaths<T>(mutations: T): T {
  if (!Array.isArray(mutations)) {
    return mutations;
  }
  return mutations.map((mutation) => {
    if (!mutation || typeof mutation !== "object") {
      return mutation;
    }
    const next = { ...(mutation as Record<string, unknown>) };
    const payload = next.payload;
    if (!payload || typeof payload !== "object") {
      return next;
    }
    const nextPayload = { ...(payload as Record<string, unknown>) };
    nextPayload.contentMutation = normalizeXnlMutationPaths(nextPayload.contentMutation);
    nextPayload.metadataMutation = normalizeXnlMutationPaths(nextPayload.metadataMutation);
    nextPayload.attributeMutation = normalizeXnlMutationPaths(nextPayload.attributeMutation);
    nextPayload.extendMutation = normalizeXnlMutationPaths(nextPayload.extendMutation);
    next.payload = nextPayload;
    return next;
  }) as T;
}

function withStableRootId(snapshot: DataElementNode): DataElementNode {
  const cloned = normalizeUndefined(snapshot);
  cloned.metadata = {
    ...(cloned.metadata ?? {}),
    id: "root_xnl",
  };
  return cloned;
}

function sortSnapshotByName(snapshot: DataElementNode): DataElementNode {
  const cloned = normalizeUndefined(snapshot);
  const walk = (node: DataElementNode) => {
    if (node.tag !== "folder") {
      return;
    }
    const children = (node.body ?? []).filter((child): child is DataElementNode => {
      return Boolean(child && typeof child === "object" && (child as DataElementNode).kind === "DataElement");
    });
    children.sort((a, b) => {
      const aName = typeof a.metadata?.name === "string" ? a.metadata.name : "";
      const bName = typeof b.metadata?.name === "string" ? b.metadata.name : "";
      if (aName !== bName) {
        return aName.localeCompare(bName);
      }
      const aId = typeof a.metadata?.id === "string" ? a.metadata.id : "";
      const bId = typeof b.metadata?.id === "string" ? b.metadata.id : "";
      return aId.localeCompare(bId);
    });
    node.body = children;
    for (const child of children) {
      walk(child);
    }
  };
  walk(cloned);
  return cloned;
}

function nodeId(node: DataElementNode): string {
  const id = node.metadata?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("Node metadata.id is required");
  }
  return id;
}

function collectAssertionNodes(snapshot: DataElementNode): AssertionNode[] {
  const out: AssertionNode[] = [];

  const walk = (node: DataElementNode, currentPath: string) => {
    if (node.tag !== "folder" && node.tag !== "file") {
      return;
    }

    if (currentPath !== "vfs:///") {
      const owner = node.attributes?.owner ?? node.metadata?.owner;
      const fileType = node.tag === "file" ? node.attributes?.fileType ?? node.metadata?.fileType : null;
      const content = node.tag === "file" ? node.attributes?.content : null;
      out.push({
        path: currentPath,
        kind: node.tag,
        id: nodeId(node),
        fileType: typeof fileType === "string" ? fileType : null,
        content: typeof content === "string" ? content : null,
        owner: typeof owner === "string" ? owner : null,
      });
    }

    if (node.tag === "folder") {
      for (const child of node.body ?? []) {
        if (!child || typeof child !== "object") {
          continue;
        }
        const item = child as DataElementNode;
        if (item.kind !== "DataElement") {
          continue;
        }
        const name = item.metadata?.name;
        if (typeof name !== "string" || !name) {
          continue;
        }
        const childPath = currentPath === "vfs:///" ? `vfs:///${name}` : `${currentPath}/${name}`;
        walk(item, childPath);
      }
    }
  };

  walk(snapshot, "vfs:///");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function assertXnlPayloadMutationApply(baseContent: string, contentMutation: XnlMutation[]): string {
  const applied = xnlFileHandler.apply(baseContent, contentMutation);
  expect(Array.isArray(parseXnl(applied).nodes)).toBe(true);
  return applied;
}

function assertParseableXnl(content: string | null): void {
  expect(content).not.toBeNull();
  const text = content as string;
  const parsed = parseXnl(text);
  expect(Array.isArray(parsed.nodes)).toBe(true);
}

describe("diff/apply xnl resources", () => {
  it("resolves xnl handler through registry", () => {
    expect(resolveHandler("xnl")).toBe(xnlFileHandler);
  });

  describe("type2 diff for xnl files", () => {
    const cases = ["case-xnl-update", "case-xnl-filetype-transition"];

    for (const caseName of cases) {
      it(caseName, () => {
        const caseDir = path.join(RESOURCES_DIR, "type2-diff", caseName);
        const fromWorkspace = path.join(caseDir, "from", "workspace");
        const toWorkspace = path.join(caseDir, "to", "workspace");

        const fromLoaded = loadSnapshot(fromWorkspace);
        const toLoaded = loadSnapshot(toWorkspace);
        expect(fromLoaded.warnings).toEqual([]);
        expect(fromLoaded.dirty).toBe(false);
        expect(toLoaded.warnings).toEqual([]);
        expect(toLoaded.dirty).toBe(false);

        const fromSnapshot = withStableRootId(fromLoaded.snapshot);
        const toSnapshot = withStableRootId(toLoaded.snapshot);
        const mutations = diffVfsSnapshots(fromSnapshot, toSnapshot);
        const expectedMutations = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.mutations.json"), "utf8")) as VfsMutation[];
        expect(normalizeMutationPayloadPaths(normalizeUndefined(mutations))).toEqual(
          normalizeMutationPayloadPaths(normalizeUndefined(expectedMutations)),
        );

        const fromVfs = new VirtualFileSystem(fromSnapshot);
        const toVfs = new VirtualFileSystem(toSnapshot);
        for (const mutation of mutations) {
          if (mutation.type !== "CONTENT_UPDATE") {
            continue;
          }
          if (mutation.payload?.fileType !== "xnl") {
            continue;
          }
          const contentMutation = mutation.payload?.contentMutation;
          expect(Array.isArray(contentMutation)).toBe(true);
          const baseContent = fromVfs.readFile(mutation.path);
          const appliedContent = assertXnlPayloadMutationApply(baseContent, contentMutation as XnlMutation[]);
          const nextContent = toVfs.readFile(mutation.path);
          expect(parseXnl(appliedContent).nodes).toEqual(parseXnl(nextContent).nodes);
        }

        const applied = applyVfsSnapshotMutations(fromSnapshot, mutations);
        expect(sortSnapshotByName(applied)).toEqual(sortSnapshotByName(toSnapshot));

        for (const node of collectAssertionNodes(applied)) {
          if (node.kind !== "file" || node.fileType !== "xnl") {
            continue;
          }
          assertParseableXnl(node.content);
        }
      });
    }
  });

  describe("type3 apply for xnl files", () => {
    const cases = ["case-xnl-apply", "case-xnl-rename"];

    for (const caseName of cases) {
      it(caseName, () => {
        const caseDir = path.join(RESOURCES_DIR, "type3-apply", caseName);
        const baseWorkspace = path.join(caseDir, "base", "workspace");

        const loadedBase = loadSnapshot(baseWorkspace);
        expect(loadedBase.warnings).toEqual([]);
        expect(loadedBase.dirty).toBe(false);

        const mutations = JSON.parse(fs.readFileSync(path.join(caseDir, "mutations.json"), "utf8")) as VfsMutation[];
        const expected = JSON.parse(fs.readFileSync(path.join(caseDir, "expected.assertions.json"), "utf8")) as { nodes: AssertionNode[] };

        const baseVfs = new VirtualFileSystem(loadedBase.snapshot);
        const expectedByPath = new Map(expected.nodes.filter((node) => node.kind === "file").map((node) => [node.path, node.content]));
        for (const mutation of mutations) {
          if (mutation.type !== "CONTENT_UPDATE") {
            continue;
          }
          if (mutation.payload?.fileType !== "xnl") {
            continue;
          }
          const contentMutation = mutation.payload?.contentMutation;
          expect(Array.isArray(contentMutation)).toBe(true);
          const baseContent = baseVfs.readFile(mutation.path);
          const appliedContent = assertXnlPayloadMutationApply(baseContent, contentMutation as XnlMutation[]);
          const expectedContent = expectedByPath.get(mutation.path);
          expect(expectedContent).not.toBeUndefined();
          expect(parseXnl(appliedContent).nodes).toEqual(parseXnl(String(expectedContent)).nodes);
        }

        const applied = applyVfsSnapshotMutations(loadedBase.snapshot, mutations);
        expect(collectAssertionNodes(applied)).toEqual(expected.nodes);

        for (const node of expected.nodes) {
          if (node.kind !== "file" || node.fileType !== "xnl") {
            continue;
          }
          assertParseableXnl(node.content);
        }

        const tmpRoot = mkTmpDir();
        const targetWorkspace = path.join(tmpRoot, "workspace");
        try {
          const persistence = new LocalFsVfsPersistence({ workspaceRootPath: targetWorkspace });
          persistence.saveSnapshot(applied);
          const reloaded = loadSnapshot(targetWorkspace);
          expect(reloaded.warnings).toEqual([]);
          expect(reloaded.dirty).toBe(false);
          expect(collectAssertionNodes(reloaded.snapshot)).toEqual(expected.nodes);
        } finally {
          rmTmpDir(tmpRoot);
        }
      });
    }
  });
});
