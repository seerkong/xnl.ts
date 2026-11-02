import { Repository } from './repository';
import { readTreeSnapshot } from './tree-converter';
import type { RepositoryBackend } from './repository-backend';
import type { CommitObject } from './types';
import { VirtualFileSystem } from 'xnl-vfs';
import { areXnlSnapshotsStructurallyEqual } from 'xnl-vfs/revisioned-persistence';
import { parseXnl, stringifyLineBlock, type DataElementNode } from 'xnl-core';

export interface DocumentHistoryEntry { id: string; operationId: string; message: string; timestamp: string }
export interface DocumentHistoryPort {
  list(): Promise<DocumentHistoryEntry[]>;
  read(id: string): Promise<DataElementNode>;
  append(input: { document: DataElementNode; operationId: string }): Promise<DocumentHistoryEntry>;
}
export type DocumentHistoryRuntime = { memory: Repository } | { openBackend: () => Promise<RepositoryBackend & { close(): void }> };

/** Common single-document checkpoint adapter. Original paths and receipt format
 * are retained so existing browser repository lineage is not rewritten. */
export function createDocumentHistory(runtime: DocumentHistoryRuntime): DocumentHistoryPort {
  function decode(source: string): DataElementNode {
    const result = parseXnl(source), node = result.nodes[0];
    if (result.nodes.length !== 1 || !node || typeof node !== 'object' || Array.isArray(node) || !('kind' in node) || node.kind !== 'DataElement') throw Error('INVALID_HISTORY_DOCUMENT');
    return node as DataElementNode;
  }
  async function use<T>(work: (repository: Repository) => Promise<T>): Promise<T> {
    if ('memory' in runtime) return work(runtime.memory);
    const backend = await runtime.openBackend();
    try {
      const head = backend.readHead();
      const repository = head === null ? new Repository({ backend }) : new Repository({ backend, state: { head,
        branches: head.type === 'branch' ? { [head.name]: backend.readRef(`refs/heads/${head.name}`) } : { main: backend.readRef('refs/heads/main') }, tags: {} } });
      if (head === null) repository.init('main'); else repository.loadWorkspaceState();
      const result = await work(repository); await backend.flush?.(); return result;
    } finally { backend.close(); }
  }
  const documentPath = 'vfs:///documents/activity.xnl', receiptPath = 'vfs:///documents/checkpoint.json';
  function readFile(repository: Repository, id: string, path: string) {
    const commit = repository.store.get<CommitObject>(id);
    if (commit?.type !== 'commit') throw Error('UNKNOWN_HISTORY_VERSION');
    const vfs = new VirtualFileSystem(readTreeSnapshot(commit.tree, repository.store, repository.contentStore));
    if (!vfs.exists(path)) throw Error('INVALID_HISTORY_VERSION');
    return vfs.readFile(path);
  }
  function list(repository: Repository): DocumentHistoryEntry[] {
    return repository.log(Number.MAX_SAFE_INTEGER).map(entry => {
      const data = JSON.parse(readFile(repository, entry.id, receiptPath));
      if (typeof data.operationId !== 'string') throw Error('INVALID_HISTORY_RECEIPT');
      return { id: entry.id, operationId: data.operationId, message: entry.message, timestamp: entry.timestamp };
    });
  }
  return {
    list: () => use(async repository => list(repository)),
    read: id => use(async repository => decode(readFile(repository, id, documentPath))),
    append: input => use(async repository => {
      const source = stringifyLineBlock(input.document);
      const existing = list(repository).find(entry => entry.operationId === input.operationId);
      if (existing) {
        const previous = readFile(repository, existing.id, documentPath);
        // This is a semantic document checkpoint, not raw file history. Both
        // sides pass through the same codec so object key order and parser
        // optional fields cannot turn a repeated revision into a conflict.
        if (previous !== source && !areXnlSnapshotsStructurallyEqual(decode(previous), decode(source))) throw Error('HISTORY_OPERATION_CONFLICT');
        return existing;
      }
      repository.vfs.mkdir('vfs:///documents', { recursive: true });
      repository.vfs.writeFile(documentPath, source, { overwrite: repository.vfs.exists(documentPath), fileType: 'xnl' });
      repository.vfs.writeFile(receiptPath, JSON.stringify({ operationId: input.operationId }), { overwrite: repository.vfs.exists(receiptPath), fileType: 'text' });
      const id = repository.commit('保存文档', { author: 'Halfcode workbench' });
      const entry = list(repository).find(value => value.id === id);
      if (!entry) throw Error('HISTORY_RECEIPT_MISSING'); return entry;
    }),
  };
}
