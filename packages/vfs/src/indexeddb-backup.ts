import { historyCanonical, type HistoryValue } from './content-history';

/** Lossless tagged transport for the structured-clone values used by these
 * stores. Unsupported values fail before export; undefined is not silently
 * turned into null or removed from an AST. */
function encode(value: unknown, parents = new Set<object>()): HistoryValue {
  if (value === undefined) return ['undefined'];
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return ['value', value];
  if (!value || typeof value !== 'object' || parents.has(value)) throw Error('BACKUP_VALUE_UNSUPPORTED');
  parents.add(value);
  try {
    if (value instanceof Date) return ['date', value.toISOString()];
    if (value instanceof ArrayBuffer) return ['bytes', Array.from(new Uint8Array(value))];
    if (Array.isArray(value)) {
      // Sparse holes and additional properties are distinct structured-clone
      // values. Reject them instead of silently changing their representation.
      if (Reflect.ownKeys(value).length !== value.length + 1 || Array.from({ length: value.length }, (_, index) => index)
        .some(index => !Object.prototype.hasOwnProperty.call(value, index))) throw Error('BACKUP_VALUE_UNSUPPORTED');
      return ['array', value.map(item => encode(item, parents))];
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('BACKUP_VALUE_UNSUPPORTED');
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) throw Error('BACKUP_VALUE_UNSUPPORTED');
    return ['object', Object.keys(value).map(key => {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in property)) throw Error('BACKUP_VALUE_UNSUPPORTED');
      return [key, encode(property.value, parents)];
    })];
  } finally { parents.delete(value); }
}
function decode(value: HistoryValue): any {
  if (!Array.isArray(value)) throw Error('BACKUP_VALUE_INVALID');
  switch (value[0]) {
    case 'undefined': return undefined;
    case 'value': return value[1];
    case 'date': return new Date(value[1] as string);
    case 'bytes': return new Uint8Array(value[1] as number[]).buffer;
    case 'array': return (value[1] as HistoryValue[]).map(decode);
    case 'object': return Object.fromEntries((value[1] as [string, HistoryValue][]).map(([key, value]) => [key, decode(value)]));
    default: throw Error('BACKUP_VALUE_INVALID');
  }
}
type StoreImage = { name: string; keyPath: string | string[] | null; autoIncrement: boolean;
  keyGenerator?: number | 'exhausted';
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
  rows: { key: HistoryValue; value: HistoryValue }[] };
