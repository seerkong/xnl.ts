import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXnl, type DataElementNode, type XnlMutation, type XnlNode } from "xnl-core";
import {
  VirtualFileSystem,
  applyVfsSnapshotMutations,
  folderChildren,
  isFile,
  isFolder,
  normalizeVfsPath,
  readFileContent,
  readFileType,
  readMetadataId,
  readName,
  type VfsMutation,
} from "xnl-vfs";
import { describe, expect, it } from "vitest";
import { LocalFsVfsPersistence } from "xnl-vfs/local-fs-persistence";
import { LocalFsRepositoryBackend } from "../src/local-fs-backend";
import { Repository } from "../src/repository";

type ExpectedWorkspaceNode = {
  path: string;
  kind: "file" | "folder";
  id: string;
  fileType?: string;
  content?: string;
  metaOwner?: string;
  extendColor?: string;
};

type ExpectedVcs = {
  branch: string;
  clean: boolean;
  logHeadMessage: string;
  logCount: number;
  minObjectCount: number;
};

type FixtureSimulationMode = {
  shadowSidecar?: boolean;
  sparseSidecar?: boolean;
  shadowVcs?: boolean;
};

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xnl-fixture-sim-"));
}

function rmTmpDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function asDataElement(node: XnlNode | undefined): DataElementNode | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const value = node as DataElementNode;
  return value.kind === "DataElement" ? value : undefined;
}

function parseRootByTag(filePath: string, tag: string): DataElementNode {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = parseXnl(raw);
  const root = doc.nodes.find((node) => {
    const element = asDataElement(node as XnlNode);
    return element?.tag === tag;
  });
  const element = asDataElement(root as XnlNode);
  if (!element) {
    throw new Error(`Expected <${tag}> root in ${filePath}`);
  }
  return element;
}

