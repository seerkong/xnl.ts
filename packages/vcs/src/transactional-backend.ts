import { canonicalizeObject, sha256Hex, type ObjectId } from './hash';
import { makeContentRecord, type ContentRecord, type ContentStore } from './content-store';
import type { ObjectStore } from './object-store';
import type { VcsObject } from './types';
import type { RepositoryBackend, HeadState, WorkspaceState, PersistedCommitInfo } from './repository-backend';

/** Synchronous repository ports require a synchronous transaction boundary.
 * The host supplies SQLite/another transactional KV driver, never file paths
 * or business callbacks to the repository. One backend instance = one unit of
 * work. flush commits objects, contents, refs and worktree together. */
export interface RepositoryTransactionStore {
  begin(): void;
  read(space: string, key: string): string | null;
  write(space: string, key: string, value: string): void;
  keys(space: string): string[];
  commit(): void;
  rollback(): void;
  close(): void;
}
export class TransactionalRepositoryBackend implements RepositoryBackend {
  readonly objectStore: ObjectStore;
  readonly contentStore: ContentStore;
  private active = true;
  private closed = false;
  constructor(private readonly store: RepositoryTransactionStore) {
    try { store.begin(); } catch (error) { store.close(); throw error; }
    const read = <T>(space: string, key: string): T | null => {
      this.ensureActive(); const value = store.read(space, key); return value === null ? null : JSON.parse(value);
    };
    this.objectStore = {
      put: object => { this.ensureActive(); const value = canonicalizeObject(object); store.write('objects', value.hash, value.canonical); return value.hash; },
      get: <T extends VcsObject>(id: ObjectId): T | null => {
        const object = read<T>('objects', id);
        if (object && canonicalizeObject(object).hash !== id) throw Error('VCS_OBJECT_CORRUPT');
        return object;
      },
      has: id => { this.ensureActive(); return store.read('objects', id) !== null; },
      list: () => { this.ensureActive(); return store.keys('objects'); },
    };
    const getRecord = (key: string) => {
      const value = read<ContentRecord>('contents', key);
      if (value && (value.contentKey !== key || sha256Hex(value.contentText) !== key)) throw Error('VCS_CONTENT_CORRUPT');
      return value;
    };
    this.contentStore = {
      put: (content, type) => { this.ensureActive(); const record = makeContentRecord(content, type); store.write('contents', record.contentKey, JSON.stringify(record)); return record.contentKey; },
      getRecord, get: key => getRecord(key)?.contentText ?? null,
      has: key => { this.ensureActive(); return store.read('contents', key) !== null; },
    };
  }
  private ensureActive() { if (!this.active || this.closed) throw Error('VCS_TRANSACTION_CLOSED'); }
  private read<T>(space: string, key: string): T | null { this.ensureActive(); const value = this.store.read(space, key); return value === null ? null : JSON.parse(value); }
  private write(space: string, key: string, value: unknown) { this.ensureActive(); this.store.write(space, key, JSON.stringify(value)); }
  init(branch: string) { if (this.readHead()) throw Error('VCS_ALREADY_INITIALIZED'); this.writeRef(`refs/heads/${branch}`, null); this.writeHead({ type: 'branch', name: branch }); }
  writeHead(head: HeadState) { this.write('state', 'HEAD', head); }
  readHead() { return this.read<HeadState>('state', 'HEAD'); }
  readRef(name: string) { return this.read<ObjectId>('refs', name); }
  writeRef(name: string, target: ObjectId | null) { this.write('refs', name, target); }
  writeWorkspaceState(state: WorkspaceState) { this.write('state', 'workspace', state); }
  readWorkspaceState() { return this.read<WorkspaceState>('state', 'workspace'); }
  appendReflog(name: string, entry: { old: ObjectId | null; next: ObjectId | null; author: string; message: string; timestamp: string }) {
    const sequence = this.read<number>('reflog-heads', name) ?? 0;
    this.write('reflogs', JSON.stringify([name, sequence + 1]), entry); this.write('reflog-heads', name, sequence + 1);
  }
  updateBranchHead(info: PersistedCommitInfo) {
    const name = `refs/heads/${info.branchName}`;
    if (this.readRef(name) !== info.oldCommitId) throw Error('VCS_REF_CONFLICT');
    if (!this.objectStore.has(info.newCommitId)) throw Error('VCS_COMMIT_MISSING');
    this.writeRef(name, info.newCommitId); this.writeHead({ type: 'branch', name: info.branchName });
    const entry = { old: info.oldCommitId, next: info.newCommitId, author: info.author, message: info.message, timestamp: info.timestamp };
    this.appendReflog(name, entry); this.appendReflog('HEAD', entry);
  }
  checkIntegrity() {
    this.ensureActive(); const brokenRefs: string[] = [], warnings: string[] = [];
    for (const ref of this.store.keys('refs')) { const target = this.readRef(ref); if (target && this.objectStore.get(target)?.type !== 'commit') brokenRefs.push(ref); }
    for (const id of this.objectStore.list()) this.objectStore.get(id);
    for (const id of this.store.keys('contents')) this.contentStore.getRecord(id);
    return { brokenRefs, warnings };
  }
  flush() { this.ensureActive(); this.store.commit(); this.active = false; }
  close() { if (this.closed) return; try { if (this.active) this.store.rollback(); } finally { this.active = false; this.closed = true; this.store.close(); } }
}
