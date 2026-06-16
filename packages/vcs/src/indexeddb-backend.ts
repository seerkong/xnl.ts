import { VcsError } from "./errors";
import { canonicalizeObject, sha256Hex, type ObjectId } from "./hash";
import type { ObjectStore } from "./object-store";
import { encodingForType, type ContentRecord, type ContentStore } from "./content-store";
import type { HeadState, PersistedCommitInfo, RepositoryBackend, WorkspaceState } from "./repository-backend";
import type { ContentKey, ContentType, VcsObject } from "./types";

const DB_VERSION = 2;
const OBJECTS_STORE = "vcs-objects";
const CONTENTS_STORE = "vcs-contents";
const REFS_STORE = "vcs-refs";
const REPOS_STORE = "vcs-repos";
const REFLOGS_STORE = "vcs-reflogs";
const WORKSPACES_STORE = "vcs-workspaces";

type IndexedDbRequestLike = {
  result?: unknown;
  error?: unknown;
  onsuccess: ((this: IndexedDbRequestLike, event: unknown) => unknown) | null;
  onerror: ((this: IndexedDbRequestLike, event: unknown) => unknown) | null;
};

type IndexedDbOpenRequestLike = IndexedDbRequestLike & {
  onupgradeneeded: ((this: IndexedDbOpenRequestLike, event: unknown) => unknown) | null;
};

export interface IndexedDbFactoryLike {
  open(name: string, version?: number): IndexedDbOpenRequestLike;
}

interface IndexedDbIndexLike {
  getAll(query?: unknown): IndexedDbRequestLike;
}

interface IndexedDbStoreLike {
  put(value: unknown): IndexedDbRequestLike;
  get(key: unknown): IndexedDbRequestLike;
  getAll(query?: unknown): IndexedDbRequestLike;
  index(name: string): IndexedDbIndexLike;
}

interface IndexedDbTransactionLike {
  objectStore(name: string): IndexedDbStoreLike;
  oncomplete: ((this: IndexedDbTransactionLike, event: unknown) => unknown) | null;
  onerror: ((this: IndexedDbTransactionLike, event: unknown) => unknown) | null;
  onabort: ((this: IndexedDbTransactionLike, event: unknown) => unknown) | null;
  error?: unknown;
}

interface IndexedDbDatabaseLike {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string; autoIncrement?: boolean }): {
    createIndex(name: string, keyPath: string, options?: { unique?: boolean }): void;
  };
  deleteObjectStore(name: string): void;
  transaction(stores: string | string[], mode?: "readonly" | "readwrite"): IndexedDbTransactionLike;
  close(): void;
}

/**
 * Record shapes use the `*Key` naming convention for business identifiers
 * (objectKey, repoKey, refKey, contentKey, targetObjectKey ...). A numeric
 * surrogate `id` primary key is a relational/SQL concern; IndexedDB keys
 * directly on the business key.
 */
interface ObjectRecord {
  objectKey: ObjectId;
  repoKey: string;
  objectType: VcsObject["type"];
  canonicalJson: string;
}

interface ContentRow {
  contentKey: ContentKey;
  repoKey: string;
  contentType: ContentType;
  encoding: "utf8" | "base64";
  contentText: string;
  contentHash: string;
  sizeBytes: number;
}

interface RefRecord {
  refPath: string;
  repoKey: string;
  refKey: string;
  refType: "heads" | "tags" | "other";
  targetObjectKey: ObjectId | null;
}

interface RepoRecord {
  repoKey: string;
  headType: HeadState["type"];
  headValue: string;
}

interface ReflogRecord {
  repoKey: string;
  refKey: string;
  oldObjectKey: ObjectId | null;
  nextObjectKey: ObjectId | null;
  author: string;
  message: string;
  createdAt: string;
}

interface WorkspaceRecord {
  repoKey: string;
  worktreeJson: string;
  stagedJson: string;
}

export interface IndexedDbRepositoryBackendOptions {
  dbName?: string;
  repoId?: string;
  indexedDbFactory?: IndexedDbFactoryLike;
}

