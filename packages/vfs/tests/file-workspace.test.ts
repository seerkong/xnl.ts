import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../src/vfs';
import { createMemoryContentJournal } from '../src/content-history';
import { MemoryRevisionedVfsAuthority } from '../src/revisioned-persistence';
import { createFileWorkspace } from '../src/file-workspace';
import { openTextContent } from '../src/text-content-history';

function fixture() {
  const vfs = new VirtualFileSystem(); vfs.mkdir('vfs:///src');
  vfs.writeFile('vfs:///src/main.ts', '\ufeffconst a = 1;\r\n', { metadataId: 'source', fileType: 'text' });
  vfs.writeFile('vfs:///manifest.xnl', '<Manifest {entry="src/main.ts"}>', { metadataId: 'manifest', fileType: 'text' });
  vfs.writeFile('vfs:///image.data', 'AP/+', { metadataId: 'binary', fileType: 'binary' });
  const journal = createMemoryContentJournal(), authority = new MemoryRevisionedVfsAuthority(vfs.getSnapshot(), { authorityId: 'files' });
  const workspace = createFileWorkspace({ authority, journal, scope: 'test', actorId: 'local', sessionEpoch: 'session' });
  return { vfs, journal, authority, workspace };
}
describe('explicit file workspace', () => {
  it('a never-saved text tail retains its initial revision across external ABA and reopen', async () => {
    const { journal, authority, workspace } = fixture();
    const initial = await authority.read(), tree = new VirtualFileSystem(initial.snapshot);
    const text = tree.readFile('vfs:///src/main.ts');
    const input = { journal, scope: 'buffers', fileId: 'source', actorId: 'local', sessionEpoch: 'first', initial: text, codec: 'utf8' as const, fileRevision: initial.revision };
    const first = await openTextContent(input);
    await first.edit({ expectedHead: 0, requestId: 'edit', groupId: 'edit', splice: { offset: 11, removed: '1', inserted: '2' } });
    first.close();
    // The workspace file log is deliberately first opened after the drift.
    for (const content of ['external', text]) {
      const before = await authority.read();
      tree.writeFile('vfs:///src/main.ts', content, { overwrite: true });
      await authority.compareAndSwap({ expectedRevision: before.revision, snapshot: tree.getSnapshot() });
    }
    const current = await authority.read();
    const reopened = await openTextContent({ ...input, fileRevision: current.revision, sessionEpoch: 'reopen' });
    await expect(workspace.prepareContentSave(reopened.capture(), { revision: current.revision, content: text }, 'stale')).rejects.toThrow('FILE_CONTENT_BASE_CONFLICT');
    expect((await authority.read()).revision).toEqual(current.revision);
    expect(reopened.read().text).toContain('a = 2');
    reopened.close();
  });
  it('reopened text history cannot borrow an external revision to overwrite changed or ABA source', async () => {
    const { journal, authority, workspace } = fixture();
    const initial = await workspace.read(), tree = new VirtualFileSystem(initial.snapshot), content = tree.readFile('vfs:///src/main.ts');
    const input = { journal, scope: 'buffers', fileId: 'source', actorId: 'local', sessionEpoch: 'first', initial: content, codec: 'utf8' as const, fileRevision: initial.revision };
    const first = await openTextContent(input);
    await first.edit({ expectedHead: 0, requestId: 'edit', groupId: 'edit', splice: { offset: 11, removed: '1', inserted: '2' } });
    await workspace.commit(await workspace.prepareContentSave(first.capture(), { revision: initial.revision, content }, 'save'));
    const materialized = await authority.read(), materializedContent = first.read().text;
    expect((await workspace.commit(await workspace.prepareContentSave(first.capture(), { revision: materialized.revision, content: materializedContent }, 'unchanged-save'))).status).toBe('unchanged');
    expect((await workspace.commit(await workspace.prepareContentSave(first.capture(), { revision: materialized.revision, content: materializedContent }, 'unchanged-save-again'))).status).toBe('unchanged');
    first.close();
    const saved = await authority.read();
    const external = new VirtualFileSystem(saved.snapshot);
    external.writeFile('vfs:///src/main.ts', 'external', { overwrite: true });
    await authority.compareAndSwap({ expectedRevision: saved.revision, snapshot: external.getSnapshot() });
    for (const text of ['external', '\ufeffconst a = 2;\r\n']) {
      const before = await authority.read();
      external.writeFile('vfs:///src/main.ts', text, { overwrite: true });
      await authority.compareAndSwap({ expectedRevision: before.revision, snapshot: external.getSnapshot() });
      const current = await authority.read();
      const reopened = await openTextContent({ ...input, initial: text, sessionEpoch: 'reopened' });
      try {
        await expect(workspace.prepareContentSave(reopened.capture(), { revision: current.revision, content: text }, 'stale-save')).rejects.toThrow('FILE_CONTENT_BASE_CONFLICT');
        expect((await authority.read()).revision).toEqual(current.revision);
      } finally { reopened.close(); }
    }
  });
  it('two actors share path identity; a concurrent delete conflicts without discarding the accepted text history', async () => {
    const { vfs, journal, authority, workspace } = fixture();
    const other = createFileWorkspace({ authority, journal, scope: 'test', actorId: 'other', sessionEpoch: 'other-session' });
    const initial = await authority.read(), content = vfs.readFile('vfs:///src/main.ts');
    const buffer = await openTextContent({ journal, scope: 'buffers', fileId: 'source', actorId: 'local', sessionEpoch: 'edit', initial: content, codec: 'utf8', fileRevision: initial.revision });
    try {
      await buffer.edit({ expectedHead: 0, requestId: 'edit', groupId: 'typing', splice: { offset: 11, removed: '1', inserted: '2' } });
      await other.commit({ operationId: 'other-move', expectedRevision: initial.revision, mutations: [{ type: 'MOVE', path: 'vfs:///src', targetPath: 'vfs:///renamed', expectedId: vfs.stat('vfs:///src').metadataId }] });
      const prepared = await workspace.prepareContentSave(buffer.capture(), { revision: initial.revision, content }, 'save');
      expect(prepared.mutations[0].path).toBe('vfs:///renamed/main.ts');
      const afterRename = await other.read();
      await other.commit({ operationId: 'other-delete', expectedRevision: afterRename.revision, mutations: [{ type: 'FILE_DELETE', path: 'vfs:///renamed/main.ts', expectedId: 'source' }] });
      await expect(workspace.commit(prepared)).rejects.toThrow('FILE_BASE_CONFLICT');
      await expect(workspace.prepareContentSave(buffer.capture(), { revision: initial.revision, content }, 'save-again')).rejects.toThrow('FILE_CONTENT_BASE_CONFLICT');
      expect(buffer.read().text).toBe('\ufeffconst a = 2;\r\n');
      expect(buffer.read().throughChange).toBe(1);
      expect(new VirtualFileSystem((await authority.read()).snapshot).getPathIndex().resolvePath('source')).toBeUndefined();
    } finally { buffer.close(); }
  });
  it('a raw text buffer journals small splices, follows a directory rename and saves exact BOM/CRLF with manifest in one batch', async () => {
    const { vfs, journal, authority, workspace } = fixture();
    const initial = vfs.readFile('vfs:///src/main.ts'), before = await authority.read();
    const buffer = await openTextContent({ journal, scope: 'buffers', fileId: 'source', actorId: 'local', sessionEpoch: 'owner-1', initial, codec: 'utf8', fileRevision: before.revision });
    await buffer.edit({ expectedHead: 0, requestId: 'typing', groupId: 'typing', splice: { offset: 11, removed: '1', inserted: '(' } });
    expect((await authority.read()).revision).toEqual(before.revision);
    await workspace.commit({ operationId: 'rename', expectedRevision: before.revision, mutations: [{ type: 'MOVE', path: 'vfs:///src', targetPath: 'vfs:///code', expectedId: vfs.stat('vfs:///src').metadataId }] });
    const transaction = await workspace.prepareContentSave(buffer.capture(), { revision: before.revision, content: initial }, 'save-files');
    transaction.mutations.push({ type: 'CONTENT_UPDATE', path: 'vfs:///manifest.xnl', expectedId: 'manifest', payload: { content: '<Manifest {entry="code/main.ts"}>' } });
    expect((await workspace.commit(transaction)).status).toBe('applied');
    expect((await workspace.commit(transaction)).status).toBe('applied');
    const result = new VirtualFileSystem((await authority.read()).snapshot);
    expect(result.readFile('vfs:///code/main.ts')).toBe('\ufeffconst a = (;\r\n');
    expect(result.stat('vfs:///code/main.ts').metadataId).toBe('source');
    expect(result.readFile('vfs:///image.data')).toBe('AP/+');
    expect(result.readFile('vfs:///manifest.xnl')).toContain('code/main.ts');
    buffer.close();
    const reopened = await openTextContent({ journal, scope: 'buffers', fileId: 'source', actorId: 'local', sessionEpoch: 'owner-2', initial, codec: 'utf8' });
    expect(reopened.read().text).toBe(result.readFile('vfs:///code/main.ts'));
    await reopened.revert('undo', { expectedHead: 1, requestId: 'undo' });
    expect(reopened.read().text).toBe(initial);
    await reopened.revert('redo', { expectedHead: 2, requestId: 'redo' });
    expect(reopened.read().text).toBe(result.readFile('vfs:///code/main.ts'));
    await workspace.restore({ version: 'initial', operationId: 'restore-files', expectedRevision: (await workspace.read()).revision });
    const restored = new VirtualFileSystem((await workspace.read()).snapshot);
    expect(restored.readFile('vfs:///src/main.ts')).toBe(initial);
    expect(restored.stat('vfs:///src/main.ts').metadataId).toBe('source');
    expect((await workspace.history()).head).toBe(6);
  });
  it('lost file ACK resumes the original batch and conflicting identity rejects before prepare', async () => {
    const { journal, authority, workspace } = fixture();
    const before = await authority.read();
    let lose = true;
    const wrapped = createFileWorkspace({ journal, scope: 'test', actorId: 'local', sessionEpoch: 'other', authority: {
      read: () => authority.read(), lookupOperation: id => authority.lookupOperation(id), compareAndSwap: async value => {
        const result = await authority.compareAndSwap(value); if (lose) { lose = false; throw Error('ACK_LOST'); } return result;
      },
    } });
    await expect(wrapped.commit({ operationId: 'bad', expectedRevision: before.revision, mutations: [{ type: 'FILE_DELETE', path: 'vfs:///src/main.ts', expectedId: 'wrong' }] })).rejects.toThrow();
    const transaction = { operationId: 'binary', expectedRevision: before.revision, mutations: [{ type: 'CONTENT_UPDATE' as const, path: 'vfs:///image.data', expectedId: 'binary', payload: { content: 'AAECA/8=' } }] };
    await expect(wrapped.commit(transaction)).rejects.toThrow('ACK_LOST');
    expect((await workspace.reconcile())?.status).toBe('applied');
    expect((await workspace.history()).head).toBe(2);
    expect(new VirtualFileSystem((await workspace.read()).snapshot).readFile('vfs:///image.data')).toBe('AAECA/8=');
  });
  it('an external ABA and deletion do not silently refresh an open buffer base', async () => {
    const { vfs, authority, workspace } = fixture();
    const initial = await authority.read(), content = vfs.readFile('vfs:///src/main.ts');
    vfs.writeFile('vfs:///src/main.ts', 'external', { overwrite: true });
    await authority.compareAndSwap({ expectedRevision: initial.revision, snapshot: vfs.getSnapshot() });
    const changed = await authority.read();
    vfs.writeFile('vfs:///src/main.ts', content, { overwrite: true });
    await authority.compareAndSwap({ expectedRevision: changed.revision, snapshot: vfs.getSnapshot() });
    await expect(workspace.prepareContentSave({ fileId: 'source', content: 'draft', codec: 'utf8', streamId: 'buffer', throughChange: 1 }, { revision: initial.revision, content }, 'stale')).rejects.toThrow('FILE_CONTENT_BASE_CONFLICT');
  });
  it('failed journal delivery retries the accepted text fact without splicing twice', async () => {
    const journal = createMemoryContentJournal(); let fail = true;
    const buffer = await openTextContent({ journal: { ...journal, append: async change => { const result = await journal.append(change); if (fail) { fail = false; throw Error('ACK_LOST'); } return result; } },
      scope: 'text', fileId: 'text', actorId: 'a', sessionEpoch: 'one', initial: 'A', codec: 'utf8' });
    await expect(buffer.edit({ expectedHead: 0, requestId: 'r', groupId: 'g', splice: { offset: 1, removed: '', inserted: 'B' } })).rejects.toThrow('ACK_LOST');
    expect(buffer.read()).toMatchObject({ text: 'AB', journalPending: true });
    await buffer.retry(); expect(buffer.capture().content).toBe('AB');
    await expect(buffer.edit({ expectedHead: 1, requestId: 'bad', groupId: 'g2', splice: { offset: 0, removed: 'X', inserted: 'C' } })).rejects.toThrow('TEXT_SPLICE_CONFLICT');
    expect(buffer.read().throughChange).toBe(1);
  });
});
