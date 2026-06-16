import { XNL, parseXnl, type DataElementNode, type TextElementNode, type XnlNode } from "xnl-core";
import fs from "node:fs";
import path from "node:path";
import { VcsError } from "./errors";
import { canonicalizeObject, sha256Hex, type ObjectId } from "./hash";
import type { ObjectStore } from "./object-store";
import { makeContentRecord, type ContentRecord, type ContentStore } from "./content-store";
import type { ContentKey, ContentType, VcsObject } from "./types";
import type { HeadState, PersistedCommitInfo, RepositoryBackend, WorkspaceState } from "./repository-backend";

function ensureDirSync(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isDataElement(node: XnlNode | undefined): node is DataElementNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement");
}

function isTextElement(node: XnlNode | undefined): node is TextElementNode {
  return Boolean(node && typeof node === "object" && (node as TextElementNode).kind === "TextElement");
}

function firstDataElementByTag(docNodes: XnlNode[], tag: string): DataElementNode | null {
  for (const node of docNodes) {
    if (isDataElement(node) && node.tag === tag) {
      return node;
    }
  }
  return null;
}

function readStringMeta(node: DataElementNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNullableObjectId(node: DataElementNode, key: string): ObjectId | null {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function safeReadFileSync(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function writeFileAtomicSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  ensureDirSync(dir);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function sanitizeLockName(value: string): string {
  return value.replace(/[\\/]/g, "_");
}

function acquireLockSync(lockPath: string): () => void {
  ensureDirSync(path.dirname(lockPath));
  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      const payload = JSON.stringify({ pid: process.pid, ts: Date.now() });
      fs.writeFileSync(fd, payload, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new VcsError("ELOCKED", `Lock exists: ${lockPath}`);
    }
    throw err;
  }

  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  };
}

function objectKind(object: VcsObject): "blob" | "tree" | "commit" | "tag" {
  return object.type;
}

function objectPath(rootDir: string, kind: string, objectId: ObjectId): string {
  const prefix = objectId.slice(0, 2);
  return path.join(rootDir, "objects", kind, prefix, `${objectId}.xnl`);
}

function contentPath(rootDir: string, contentKey: ContentKey): string {
  const prefix = contentKey.slice(0, 2);
  return path.join(rootDir, "contents", prefix, `${contentKey}.xnl`);
}

function asContentType(value: unknown): ContentType {
  return value === "xnl" || value === "binary" || value === "text" ? value : "text";
}

function parseSingleRoot(input: string, expectedTag: string): DataElementNode {
  const doc = parseXnl(input);
  const root = firstDataElementByTag(doc.nodes as XnlNode[], expectedTag);
  if (!root) {
    throw new VcsError("EINVAL", `Expected <${expectedTag}> root element`);
  }
  return root;
}

function stringifyNode(node: DataElementNode): string {
  return XNL.stringify(node, { pretty: true, indent: 2 });
}

export class LocalFsObjectStore implements ObjectStore {
  private readonly vcsDir: string;

  constructor(options: { workspaceRootPath: string; vcsDirName?: string; vcsStorageRootPath?: string }) {
    const vcsRoot = options.vcsStorageRootPath ?? options.workspaceRootPath;
    this.vcsDir = path.join(vcsRoot, options.vcsDirName ?? ".xnl-vcs");
  }

  put(object: VcsObject): ObjectId {
    const { canonical, hash } = canonicalizeObject(object);
    const kind = objectKind(object);
    const targetPath = objectPath(this.vcsDir, kind, hash);

    if (fs.existsSync(targetPath)) {
      return hash;
    }

    const node: DataElementNode = {
      kind: "DataElement",
      tag: "VcsObject",
      metadata: {
        id: hash,
        kind,
      },
      body: [
        {
          kind: "TextElement",
          tag: "Json",
          metadata: {
            encoding: "utf8",
          },
          text: canonical,
          textMarker: "",
        },
      ],
    };

    writeFileAtomicSync(targetPath, stringifyNode(node));
    return hash;
  }

  get<T extends VcsObject = VcsObject>(id: ObjectId): T | null {
    // Probe likely locations by checking known kinds.
    const kinds: Array<"blob" | "tree" | "commit" | "tag"> = ["blob", "tree", "commit", "tag"];
    for (const kind of kinds) {
      const filePath = objectPath(this.vcsDir, kind, id);
      const raw = safeReadFileSync(filePath);
      if (!raw) continue;
      const root = parseSingleRoot(raw, "VcsObject");
      const jsonNode = (root.body ?? []).find((n) => isTextElement(n as XnlNode) && (n as TextElementNode).tag === "Json") as
        | TextElementNode
        | undefined;
      const canonical = typeof jsonNode?.text === "string" ? jsonNode.text : "";
      try {
        return JSON.parse(canonical) as T;
      } catch {
        throw new VcsError("EINVAL", `Malformed object JSON for ${id}`);
      }
    }
    return null;
  }

  has(id: ObjectId): boolean {
    const kinds: Array<"blob" | "tree" | "commit" | "tag"> = ["blob", "tree", "commit", "tag"];
    for (const kind of kinds) {
      const filePath = objectPath(this.vcsDir, kind, id);
      if (fs.existsSync(filePath)) {
        return true;
      }
    }
    return false;
  }

  list(): ObjectId[] {
    const objectsDir = path.join(this.vcsDir, "objects");
    if (!fs.existsSync(objectsDir)) {
      return [];
    }

    const out: string[] = [];
    const kinds = ["blob", "tree", "commit", "tag"];
    for (const kind of kinds) {
      const kindDir = path.join(objectsDir, kind);
      if (!fs.existsSync(kindDir)) continue;
      const prefixes = fs.readdirSync(kindDir, { withFileTypes: true });
      for (const prefix of prefixes) {
        if (!prefix.isDirectory()) continue;
        const dir = path.join(kindDir, prefix.name);
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile()) continue;
          if (!file.name.endsWith(".xnl")) continue;
          out.push(file.name.slice(0, -".xnl".length));
        }
      }
    }

    return out.sort((a, b) => a.localeCompare(b));
  }
}

