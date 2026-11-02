import { Repository } from './repository';
import { readTreeSnapshot } from './tree-converter';
import type { CommitObject } from './types';
import type { DocumentHistoryRuntime } from './document-history';
import type { DataElementNode } from 'xnl-core';
import { encodeXnlHistoryValue } from 'xnl-vfs/xnl-content-history';
import { historyCanonical } from 'xnl-vfs/content-history';
import type { VfsRevision } from 'xnl-vfs/revisioned-persistence';

export function createWorkspaceHistory(runtime: DocumentHistoryRuntime) {
  async function use<T>(task: (repository: Repository) => T): Promise<T> {
    if ('memory' in runtime) return task(runtime.memory);
    const backend = await runtime.openBackend();
    try {
      const head = backend.readHead(), repository = head ? new Repository({ backend, state: { head,
        branches: head.type === 'branch' ? { [head.name]: backend.readRef(`refs/heads/${head.name}`) } : {}, tags: {} } }) : new Repository({ backend });
      if (!head) repository.init('main'); else repository.loadWorkspaceState();
      const result = task(repository); await backend.flush?.(); return result;
    } finally { backend.close(); }
  }
  const list = (repository: Repository) => repository.log(Number.MAX_SAFE_INTEGER).map(entry => {
    const cause = JSON.parse(entry.message);
    if (cause.profile !== 'vfs-checkpoint/v1' || typeof cause.operationId !== 'string') throw Error('WORKSPACE_HISTORY_INVALID');
    return { id: entry.id, timestamp: entry.timestamp, ...cause };
  });
  function read(repository: Repository, id: string) {
    const commit = repository.store.get<CommitObject>(id);
    if (commit?.type !== 'commit') throw Error('WORKSPACE_VERSION_MISSING');
    return readTreeSnapshot(commit.tree, repository.store, repository.contentStore);
  }
  return {
    list: () => use(list),
    read: (id: string) => use(repository => read(repository, id)),
    append: (input: { snapshot: DataElementNode; operationId: string; revision: VfsRevision; through: { fileId: string; streamId: string; throughChange: number }[] }) => use(repository => {
      const previous = list(repository).find(entry => entry.operationId === input.operationId);
      if (previous) {
        if (historyCanonical(encodeXnlHistoryValue(read(repository, previous.id))) !== historyCanonical(encodeXnlHistoryValue(input.snapshot))
          || historyCanonical(previous.revision) !== historyCanonical(input.revision) || historyCanonical(previous.through) !== historyCanonical(input.through)) throw Error('WORKSPACE_OPERATION_REUSED');
        return previous;
      }
      repository.vfs.loadSnapshot(input.snapshot);
      const message = JSON.stringify({ profile: 'vfs-checkpoint/v1', operationId: input.operationId, revision: input.revision, through: input.through });
      const id = repository.commit(message, { author: 'local' });
      return list(repository).find(entry => entry.id === id)!;
    }),
  };
}