function toPromise<T>(request: IndexedDbRequestLike): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => {
      reject(request.error instanceof Error ? request.error : new Error("IndexedDB request failed"));
    };
  });
}

function waitForTransaction(tx: IndexedDbTransactionLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error instanceof Error ? tx.error : new Error("IndexedDB transaction aborted"));
  });
}

async function runTransaction(
  db: IndexedDbDatabaseLike,
  stores: string | string[],
  mode: "readonly" | "readwrite",
  handler: (tx: IndexedDbTransactionLike) => Promise<void>
): Promise<void> {
  const tx = db.transaction(stores, mode);
  const done = waitForTransaction(tx);
  await handler(tx);
  await done;
}

function resolveFactory(indexedDbFactory?: IndexedDbFactoryLike): IndexedDbFactoryLike {
  if (indexedDbFactory) {
    return indexedDbFactory;
  }
  const value = (globalThis as { indexedDB?: IndexedDbFactoryLike }).indexedDB;
  if (!value || typeof value.open !== "function") {
    throw new VcsError("EINVAL", "IndexedDB is unavailable. Provide options.indexedDbFactory.");
  }
  return value;
}

function refTypeFromPath(refPath: string): "heads" | "tags" | "other" {
  if (refPath.startsWith("refs/heads/")) {
    return "heads";
  }
  if (refPath.startsWith("refs/tags/")) {
    return "tags";
  }
  return "other";
}

async function openDatabase(factory: IndexedDbFactoryLike, dbName: string): Promise<IndexedDbDatabaseLike> {
  const request = factory.open(dbName, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result as IndexedDbDatabaseLike;

    if (!db.objectStoreNames.contains(OBJECTS_STORE)) {
      const objects = db.createObjectStore(OBJECTS_STORE, { keyPath: "objectKey" });
      objects.createIndex("by-type", "objectType", { unique: false });
      objects.createIndex("by-repo", "repoKey", { unique: false });
    }

    if (!db.objectStoreNames.contains(CONTENTS_STORE)) {
      const contents = db.createObjectStore(CONTENTS_STORE, { keyPath: "contentKey" });
      contents.createIndex("by-repo", "repoKey", { unique: false });
      contents.createIndex("by-type", "contentType", { unique: false });
      contents.createIndex("by-hash", "contentHash", { unique: false });
    }

    if (!db.objectStoreNames.contains(REFS_STORE)) {
      const refs = db.createObjectStore(REFS_STORE, { keyPath: "refPath" });
      refs.createIndex("by-repo", "repoKey", { unique: false });
      refs.createIndex("by-type", "refType", { unique: false });
    }

    if (!db.objectStoreNames.contains(REPOS_STORE)) {
      db.createObjectStore(REPOS_STORE, { keyPath: "repoKey" });
    }

    if (!db.objectStoreNames.contains(REFLOGS_STORE)) {
      db.createObjectStore(REFLOGS_STORE, { autoIncrement: true });
    }

    if (!db.objectStoreNames.contains(WORKSPACES_STORE)) {
      db.createObjectStore(WORKSPACES_STORE, { keyPath: "repoKey" });
    }
  };

  return toPromise<IndexedDbDatabaseLike>(request);
}

export class IndexedDbObjectStore implements ObjectStore {
  private readonly repoId: string;
  private readonly records: Map<ObjectId, string>;
  private readonly persistObjectRecord: (record: ObjectRecord) => void;

  constructor(options: {
    repoId: string;
    initialRecords?: Map<ObjectId, string>;
    persistObjectRecord: (record: ObjectRecord) => void;
  }) {
    this.repoId = options.repoId;
    this.records = options.initialRecords ?? new Map();
    this.persistObjectRecord = options.persistObjectRecord;
  }

  put(object: VcsObject): ObjectId {
    const { canonical, hash } = canonicalizeObject(object);
    this.records.set(hash, canonical);
    this.persistObjectRecord({
      objectKey: hash,
      repoKey: this.repoId,
      objectType: object.type,
      canonicalJson: canonical,
    });
    return hash;
  }