function readStringMeta(node: DataElementNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberMeta(node: DataElementNode, key: string): number | undefined {
  const value = node.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function readBooleanMeta(node: DataElementNode, key: string): boolean | undefined {
  const value = node.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function parseMutationBatch(filePath: string): VfsMutation[] {
  const root = parseRootByTag(filePath, "MutationBatch");
  const out: VfsMutation[] = [];

  for (const child of root.body ?? []) {
    const mutation = asDataElement(child as XnlNode);
    if (!mutation || mutation.tag !== "Mutation") {
      continue;
    }

    const type = readStringMeta(mutation, "type") as VfsMutation["type"] | undefined;
    const pathValue = readStringMeta(mutation, "path");
    if (!type || !pathValue) {
      continue;
    }

    const payload: NonNullable<VfsMutation["payload"]> = {};
    const content = readStringMeta(mutation, "content");
    const fileType = readStringMeta(mutation, "fileType");
    const metaOwner = readStringMeta(mutation, "metaOwner");
    const extendColor = readStringMeta(mutation, "extendColor");

    if (content !== undefined) {
      payload.content = content;
    }
    if (fileType === "text" || fileType === "xnl" || fileType === "binary") {
      payload.fileType = fileType;
    }
    if (metaOwner !== undefined) {
      const ownerMutation: XnlMutation = {
        type: "OBJECT_UPDATE",
        path: ":attributes::'owner'",
        valueAfter: metaOwner,
      };
      payload.attributeMutation = [ownerMutation];
    }
    if (extendColor !== undefined) {
      payload.extendMutation = [
        {
          type: "OBJECT_UPDATE",
          path: ":extend",
          valueAfter: {
            order: ["ViewExt"],
            children: {
              ViewExt: {
                kind: "DataElement",
                tag: "ViewExt",
                metadata: {
                  color: extendColor,
                },
              },
            },
          },
        },
      ];
    }

    out.push({
      type,
      path: pathValue,
      targetPath: readStringMeta(mutation, "targetPath"),
      expectedId: readStringMeta(mutation, "expectedId"),
      payload: Object.keys(payload).length > 0 ? payload : undefined,
    });
  }

  return out;
}

function expectedWorkspaceFromFile(filePath: string): ExpectedWorkspaceNode[] {
  const root = parseRootByTag(filePath, "ExpectedWorkspace");
  const nodes: ExpectedWorkspaceNode[] = [];
  for (const child of root.body ?? []) {
    const node = asDataElement(child as XnlNode);
    if (!node || node.tag !== "Node") {
      continue;
    }
    const pathValue = readStringMeta(node, "path");
    const kind = readStringMeta(node, "kind");
    const id = readStringMeta(node, "id");
    if (!pathValue || !id || (kind !== "file" && kind !== "folder")) {
      continue;
    }
    const record: ExpectedWorkspaceNode = {
      path: pathValue,
      kind,
      id,
    };

    const fileType = readStringMeta(node, "fileType");
    if (fileType !== undefined) {
      record.fileType = fileType;
    }
    const content = readStringMeta(node, "content");
    if (content !== undefined) {
      record.content = content;
    }
    const metaOwner = readStringMeta(node, "metaOwner");
    if (metaOwner !== undefined) {
      record.metaOwner = metaOwner;
    }
    const extendColor = readStringMeta(node, "extendColor");
    if (extendColor !== undefined) {
      record.extendColor = extendColor;
    }

    nodes.push(record);
  }
  return nodes.sort((a, b) => a.path.localeCompare(b.path));
}

function expectedVcsFromFile(filePath: string): ExpectedVcs {
  const root = parseRootByTag(filePath, "ExpectedVcs");
  const branch = readStringMeta(root, "branch") ?? "main";
  const clean = readBooleanMeta(root, "clean") ?? true;
  const logHeadMessage = readStringMeta(root, "logHeadMessage") ?? "";
  const logCount = readNumberMeta(root, "logCount") ?? 0;
  const minObjectCount = readNumberMeta(root, "minObjectCount") ?? 0;
  return { branch, clean, logHeadMessage, logCount, minObjectCount };
}

function readExtendColor(node: DataElementNode): string | undefined {
  const extend = node.extend as
    | {
        children?: {
          ViewExt?: {
            kind?: string;
            metadata?: Record<string, unknown>;
          };
        };
      }
    | undefined;
  const color = extend?.children?.ViewExt?.metadata?.color;
  return typeof color === "string" ? color : undefined;
}

function collectWorkspaceNodes(snapshot: DataElementNode): ExpectedWorkspaceNode[] {
  const out: ExpectedWorkspaceNode[] = [];

  const walk = (node: DataElementNode, currentPath: string): void => {
    for (const child of folderChildren(node)) {
      const childPath = normalizeVfsPath(`${currentPath}/${readName(child)}`);
      const ownerFromAttributes = typeof child.attributes?.owner === "string" ? child.attributes.owner : undefined;
      const ownerFromMetadata = typeof child.metadata?.owner === "string" ? child.metadata.owner : undefined;
      const owner = ownerFromAttributes ?? ownerFromMetadata;
      const base: ExpectedWorkspaceNode = {
        path: childPath,
        kind: isFolder(child) ? "folder" : "file",
        id: readMetadataId(child),
      };

      if (owner !== undefined) {
        base.metaOwner = owner;
      }
      const color = readExtendColor(child);
      if (color !== undefined) {
        base.extendColor = color;
      }

      if (isFile(child)) {
        base.fileType = readFileType(child);
        base.content = readFileContent(child);
      }

      out.push(base);

      if (isFolder(child)) {
        walk(child, childPath);
      }
    }
  };

  walk(snapshot, "vfs:///");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function assertExpectedWorkspace(snapshot: DataElementNode, expectedFilePath: string): void {
  const expected = expectedWorkspaceFromFile(expectedFilePath);
  const actual = collectWorkspaceNodes(snapshot);
  expect(actual).toEqual(expected);
}

function assertExpectedVcs(repo: Repository, backend: LocalFsRepositoryBackend, expectedFilePath: string): void {
  const expected = expectedVcsFromFile(expectedFilePath);
  const head = repo.getHead();
  expect(head).toEqual({ type: "branch", name: expected.branch });

  const status = repo.status();
  expect(status.clean).toBe(expected.clean);

  const logs = repo.log(200);
  expect(logs.length).toBe(expected.logCount);
  expect(logs[0]?.message ?? "").toBe(expected.logHeadMessage);

  const objectCount = backend.objectStore.list().length;
  expect(objectCount).toBeGreaterThanOrEqual(expected.minObjectCount);

  const report = backend.checkIntegrity();
  expect(report.brokenRefs).toEqual([]);
}

function sortedSubdirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function prepareWorkspaceFromFixture(caseDir: string): string {
  const workspace = mkTmpDir();

  const initialWorkspace = path.join(caseDir, "00-initial", "workspace");
  if (fs.existsSync(initialWorkspace)) {
    fs.cpSync(initialWorkspace, workspace, { recursive: true });
  }

  const initialVcs = path.join(caseDir, "00-initial", "vcs");
  if (fs.existsSync(initialVcs)) {
    fs.cpSync(initialVcs, path.join(workspace, ".xnl-vcs"), { recursive: true });
  }

  return workspace;
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function migrateNodeMetaToShadowRoot(workspace: string, shadowRoot: string): void {
  const walk = (dirPath: string): void => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === ".xnl-vcs") {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      if (entry.name === ".node-meta") {
        const relativeOwner = path.relative(workspace, dirPath);
        const mappedOwner = relativeOwner === "" ? "root" : path.join("tree", relativeOwner);
        copyDirectoryContents(entryPath, path.join(shadowRoot, mappedOwner));
        fs.rmSync(entryPath, { recursive: true, force: true });
        continue;
      }

      walk(entryPath);
    }
  };

  walk(workspace);
}

function migrateVcsToShadowRoot(workspace: string, shadowRoot: string): void {
  const workspaceVcsDir = path.join(workspace, ".xnl-vcs");
  if (!fs.existsSync(workspaceVcsDir)) {
    return;
  }
  copyDirectoryContents(workspaceVcsDir, path.join(shadowRoot, ".xnl-vcs"));
  fs.rmSync(workspaceVcsDir, { recursive: true, force: true });
}

function runFixtureCase(caseDir: string, mode: FixtureSimulationMode = {}): void {
  const workspace = prepareWorkspaceFromFixture(caseDir);
  const cleanupDirs = [workspace];
  const nodeMetaStorageRootPath = mode.shadowSidecar ? mkTmpDir() : undefined;
  const vcsStorageRootPath = mode.shadowVcs ? mkTmpDir() : undefined;

  if (nodeMetaStorageRootPath) {
    cleanupDirs.push(nodeMetaStorageRootPath);
    migrateNodeMetaToShadowRoot(workspace, nodeMetaStorageRootPath);
  }
  if (vcsStorageRootPath) {
    cleanupDirs.push(vcsStorageRootPath);
    migrateVcsToShadowRoot(workspace, vcsStorageRootPath);
  }

  try {
    const persistence = new LocalFsVfsPersistence({
      workspaceRootPath: workspace,
      nodeMetaStorageRootPath,
      skipSidecarWhenNoExtensionMetadata: mode.sparseSidecar,
      vcsStorageRootPath,
    });
    const loaded = persistence.loadSnapshot();
    const vfs = new VirtualFileSystem(loaded.snapshot, {
      reservedNames: persistence.getReservedNames(),
    });
    const backend = new LocalFsRepositoryBackend({ workspaceRootPath: workspace, vcsStorageRootPath });
    const repo = new Repository({ vfs, backend });

    repo.init("main");
    repo.commit("initial", { author: "fixture" });

    const roundsRoot = path.join(caseDir, "rounds");
    const rounds = sortedSubdirs(roundsRoot);
    expect(rounds.length).toBeGreaterThan(0);

    for (const round of rounds) {
      const roundDir = path.join(roundsRoot, round);
      const applyFile = path.join(roundDir, "apply.mutations.xnl");
      const expectedWorkspace = path.join(roundDir, "expected-workspace.xnl");
      const expectedVcs = path.join(roundDir, "expected-vcs.xnl");

      const mutations = parseMutationBatch(applyFile);
      const mutationOptions = mode.sparseSidecar
        ? { skipSidecarWhenNoExtensionMetadata: true }
        : undefined;
      const next = applyVfsSnapshotMutations(repo.vfs.getSnapshot(), mutations, mutationOptions);
      repo.vfs.loadSnapshot(next);

      persistence.saveFromVfs(repo.vfs);
      repo.commit(`round-${round}`, { author: "fixture" });

      assertExpectedWorkspace(repo.vfs.getSnapshot(), expectedWorkspace);
      assertExpectedVcs(repo, backend, expectedVcs);
    }

    const finalExpectedWorkspace = path.join(caseDir, "99-final", "expected-workspace.xnl");
    const finalExpectedVcs = path.join(caseDir, "99-final", "expected-vcs.xnl");
    assertExpectedWorkspace(repo.vfs.getSnapshot(), finalExpectedWorkspace);
    assertExpectedVcs(repo, backend, finalExpectedVcs);
  } finally {
    for (const dirPath of cleanupDirs) {
      rmTmpDir(dirPath);
    }
  }
}

describe("local-fs fixture simulation", () => {
  it("applies multi-round .xnl fixtures and matches expected workspace/vcs states", () => {
    const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "local-fs");
    const cases = sortedSubdirs(fixturesRoot);
    expect(cases.length).toBeGreaterThanOrEqual(3);

    for (const caseName of cases) {
      const caseDir = path.join(fixturesRoot, caseName);
      runFixtureCase(caseDir);
    }
  });

  it("covers shadow-sidecar, sparse-sidecar, and shadow vcs root modes", () => {
    const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "local-fs");
    const caseDir = path.join(fixturesRoot, "case-01-create-update");
    expect(fs.existsSync(caseDir)).toBe(true);
    expect(sortedSubdirs(path.join(caseDir, "rounds")).length).toBeGreaterThan(1);

    runFixtureCase(caseDir, { shadowSidecar: true });
    runFixtureCase(caseDir, { sparseSidecar: true });
    runFixtureCase(caseDir, { shadowVcs: true });
    runFixtureCase(caseDir, { shadowSidecar: true, sparseSidecar: true, shadowVcs: true });
  });
});