export interface IndexedDbImage { format: 'indexeddb-image/v1'; version: number; stores: StoreImage[]; integrity: string }
const request = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error ?? Error('BACKUP_TRANSACTION_ABORTED'));
});
async function checksum(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(historyCanonical(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function probeGenerator(store: IDBObjectStore): Promise<number | 'exhausted'> {
  return new Promise((resolve, reject) => {
    const probe = store.add({});
    probe.onsuccess = () => resolve(probe.result as number);
    probe.onerror = event => {
      event.preventDefault(); event.stopPropagation();
      if (probe.error?.name === 'ConstraintError') resolve('exhausted');
      else reject(probe.error);
    };
  });
}
function restoreGenerator(store: IDBObjectStore, saved: StoreImage) {
  if (!saved.autoIncrement) return;
  const next = saved.keyGenerator;
  if (next !== 'exhausted' && (typeof next !== 'number' || !Number.isInteger(next) || next < 1 || next > 2 ** 53)) throw Error('BACKUP_GENERATOR_INVALID');
  if (next === 1) return;
  const marker = next === 'exhausted' ? 2 ** 53 : next! - 1;
  const keys = saved.rows.map(row => decode(row.key));
  if (keys.some(key => typeof key === 'number' && key >= marker)) return;
  const value: Record<string, unknown> = {};
  if (saved.keyPath !== null) {
    if (typeof saved.keyPath !== 'string' || !saved.keyPath) throw Error('BACKUP_GENERATOR_INVALID');
    const parts = saved.keyPath.split('.');
    let parent = value;
    for (const [index, part] of parts.entries()) {
      const child = index === parts.length - 1 ? marker : {};
      Object.defineProperty(parent, part, { value: child, writable: true, configurable: true, enumerable: true });
      parent = child as Record<string, unknown>;
    }
    store.add(value);
  } else store.add(value, marker);
  store.delete(marker);
}
/** Probe without creating an empty database that could masquerade as payload. */
function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const opening = factory.open(name);
    opening.onupgradeneeded = event => { if (event.oldVersion === 0) { absent = true; opening.transaction!.abort(); } };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = event => { event.preventDefault(); if (absent) resolve(undefined); else reject(opening.error); };
    opening.onblocked = () => reject(Error('BACKUP_DATABASE_BLOCKED'));
  });
}
export async function exportIndexedDbDatabase(factory: IDBFactory, name: string): Promise<IndexedDbImage | undefined> {
  const db = await openExisting(factory, name); if (!db) return undefined;
  try {
    const names = Array.from(db.objectStoreNames);
    if (!names.length) { const image = { format: 'indexeddb-image/v1' as const, version: db.version, stores: [] }; return { ...image, integrity: await checksum(image) }; }
    // Read a generator by inserting a disposable row inside an ABORTED
    // transaction. Abort restores both row and counter. A readonly scan of
    // surviving keys cannot recover a counter after the largest key is deleted.
    const tx = db.transaction(names, 'readwrite');
    let intentionalAbort = false;
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => intentionalAbort ? resolve() : reject(tx.error ?? Error('BACKUP_TRANSACTION_ABORTED'));
      tx.onerror = () => reject(tx.error);
    });
    void completion.catch(() => {});
    let stores: StoreImage[];
    try { stores = await Promise.all(names.map(async name => {
      const store = tx.objectStore(name);
      const indexes = Array.from(store.indexNames).map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
      const [keys, values, generator] = await Promise.all([request(store.getAllKeys()), request(store.getAll()),
        store.autoIncrement ? probeGenerator(store) : Promise.resolve(undefined)]);
      return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, ...(generator !== undefined ? { keyGenerator: generator } : {}),
        indexes, rows: keys.map((key, i) => ({ key: encode(key), value: encode(values[i]) })) };
    }));
      intentionalAbort = true; tx.abort();
    } catch (error) { try { tx.abort(); } catch {} throw error; }
    await completion;
    const image = { format: 'indexeddb-image/v1' as const, version: db.version, stores };
    return { ...image, integrity: await checksum(image) };
  } finally { db.close(); }
}

/** Restores only to a fresh physical DB name. A failed versionchange rolls
 * back creation; this function never clears or upgrades existing user data. */
export async function restoreIndexedDbDatabase(factory: IDBFactory, name: string, image: IndexedDbImage): Promise<void> {
  const { integrity, ...payload } = image;
  if (image.format !== 'indexeddb-image/v1' || !Number.isSafeInteger(image.version) || image.version < 1
    || integrity !== await checksum(payload)) throw Error('BACKUP_INTEGRITY_INVALID');
  await new Promise<void>((resolve, reject) => {
    let created = false, failure: unknown;
    const opening = factory.open(name, image.version);
    opening.onupgradeneeded = event => {
      if (event.oldVersion !== 0) { failure = Error('BACKUP_TARGET_EXISTS'); opening.transaction!.abort(); return; }
      created = true;
      try {
        for (const saved of image.stores) {
          const store = opening.result.createObjectStore(saved.name, { ...(saved.keyPath === null ? {} : { keyPath: saved.keyPath }), autoIncrement: saved.autoIncrement });
          for (const index of saved.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
          for (const row of saved.rows) {
            const value = decode(row.value), key = decode(row.key);
            if (saved.keyPath === null) store.add(value, key); else store.add(value);
          }
          restoreGenerator(store, saved);
        }
      } catch (error) { failure = error; opening.transaction!.abort(); }
    };
    opening.onsuccess = () => { opening.result.close(); if (created) resolve(); else reject(Error('BACKUP_TARGET_EXISTS')); };
    opening.onerror = event => { event.preventDefault(); reject(failure ?? opening.error); };
    opening.onblocked = () => reject(Error('BACKUP_DATABASE_BLOCKED'));
  });
}
