import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { exportIndexedDbDatabase, restoreIndexedDbDatabase } from '../src/indexeddb-backup';

it('exports exact values/schema and restores only into a fresh DB; corruption cannot erase an existing store', async () => {
  const factory = new IDBFactory();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open('old', 2);
    open.onupgradeneeded = () => { const store = open.result.createObjectStore('values', { keyPath: 'id' }); store.createIndex('byLabel', 'label');
      store.add({ id: 'one', label: 'value', optional: undefined, nested: [undefined, null], bytes: new Uint8Array([0, 255]).buffer }); };
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  }); db.close();
  const image = (await exportIndexedDbDatabase(factory, 'old'))!;
  await restoreIndexedDbDatabase(factory, 'new', JSON.parse(JSON.stringify(image)));
  expect(await exportIndexedDbDatabase(factory, 'new')).toEqual(image);
  await expect(restoreIndexedDbDatabase(factory, 'new', image)).rejects.toThrow('BACKUP_TARGET_EXISTS');
  await expect(restoreIndexedDbDatabase(factory, 'corrupt', { ...image, integrity: 'bad' })).rejects.toThrow('BACKUP_INTEGRITY_INVALID');
  expect(await exportIndexedDbDatabase(factory, 'corrupt')).toBeUndefined();
  expect(await exportIndexedDbDatabase(factory, 'missing')).toBeUndefined();
  expect((await factory.databases()).map(db => db.name).sort()).toEqual(['new', 'old']);
});

it('retains a deleted highest key counter without advancing the source generator', async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('generated');
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('rows', { autoIncrement: true });
      store.add('deleted', 100); store.delete(100);
    };
    open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
  });
  const image = (await exportIndexedDbDatabase(factory, 'generated'))!;
  expect(image.stores[0].keyGenerator).toBe(101);
  expect(image.stores[0].rows).toEqual([]);
  expect(await exportIndexedDbDatabase(factory, 'generated')).toEqual(image);
  await restoreIndexedDbDatabase(factory, 'copy', image);
  expect(await exportIndexedDbDatabase(factory, 'copy')).toEqual(image);
  for (const name of ['generated', 'copy']) await new Promise<void>((resolve, reject) => {
    const open = factory.open(name);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('rows', 'readwrite');
      const add = tx.objectStore('rows').add('next');
      add.onsuccess = () => expect(add.result).toBe(101);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
});

it.each([100, 2 ** 53])('restores nested inline generators, including exhaustion after deleted key %s', async highest => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('inline');
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('rows', { keyPath: 'record.id', autoIncrement: true });
      store.add({ record: { id: highest }, value: 'removed' });
      store.delete(highest);
    };
    open.onsuccess = () => { open.result.close(); resolve(); };
    open.onerror = () => reject(open.error);
  });
  const image = (await exportIndexedDbDatabase(factory, 'inline'))!;
  expect(image.stores[0].keyGenerator).toBe(highest === 2 ** 53 ? 'exhausted' : highest + 1);
  await restoreIndexedDbDatabase(factory, 'copy-inline', image);
  expect(await exportIndexedDbDatabase(factory, 'copy-inline')).toEqual(image);
  expect(await exportIndexedDbDatabase(factory, 'inline')).toEqual(image);
});