/** Content store backed by the local filesystem (blob content separated from objects, on disk). */
export class LocalFsContentStore implements ContentStore {
  private readonly vcsDir: string;

  constructor(options: { workspaceRootPath: string; vcsDirName?: string; vcsStorageRootPath?: string }) {
    const vcsRoot = options.vcsStorageRootPath ?? options.workspaceRootPath;
    this.vcsDir = path.join(vcsRoot, options.vcsDirName ?? ".xnl-vcs");
  }

  put(content: string, contentType: ContentType): ContentKey {
    const record = makeContentRecord(content, contentType);
    const targetPath = contentPath(this.vcsDir, record.contentKey);
    if (fs.existsSync(targetPath)) {
      return record.contentKey;
    }
    const node: DataElementNode = {
      kind: "DataElement",
      tag: "VcsContent",
      metadata: {
        contentKey: record.contentKey,
        contentType: record.contentType,
        encoding: record.encoding,
        hash: `sha256:${record.contentHash}`,
        sizeBytes: record.sizeBytes,
      },
      body: [
        {
          kind: "TextElement",
          tag: "Content",
          metadata: { encoding: record.encoding },
          text: record.contentText,
          textMarker: "",
        },
      ],
    };
    writeFileAtomicSync(targetPath, stringifyNode(node));
    return record.contentKey;
  }

  getRecord(key: ContentKey): ContentRecord | null {
    const raw = safeReadFileSync(contentPath(this.vcsDir, key));
    if (!raw) return null;
    const root = parseSingleRoot(raw, "VcsContent");
    const contentNode = (root.body ?? []).find((n) => isTextElement(n as XnlNode) && (n as TextElementNode).tag === "Content") as
      | TextElementNode
      | undefined;
    const contentText = typeof contentNode?.text === "string" ? contentNode.text : "";
    const contentType = asContentType(root.metadata?.contentType);
    const hashMeta = readStringMeta(root, "hash");
    const contentHash = hashMeta?.startsWith("sha256:") ? hashMeta.slice("sha256:".length) : sha256Hex(contentText);
    const sizeMeta = root.metadata?.sizeBytes;
    const sizeBytes = typeof sizeMeta === "number" ? sizeMeta : new TextEncoder().encode(contentText).length;
    const encoding = root.metadata?.encoding === "base64" ? "base64" : "utf8";
    return { contentKey: key, contentType, encoding, contentText, contentHash, sizeBytes };
  }

