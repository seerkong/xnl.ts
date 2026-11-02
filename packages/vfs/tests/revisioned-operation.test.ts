import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { parseXnl, type DataElementNode } from 'xnl-core';
import { MemoryRevisionedVfsAuthority, createIndexedDbRevisionedVfsAuthority } from '../src/revisioned-persistence';

const snapshot = (state: string) => parseXnl(`<Document #doc state="${state}">`).nodes[0] as DataElementNode;

it('upgrades an existing version-2 authority in place without resetting its revision or payload', async () => {
  const factory = new IDBFactory(), dbName = 'legacy-v2';
  const old = { authorityId: 'doc', sequence: 7, revisionValue: 'legacy:7', issuedRevisionValues: ['legacy:7'], snapshot: snapshot('saved') };
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(dbName, 2);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('revisioned-vfs-authorities', { keyPath: 'authorityId' }).put(old);
      open.result.createObjectStore('legacy-sidecar').put({ keep: true }, 'kept');
    };
    open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
  });
  const authority = await createIndexedDbRevisionedVfsAuthority({ authorityId: 'doc', dbName, indexedDbFactory: factory, initialSnapshot: snapshot('never-seed') });
  expect(await authority.read()).toEqual({ revision: { authorityId: 'doc', value: 'legacy:7' }, snapshot: old.snapshot });
  expect(await authority.lookupOperation('old-unknown')).toBeUndefined();
  const result = await authority.compareAndSwap({ expectedRevision: (await authority.read()).revision, snapshot: snapshot('next'), operationId: 'after-upgrade' });
  expect(result.status).toBe('applied');
  const reopened = await createIndexedDbRevisionedVfsAuthority({ authorityId: 'doc', dbName, indexedDbFactory: factory, initialSnapshot: snapshot('never-seed') });
  expect(await reopened.lookupOperation('after-upgrade')).toEqual(result);
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(dbName);
    open.onsuccess = () => {
      const db = open.result;
      expect(db.version).toBe(3);
      const read = db.transaction('legacy-sidecar').objectStore('legacy-sidecar').get('kept');
      read.onsuccess = () => { expect(read.result).toEqual({ keep: true }); db.close(); resolve(); };
      read.onerror = () => reject(read.error);
    };
    open.onerror = () => reject(open.error);
  });
});
for (const backend of ['memory', 'indexeddb'] as const) {
  it(`${backend}: operation receipt survives retry and distinguishes ABA and reused payloads`, async () => {
    const indexedDbFactory = new IDBFactory();
    const memory = new MemoryRevisionedVfsAuthority(snapshot('a'), { authorityId: 'doc' });
    const open = () => backend === 'memory' ? Promise.resolve(memory) : createIndexedDbRevisionedVfsAuthority({ authorityId: 'doc', initialSnapshot: snapshot('a'), indexedDbFactory });
    let authority = await open();
    const base = await authority.read();
    const input = { operationId: 'edit-1', expectedRevision: base.revision, snapshot: snapshot('b') };
    const result = await authority.compareAndSwap(input);
    expect(result.status).toBe('applied');
    authority = await open();
    expect(await authority.lookupOperation('edit-1')).toEqual(result);
    expect(await authority.compareAndSwap(input)).toEqual(result);
    const current = await authority.read();
    expect(await authority.compareAndSwap({ expectedRevision: current.revision, snapshot: snapshot('a') })).toMatchObject({ status: 'applied' });
    expect(await authority.compareAndSwap(input)).toEqual(result);
    expect((await authority.read()).snapshot.metadata.state).toBe('a');
    expect(await authority.compareAndSwap({ ...input, snapshot: snapshot('c') })).toMatchObject({ status: 'failed', diagnostics: [{ code: 'VFS_OPERATION_ID_REUSED' }] });
    expect(await authority.lookupOperation('missing')).toBeUndefined();
  });
}

it('failed writes remain retryable; an unchanged operation is still recorded', async () => {
  const authority = new MemoryRevisionedVfsAuthority(snapshot('a'), { authorityId: 'doc' });
  const base = authority.read();
  const input = { operationId: 'save', expectedRevision: base.revision, snapshot: snapshot('b') };
  authority.failNextFlush({ code: 'FAIL', message: 'injected' });
  expect((await authority.compareAndSwap(input)).status).toBe('failed');
  expect(await authority.lookupOperation('save')).toBeUndefined();
  expect((await authority.compareAndSwap(input)).status).toBe('applied');
  const current = authority.read();
  const noOp = { operationId: 'noop', expectedRevision: current.revision, snapshot: current.snapshot };
  expect((await authority.compareAndSwap(noOp)).status).toBe('unchanged');
  expect((await authority.lookupOperation('noop'))?.status).toBe('unchanged');
  const different = structuredClone(noOp.snapshot); different.metadata.optional = undefined as any;
  expect(await authority.compareAndSwap({ ...noOp, snapshot: different })).toMatchObject({ status: 'failed', diagnostics: [{ code: 'VFS_OPERATION_ID_REUSED' }] });
});