  get<T extends VcsObject = VcsObject>(id: ObjectId): T | null {
    const raw = this.records.get(id);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new VcsError("EINVAL", `Malformed object JSON for ${id}`);
    }
  }

  has(id: ObjectId): boolean {
    return this.records.has(id);
  }

  list(): ObjectId[] {
    return [...this.records.keys()].sort((a, b) => a.localeCompare(b));
  }
}

export class IndexedDbContentStore implements ContentStore {
  private readonly repoId: string;
  private readonly records: Map<ContentKey, ContentRecord>;
  private readonly persistContentRecord: (record: ContentRow) => void;

  constructor(options: {
    repoId: string;
    initialRecords?: Map<ContentKey, ContentRecord>;
    persistContentRecord: (record: ContentRow) => void;
  }) {
    this.repoId = options.repoId;
    this.records = options.initialRecords ?? new Map();
    this.persistContentRecord = options.persistContentRecord;
  }

  put(content: string, contentType: ContentType): ContentKey {
    const contentHash = sha256Hex(content);
    const record: ContentRecord = {
      contentKey: contentHash,
      contentType,
      encoding: encodingForType(contentType),
      contentText: content,
      contentHash,
      sizeBytes: new TextEncoder().encode(content).length,
    };
    this.records.set(record.contentKey, record);
    this.persistContentRecord({
      contentKey: record.contentKey,
      repoKey: this.repoId,
      contentType: record.contentType,
      encoding: record.encoding,
      contentText: record.contentText,
      contentHash: record.contentHash,
      sizeBytes: record.sizeBytes,
    });
    return record.contentKey;
  }

  get(key: ContentKey): string | null {
    return this.records.get(key)?.contentText ?? null;
  }

  getRecord(key: ContentKey): ContentRecord | null {
    return this.records.get(key) ?? null;
  }

  has(key: ContentKey): boolean {
    return this.records.has(key);
  }
}

export class IndexedDbRepositoryBackend implements RepositoryBackend {
  readonly objectStore: IndexedDbObjectStore;
  readonly contentStore: IndexedDbContentStore;

  private readonly db: IndexedDbDatabaseLike;
  private readonly repoId: string;
  private readonly refs: Map<string, ObjectId | null>;
  private head: HeadState | null;
  private workspace: WorkspaceState | null;
  private queue: Promise<void> = Promise.resolve();
  private queueError: unknown = null;
  private closed = false;

  private constructor(options: {
    db: IndexedDbDatabaseLike;
    repoId: string;
    refs: Map<string, ObjectId | null>;
    head: HeadState | null;
    workspace: WorkspaceState | null;
    objectRecords: Map<ObjectId, string>;
    contentRecords: Map<ContentKey, ContentRecord>;
  }) {
    this.db = options.db;
    this.repoId = options.repoId;
    this.refs = options.refs;
    this.head = options.head;
    this.workspace = options.workspace;
    this.objectStore = new IndexedDbObjectStore({
      repoId: this.repoId,
      initialRecords: options.objectRecords,
      persistObjectRecord: (record) => {
        this.enqueue(async () => {
          await runTransaction(this.db, OBJECTS_STORE, "readwrite", async (tx) => {
            await toPromise(tx.objectStore(OBJECTS_STORE).put(record));
          });
        });
      },
    });
    this.contentStore = new IndexedDbContentStore({
      repoId: this.repoId,
      initialRecords: options.contentRecords,
      persistContentRecord: (record) => {
        this.enqueue(async () => {
          await runTransaction(this.db, CONTENTS_STORE, "readwrite", async (tx) => {
            await toPromise(tx.objectStore(CONTENTS_STORE).put(record));
          });
        });
      },
    });
  }

