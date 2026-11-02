import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createManagedFsWorkspace, ensureManagedFileIdentity } from '../src/managed-fs-workspace';
import { VirtualFileSystem } from '../src/vfs';
import { createFileWorkspace } from '../src/file-workspace';
import { createMemoryContentJournal } from '../src/content-history';

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'managed-source-')));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/code.ts'), '\ufeffconst a = 1;\r\n');
  fs.writeFileSync(path.join(root, 'unknown'), Buffer.from([0, 255, 254]));
  let queue = Promise.resolve() as Promise<unknown>;
  let deny = false;
  const config = { root, storageRoot: path.join(root, '.history'), authorityId: 'source', excludedNames: ['.history'],
    exclusive: <T>(task: () => Promise<T>) => { const result = queue.then(task); queue = result.catch(() => {}); return result; },
    authorize: async () => { if (deny) throw Error('DENIED'); },
  };
  return { root, config, authority: createManagedFsWorkspace(config), deny: () => { deny = true; }, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
it('rejects unpaired UTF-16 before disk publication and closes the file outbox so a corrected save can proceed', async () => {
  const f = fixture(), journal = createMemoryContentJournal();
  const workspace = createFileWorkspace({ authority: f.authority, journal, scope: 'utf8', actorId: 'local', sessionEpoch: 'utf8' });
  try {
    const before = await workspace.read(), vfs = new VirtualFileSystem(before.snapshot);
    const id = vfs.stat('vfs:///src/code.ts').metadataId;
    for (const [index, text] of ['\ud800', '\udc00'].entries()) {
      const result = await workspace.commit({ operationId: `invalid-${index}`, expectedRevision: before.revision,
        mutations: [{ type: 'CONTENT_UPDATE', path: 'vfs:///src/code.ts', expectedId: id, payload: { content: text } }] });
      expect(result).toMatchObject({ status: 'failed', diagnostics: [{ code: 'FS_TEXT_INVALID' }] });
      expect((await workspace.read()).revision).toEqual(before.revision);
      expect(fs.readFileSync(path.join(f.root, 'src/code.ts'), 'utf8')).toBe('\ufeffconst a = 1;\r\n');
      expect(await workspace.reconcile()).toBeUndefined();
    }
    const exact = '\ufeff中文😀\r\n';
    expect((await workspace.commit({ operationId: 'corrected', expectedRevision: before.revision,
      mutations: [{ type: 'CONTENT_UPDATE', path: 'vfs:///src/code.ts', expectedId: id, payload: { content: exact } }] })).status).toBe('applied');
    expect(fs.readFileSync(path.join(f.root, 'src/code.ts'), 'utf8')).toBe(exact);
  } finally { journal.close(); f.close(); }
});
it('publishes exact raw bytes and directory moves with stable VFS identities, idempotent receipts and reopen', async () => {
  const f = fixture();
  try {
    const before = await f.authority.read(), vfs = new VirtualFileSystem(before.snapshot);
    const id = vfs.stat('vfs:///src/code.ts').metadataId, dir = vfs.stat('vfs:///src').metadataId;
    expect(vfs.readFileType('vfs:///unknown')).toBe('binary');
    vfs.rename('vfs:///src', 'vfs:///scripts');
    vfs.writeFile('vfs:///scripts/code.ts', '\ufeffconst a = (;\r\n', { overwrite: true, fileType: 'text' });
    vfs.writeFile('vfs:///manifest.xnl', 'unfinished source', { fileType: 'text' });
    const input = { operationId: 'batch', expectedRevision: before.revision, snapshot: vfs.getSnapshot() };
    const result = await f.authority.compareAndSwap(input);
    expect(result.status).toBe('applied');
    expect(fs.readFileSync(path.join(f.root, 'scripts/code.ts'))).toEqual(Buffer.from('\ufeffconst a = (;\r\n'));
    expect(fs.readFileSync(path.join(f.root, 'unknown'))).toEqual(Buffer.from([0, 255, 254]));
    const reopened = createManagedFsWorkspace(f.config), after = new VirtualFileSystem((await reopened.read()).snapshot);
    expect(after.stat('vfs:///scripts/code.ts').metadataId).toBe(id);
    expect(after.stat('vfs:///scripts').metadataId).toBe(dir);
    expect(await reopened.compareAndSwap(input)).toEqual(result);
    expect(await reopened.lookupOperation!('batch')).toEqual(result);
  } finally { f.close(); }
});
it('stale equal-content replacement and a revoked source permission never overwrite author files', async () => {
  const f = fixture();
  try {
    const before = await f.authority.read(), vfs = new VirtualFileSystem(before.snapshot);
    const file = path.join(f.root, 'src/code.ts');
    fs.writeFileSync(file + '.tmp', fs.readFileSync(file)); fs.renameSync(file + '.tmp', file);
    vfs.writeFile('vfs:///src/code.ts', 'must not publish', { overwrite: true });
    expect((await f.authority.compareAndSwap({ operationId: 'stale', expectedRevision: before.revision, snapshot: vfs.getSnapshot() })).status).toBe('conflict');
    const observed = await f.authority.read(); f.deny();
    await expect(f.authority.compareAndSwap({ operationId: 'denied', expectedRevision: observed.revision, snapshot: vfs.getSnapshot() })).rejects.toThrow('DENIED');
    expect(fs.readFileSync(file, 'utf8')).toContain('const a = 1');
  } finally { f.close(); }
});
it('reserved JS property names are ordinary files and a not-yet-created override retains its allocated identity', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, '__proto__'), 'raw');
    const id = ensureManagedFileIdentity(f.config.storageRoot, 'future.xnl');
    await f.authority.read();
    expect(ensureManagedFileIdentity(f.config.storageRoot, 'future.xnl')).toBe(id);
    const before = await f.authority.read(), vfs = new VirtualFileSystem(before.snapshot);
    expect(vfs.readFile('vfs:///__proto__')).toBe('raw');
    vfs.writeFile('vfs:///__proto__', 'changed', { overwrite: true });
    await f.authority.compareAndSwap({ operationId: 'prototype-file', expectedRevision: before.revision, snapshot: vfs.getSnapshot() });
    expect(fs.readFileSync(path.join(f.root, '__proto__'), 'utf8')).toBe('changed');
  } finally { f.close(); }
});
