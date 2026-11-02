import { expect, it } from 'vitest';
import { TransactionalRepositoryBackend, type RepositoryTransactionStore } from '../src/transactional-backend';
import { Repository } from '../src/repository';
import { createDocumentHistory } from '../src/document-history';
import { createWorkspaceHistory } from '../src/workspace-history';
import { VirtualFileSystem } from 'xnl-vfs';
import { parseXnl, type DataElementNode } from 'xnl-core';

function fixture() {
  let durable = new Map<string, string>(), locked = false;
  function store(): RepositoryTransactionStore {
    let transaction: Map<string, string> | undefined;
    return {
      begin() { if (locked) throw Error('BUSY'); locked = true; transaction = new Map(durable); },
      read: (space, key) => transaction!.get(JSON.stringify([space, key])) ?? null,
      write: (space, key, value) => { transaction!.set(JSON.stringify([space, key]), value); },
      keys: space => [...transaction!.keys()].map(key => JSON.parse(key)).filter(key => key[0] === space).map(key => key[1]),
      commit() { durable = transaction!; transaction = undefined; locked = false; },
      rollback() { transaction = undefined; locked = false; }, close() {},
    };
  }
  return { open: () => new TransactionalRepositoryBackend(store()), durable: () => new Map(durable) };
}
it('refs, content, worktree and objects are committed together; failure leaves the old repository', () => {
  const fixtureData = fixture(), first = fixtureData.open();
  const repository = new Repository({ backend: first }); repository.init('main');
  repository.vfs.writeFile('vfs:///example.ts', 'incomplete code {', { fileType: 'text' });
  repository.commit('save raw file');
  expect(fixtureData.durable().size).toBe(0);
  first.close(); expect(fixtureData.durable().size).toBe(0);
  const retry = fixtureData.open(); const second = new Repository({ backend: retry }); second.init('main');
  second.vfs.writeFile('vfs:///example.ts', 'incomplete code {', { fileType: 'text' });
  const commit = second.commit('save raw file'); retry.flush(); retry.close();
  const reopened = fixtureData.open(); expect(reopened.readRef('refs/heads/main')).toBe(commit);
  expect(reopened.objectStore.get(commit)?.type).toBe('commit'); expect(reopened.checkIntegrity().brokenRefs).toEqual([]);
  expect(() => reopened.updateBranchHead({ branchName: 'main', oldCommitId: 'stale', newCommitId: commit, author: 'test', message: '', timestamp: '' })).toThrow('VCS_REF_CONFLICT');
  reopened.close();
});
it('the original document checkpoint format reopens and deduplicates through the transactional backend', async () => {
  const fixtureData = fixture();
  const history = createDocumentHistory({ openBackend: async () => fixtureData.open() });
  const document = parseXnl('<Document #doc [<Paragraph #p [<Text {text="saved"}>]>]>').nodes[0] as DataElementNode;
  const saved = await history.append({ document, operationId: 'file-version' });
  expect(await history.append({ document, operationId: 'file-version' })).toEqual(saved);
  expect(await history.list()).toHaveLength(1);
  expect(await history.read(saved.id)).toEqual(document);
  await expect(history.append({ document: { ...document, metadata: { changed: true } }, operationId: 'file-version' })).rejects.toThrow('HISTORY_OPERATION_CONFLICT');
  expect(await history.list()).toHaveLength(1);
});
it('file checkpoints preserve raw source, bytes and file identities without inserting a receipt into the author tree', async () => {
  const data = fixture(), history = createWorkspaceHistory({ openBackend: async () => data.open() });
  const vfs = new VirtualFileSystem();
  vfs.writeFile('vfs:///code.ts', '\ufeffunfinished(\r\n', { fileType: 'text', metadataId: 'code' });
  vfs.writeFile('vfs:///opaque', 'AP/+', { fileType: 'binary', metadataId: 'image' });
  const input = { snapshot: vfs.getSnapshot(), operationId: 'files-one', revision: { authorityId: 'raw', value: 'one' }, through: [] };
  const saved = await history.append(input);
  expect(await history.append(input)).toEqual(saved);
  expect(await history.read(saved.id)).toEqual(input.snapshot);
  const after = new VirtualFileSystem(await history.read(saved.id));
  expect(after.readdir('vfs:///')).toHaveLength(2);
  expect(after.stat('vfs:///code.ts').metadataId).toBe('code');
  await expect(history.append({ ...input, revision: { ...input.revision, value: 'other' } })).rejects.toThrow('WORKSPACE_OPERATION_REUSED');
});

it('semantic checkpoints deduplicate codec roundtrips with reordered object keys, but preserve values, arrays and identity', async () => {
  const data = fixture();
  const history = createDocumentHistory({ openBackend: async () => data.open() });
  const parse = (source: string) => parseXnl(source).nodes[0] as DataElementNode;
  const first = parse('<Document #doc [<ComponentEmbed #c { input={kind="tasks" columns=["a" "b"] literal={tag="Text" kind="DataElement" value=1}} ref="component://example" version="1" }>]>');
  const reordered = '<Document #doc [<ComponentEmbed #c { version="1" ref="component://example" input={literal={value=1 kind="DataElement" tag="Text"} columns=["a" "b"] kind="tasks"} }>]>';
  const saved = await history.append({ document: first, operationId: 'same-file-revision' });
  expect(await history.append({ document: parse(reordered), operationId: 'same-file-revision' })).toEqual(saved);
  expect(await history.read(saved.id)).toEqual(first);
  for (const changed of [reordered.replace('value=1', 'value=2'), reordered.replace('["a" "b"]', '["b" "a"]'), reordered.replace('#c ', '#other ')]) {
    await expect(history.append({ document: parse(changed), operationId: 'same-file-revision' })).rejects.toThrow('HISTORY_OPERATION_CONFLICT');
  }
  expect(await history.list()).toHaveLength(1);
});