  static async open(options: IndexedDbRepositoryBackendOptions = {}): Promise<IndexedDbRepositoryBackend> {
    const dbName = options.dbName ?? "xnl-vcs";
    const repoId = options.repoId ?? "default";
    const factory = resolveFactory(options.indexedDbFactory);
    const db = await openDatabase(factory, dbName);

    const objectRecords = new Map<ObjectId, string>();
    const contentRecords = new Map<ContentKey, ContentRecord>();
    const refs = new Map<string, ObjectId | null>();
    let head: HeadState | null = null;
    let workspace: WorkspaceState | null = null;

    await runTransaction(db, [OBJECTS_STORE, CONTENTS_STORE, REFS_STORE, REPOS_STORE, WORKSPACES_STORE], "readonly", async (tx) => {
      // Object/content IDs are content-addressed and can be shared across repos.
      const objectRows = (await toPromise<ObjectRecord[]>(tx.objectStore(OBJECTS_STORE).getAll())) ?? [];
      for (const row of objectRows) {
        objectRecords.set(row.objectKey, row.canonicalJson);
      }

      const contentRows = (await toPromise<ContentRow[]>(tx.objectStore(CONTENTS_STORE).getAll())) ?? [];
      for (const row of contentRows) {
        contentRecords.set(row.contentKey, {
          contentKey: row.contentKey,
          contentType: row.contentType,
          encoding: row.encoding,
          contentText: row.contentText,
          contentHash: row.contentHash,
          sizeBytes: row.sizeBytes,
        });
      }

      const refRows = (await toPromise<RefRecord[]>(tx.objectStore(REFS_STORE).index("by-repo").getAll(repoId))) ?? [];
      for (const row of refRows) {
        refs.set(stripRepoRefPrefix(row.refPath, repoId), row.targetObjectKey);
      }

      const repo = (await toPromise<RepoRecord | undefined>(tx.objectStore(REPOS_STORE).get(repoId))) ?? null;
      if (repo) {
        head =
          repo.headType === "detached"
            ? { type: "detached", commitId: repo.headValue as ObjectId }
            : { type: "branch", name: repo.headValue };
      }

      const ws = (await toPromise<WorkspaceRecord | undefined>(tx.objectStore(WORKSPACES_STORE).get(repoId))) ?? null;
      if (ws) {
        workspace = { worktreeJson: ws.worktreeJson, stagedJson: ws.stagedJson };
      }
    });

    return new IndexedDbRepositoryBackend({
      db,
      repoId,
      refs,
      head,
      workspace,
      objectRecords,
      contentRecords,
    });
  }

  init(defaultBranch: string): void {
    this.assertUsable();
    this.writeRef(`refs/heads/${defaultBranch}`, null);
    this.writeHead({ type: "branch", name: defaultBranch });
    this.writeWorkspaceState({ worktreeJson: "{}", stagedJson: "{}" });
    const timestamp = new Date().toISOString();
    this.appendReflog("HEAD", {
      old: null,
      next: null,
      author: "system",
      message: `init ${defaultBranch}`,
      timestamp,
    });
    this.appendReflog(`refs/heads/${defaultBranch}`, {
      old: null,
      next: null,
      author: "system",
      message: `init ${defaultBranch}`,
      timestamp,
    });
  }

  writeHead(head: HeadState): void {
    this.assertUsable();
    this.head = head.type === "branch" ? { type: "branch", name: head.name } : { type: "detached", commitId: head.commitId };

    const record: RepoRecord = {
      repoKey: this.repoId,
      headType: head.type,
      headValue: head.type === "branch" ? head.name : head.commitId,
    };

    this.enqueue(async () => {
      await runTransaction(this.db, REPOS_STORE, "readwrite", async (tx) => {
        await toPromise(tx.objectStore(REPOS_STORE).put(record));
      });
    });
  }

  readHead(): HeadState | null {
    if (!this.head) {
      return null;
    }
    return this.head.type === "branch" ? { type: "branch", name: this.head.name } : { type: "detached", commitId: this.head.commitId };
  }

  readRef(refName: string): ObjectId | null {
    return this.refs.get(refName) ?? null;
  }

  writeRef(refName: string, target: ObjectId | null): void {
    this.assertUsable();
    this.refs.set(refName, target);

    const record: RefRecord = {
      refPath: toRepoRefPath(refName, this.repoId),
      repoKey: this.repoId,
      refKey: refName,
      refType: refTypeFromPath(refName),
      targetObjectKey: target,
    };

    this.enqueue(async () => {
      await runTransaction(this.db, REFS_STORE, "readwrite", async (tx) => {
        await toPromise(tx.objectStore(REFS_STORE).put(record));
      });
    });
  }