  get(key: ContentKey): string | null {
    return this.getRecord(key)?.contentText ?? null;
  }

  has(key: ContentKey): boolean {
    return fs.existsSync(contentPath(this.vcsDir, key));
  }
}

export class LocalFsRepositoryBackend implements RepositoryBackend {
  readonly objectStore: LocalFsObjectStore;
  readonly contentStore: LocalFsContentStore;
  private readonly vcsDir: string;

  constructor(options: { workspaceRootPath: string; vcsDirName?: string; vcsStorageRootPath?: string }) {
    const vcsRoot = options.vcsStorageRootPath ?? options.workspaceRootPath;
    this.vcsDir = path.join(vcsRoot, options.vcsDirName ?? ".xnl-vcs");
    this.objectStore = new LocalFsObjectStore(options);
    this.contentStore = new LocalFsContentStore(options);
  }

  init(defaultBranch: string): void {
    ensureDirSync(this.vcsDir);
    this.writeRef(`refs/heads/${defaultBranch}`, null);
    this.writeHead({ type: "branch", name: defaultBranch });
    this.writeWorkspaceState({ worktreeJson: "{}", stagedJson: "{}" });
    this.appendReflog("HEAD", {
      old: null,
      next: null,
      author: "system",
      message: `init ${defaultBranch}`,
      timestamp: new Date().toISOString(),
    });
    this.appendReflog(`refs/heads/${defaultBranch}`, {
      old: null,
      next: null,
      author: "system",
      message: `init ${defaultBranch}`,
      timestamp: new Date().toISOString(),
    });
  }

  writeHead(head: HeadState): void {
    const node: DataElementNode = {
      kind: "DataElement",
      tag: "Head",
      metadata:
        head.type === "branch"
          ? { headType: "branch", headValue: head.name }
          : { headType: "detached", headValue: head.commitId },
    };
    writeFileAtomicSync(path.join(this.vcsDir, "HEAD.xnl"), stringifyNode(node));
  }

  readHead(): HeadState | null {
    const raw = safeReadFileSync(path.join(this.vcsDir, "HEAD.xnl"));
    if (!raw) return null;
    const root = parseSingleRoot(raw, "Head");
    const headType = readStringMeta(root, "headType") === "detached" ? "detached" : "branch";
    const headValue = readStringMeta(root, "headValue") ?? "";
    return headType === "branch" ? { type: "branch", name: headValue || "main" } : { type: "detached", commitId: headValue };
  }

  readRef(refName: string): ObjectId | null {
    const filePath = path.join(this.vcsDir, `${refName}.xnl`);
    const raw = safeReadFileSync(filePath);
    if (!raw) return null;
    const root = parseSingleRoot(raw, "Ref");
    const target = readNullableObjectId(root, "target");
    return target;
  }

  writeRef(refName: string, target: ObjectId | null): void {
    const metadata: DataElementNode["metadata"] = {
      name: refName,
      target,
    };
    const node: DataElementNode = {
      kind: "DataElement",
      tag: "Ref",
      metadata,
    };
    const filePath = path.join(this.vcsDir, `${refName}.xnl`);
    writeFileAtomicSync(filePath, stringifyNode(node));
  }

  appendReflog(name: string, entry: { old: ObjectId | null; next: ObjectId | null; author: string; message: string; timestamp: string }): void {
    const logPath = path.join(this.vcsDir, "logs", `${name}.xnl`);
    const raw = safeReadFileSync(logPath);

    let root: DataElementNode;
    if (raw) {
      root = parseSingleRoot(raw, "Reflog");
    } else {
      root = {
        kind: "DataElement",
        tag: "Reflog",
        metadata: { name },
        body: [],
      };
    }

    root.body = root.body ?? [];
    root.body.push({
      kind: "DataElement",
      tag: "Entry",
      metadata: {
        old: entry.old,
        next: entry.next,
        author: entry.author,
        timestamp: entry.timestamp,
        message: entry.message,
      },
    });

    writeFileAtomicSync(logPath, stringifyNode(root));
  }

  updateBranchHead(info: PersistedCommitInfo): void {
    const refName = `refs/heads/${info.branchName}`;
    const lockPath = path.join(this.vcsDir, "locks", `${sanitizeLockName(refName)}.lock`);
    const release = acquireLockSync(lockPath);
    try {
      if (!this.objectStore.has(info.newCommitId)) {
        throw new VcsError("ENOENT_OBJECT", `Cannot update ref to missing object: ${info.newCommitId}`);
      }

      const old = info.oldCommitId;
      const next = info.newCommitId;
      this.writeRef(refName, next);
      this.writeHead({ type: "branch", name: info.branchName });
      this.appendReflog(refName, {
        old,
        next,
        author: info.author,
        message: info.message,
        timestamp: info.timestamp,
      });
      this.appendReflog("HEAD", {
        old,
        next,
        author: info.author,
        message: info.message,
        timestamp: info.timestamp,
      });
    } finally {
      release();
    }
  }

  writeWorkspaceState(state: WorkspaceState): void {
    const node: DataElementNode = {
      kind: "DataElement",
      tag: "Workspace",
      metadata: {},
      body: [
        { kind: "TextElement", tag: "Worktree", metadata: { encoding: "utf8" }, text: state.worktreeJson, textMarker: "" },
        { kind: "TextElement", tag: "Staged", metadata: { encoding: "utf8" }, text: state.stagedJson, textMarker: "" },
      ],
    };
    writeFileAtomicSync(path.join(this.vcsDir, "workspace.xnl"), stringifyNode(node));
  }

  readWorkspaceState(): WorkspaceState | null {
    const raw = safeReadFileSync(path.join(this.vcsDir, "workspace.xnl"));
    if (!raw) return null;
    const root = parseSingleRoot(raw, "Workspace");
    const body = root.body ?? [];
    const pick = (tag: string): string => {
      const node = body.find((n) => isTextElement(n as XnlNode) && (n as TextElementNode).tag === tag) as TextElementNode | undefined;
      return typeof node?.text === "string" ? node.text : "{}";
    };
    return { worktreeJson: pick("Worktree"), stagedJson: pick("Staged") };
  }

  checkIntegrity(): { brokenRefs: string[]; warnings: string[] } {
    const brokenRefs: string[] = [];
    const warnings: string[] = [];

    const head = this.readHead();
    if (!head) {
      warnings.push("HEAD missing");
      return { brokenRefs, warnings };
    }

    const checkCommitChain = (start: ObjectId | null, refLabel: string): void => {
      if (!start) {
        warnings.push(`${refLabel} points to null`);
        return;
      }
      const seen = new Set<ObjectId>();
      const queue: ObjectId[] = [start];
      while (queue.length > 0) {
        const id = queue.shift() as ObjectId;
        if (seen.has(id)) continue;
        seen.add(id);
        const obj = this.objectStore.get(id);
        if (!obj) {
          brokenRefs.push(refLabel);
          return;
        }
        if (obj.type !== "commit") {
          warnings.push(`${refLabel} points to non-commit object: ${id}`);
          return;
        }
        for (const parent of obj.parents) {
          queue.push(parent);
        }
      }
    };

    if (head.type === "detached") {
      checkCommitChain(head.commitId, "HEAD");
      return { brokenRefs, warnings };
    }

    const refName = `refs/heads/${head.name}`;
    const target = this.readRef(refName);
    if (target === null && !fs.existsSync(path.join(this.vcsDir, `${refName}.xnl`))) {
      brokenRefs.push(refName);
      return { brokenRefs, warnings };
    }
    checkCommitChain(target, refName);
    return { brokenRefs, warnings };
  }
}