  appendReflog(name: string, entry: { old: ObjectId | null; next: ObjectId | null; author: string; message: string; timestamp: string }): void {
    this.assertUsable();

    const record: ReflogRecord = {
      repoKey: this.repoId,
      refKey: name,
      oldObjectKey: entry.old,
      nextObjectKey: entry.next,
      author: entry.author,
      message: entry.message,
      createdAt: entry.timestamp,
    };

    this.enqueue(async () => {
      await runTransaction(this.db, REFLOGS_STORE, "readwrite", async (tx) => {
        await toPromise(tx.objectStore(REFLOGS_STORE).put(record));
      });
    });
  }

  updateBranchHead(info: PersistedCommitInfo): void {
    this.assertUsable();
    if (!this.objectStore.has(info.newCommitId)) {
      throw new VcsError("ENOENT_OBJECT", `Cannot update ref to missing object: ${info.newCommitId}`);
    }

    const refName = `refs/heads/${info.branchName}`;
    this.writeRef(refName, info.newCommitId);
    this.writeHead({ type: "branch", name: info.branchName });
    this.appendReflog(refName, {
      old: info.oldCommitId,
      next: info.newCommitId,
      author: info.author,
      message: info.message,
      timestamp: info.timestamp,
    });
    this.appendReflog("HEAD", {
      old: info.oldCommitId,
      next: info.newCommitId,
      author: info.author,
      message: info.message,
      timestamp: info.timestamp,
    });
  }

  writeWorkspaceState(state: WorkspaceState): void {
    this.assertUsable();
    this.workspace = { worktreeJson: state.worktreeJson, stagedJson: state.stagedJson };
    const record: WorkspaceRecord = {
      repoKey: this.repoId,
      worktreeJson: state.worktreeJson,
      stagedJson: state.stagedJson,
    };
    this.enqueue(async () => {
      await runTransaction(this.db, WORKSPACES_STORE, "readwrite", async (tx) => {
        await toPromise(tx.objectStore(WORKSPACES_STORE).put(record));
      });
    });
  }

  readWorkspaceState(): WorkspaceState | null {
    return this.workspace ? { worktreeJson: this.workspace.worktreeJson, stagedJson: this.workspace.stagedJson } : null;
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
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const object = this.objectStore.get(id);
        if (!object) {
          brokenRefs.push(refLabel);
          return;
        }
        if (object.type !== "commit") {
          warnings.push(`${refLabel} points to non-commit object: ${id}`);
          return;
        }
        for (const parent of object.parents) {
          queue.push(parent);
        }
      }
    };

    if (head.type === "detached") {
      checkCommitChain(head.commitId, "HEAD");
      return { brokenRefs, warnings };
    }

    const refName = `refs/heads/${head.name}`;
    if (!this.refs.has(refName)) {
      brokenRefs.push(refName);
      return { brokenRefs, warnings };
    }
    checkCommitChain(this.refs.get(refName) ?? null, refName);
    return { brokenRefs, warnings };
  }

  async flush(): Promise<void> {
    await this.queue;
    if (this.queueError) {
      throw this.queueError;
    }
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue
      .then(async () => {
        if (this.closed) {
          return;
        }
        await task();
      })
      .catch((error: unknown) => {
        if (!this.queueError) {
          this.queueError = error;
        }
      });
  }

  private assertUsable(): void {
    if (this.closed) {
      throw new VcsError("EINVAL", "IndexedDbRepositoryBackend is closed");
    }
    if (this.queueError) {
      throw this.queueError;
    }
  }
}

function toRepoRefPath(refName: string, repoId: string): string {
  return `repos/${repoId}/${refName}`;
}

function stripRepoRefPrefix(refPath: string, repoId: string): string {
  const prefix = `repos/${repoId}/`;
  if (refPath.startsWith(prefix)) {
    return refPath.slice(prefix.length);
  }
  return refPath;
}
