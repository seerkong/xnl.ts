import { describe, expect, it } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  createMemoryContentJournal, replayContentJournal, type ContentStream, type ContentChange,
  type ContentJournal, historyCanonical, validateContentJournalChanges,
} from '../src/content-history';
import { createIndexedDbContentJournal } from '../src/indexeddb-content-history';

const stream: ContentStream = {
  streamId: 'private/doc-a', subject: { scope: 'private', id: 'doc-a', root: 'content' },
  profile: { id: 'text-splice/v1', config: { encoding: 'utf8' } }, initial: 'hello',
};
function change(base = 0, requestId = `r${base}`, actorId = 'local'): ContentChange {
  return { streamId: stream.streamId, profileId: stream.profile.id, actorId, sessionEpoch: 'epoch-a',
    requestId, groupId: requestId, base, delta: { before: base === 0 ? 'hello' : 'hello!', after: 'hello!' } };
}
const textReplay = {
  profileId: stream.profile.id,
  decode: (value: unknown) => value as string,
  apply: (value: string, delta: any) => {
    if (value !== delta.before) throw Error('TEXT_PRECONDITION');
    return delta.after as string;
  },
};

it('rejects hidden and symbol fields rather than silently dropping history data', () => {
  expect(() => historyCanonical({ [Symbol('identity')]: 1 })).toThrow('HISTORY_NON_SERIALIZABLE');
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  expect(() => historyCanonical(hidden)).toThrow('HISTORY_NON_SERIALIZABLE');
  const array = Object.assign([1], { extra: 2 });
  expect(() => historyCanonical(array)).toThrow('HISTORY_NON_SERIALIZABLE');
});

it('projected validation retains full interval provenance and scoped request identity', async () => {
  const journal = createMemoryContentJournal(); await journal.open(stream);
  await journal.append(change(0, 'same', 'a'));
  await journal.append(change(1, 'same', 'b'));
  await journal.append({ ...change(2, 'same', 'a'), sessionEpoch: 'epoch-b' });
  const valid = await journal.readChanges!(stream.streamId);
  expect(() => validateContentJournalChanges(valid)).not.toThrow();
  const bad = [
    { ...valid, entries: [] }, { ...valid, head: -1 }, { ...valid, head: 1.5 },
    { ...valid, streamId: 'other' }, { ...valid, profileId: 'other' },
    { ...valid, entries: [...valid.entries].reverse() },
    { ...valid, entries: valid.entries.map((entry, index) => index ? { ...entry, receipt: { ...entry.receipt, sequence: 1 } } : entry) },
    { ...valid, entries: valid.entries.map((entry, index) => index ? { ...entry, change: { ...entry.change, actorId: 'a' } } : entry) },
  ];
  for (const snapshot of bad) expect(() => validateContentJournalChanges(snapshot)).toThrow('HISTORY_INCOMPLETE_INTERVAL');
  const calls: string[] = [];
  const full = await journal.read(stream.streamId);
  const corrupt = { ...full, entries: full.entries.map((entry, index) => index ? { ...entry, receipt: { ...entry.receipt, sequence: 1 } } : entry) };
  expect(() => replayContentJournal(corrupt, { profileId: stream.profile.id,
    decode: () => { calls.push('decode'); return null; }, apply: value => { calls.push('apply'); return value; } })).toThrow('HISTORY_INCOMPLETE_INTERVAL');
  expect(calls).toEqual(['decode', 'apply']);
  expect(() => replayContentJournal(corrupt, { ...textReplay, checkpoint: { sequence: 2, value: 'checkpoint' } })).toThrow('HISTORY_INCOMPLETE_INTERVAL');
  journal.close();
});

for (const backend of ['memory', 'indexeddb'] as const) describe(`${backend} content journal`, () => {
  async function open(): Promise<ContentJournal> {
    return backend === 'memory' ? createMemoryContentJournal()
      : createIndexedDbContentJournal({ factory: new IDBFactory(), dbName: 'isolated-content' });
  }
  it('projects a complete isolated interval without the immutable seed', async () => {
    const journal = await open();
    await expect(journal.readChanges!('missing')).rejects.toThrow('HISTORY_STREAM_MISSING');
    await journal.open(stream); await journal.append(change());
    const full = await journal.read(stream.streamId), projected = await journal.readChanges!(stream.streamId);
    expect(projected).toEqual({ streamId: stream.streamId, profileId: stream.profile.id, head: full.head, entries: full.entries });
    expect(Object.prototype.hasOwnProperty.call(projected, 'stream')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(projected, 'initial')).toBe(false);
    (projected.entries[0]!.change.delta as any).after = 'outside';
    expect((await journal.readChanges!(stream.streamId)).entries).toEqual(full.entries);
    journal.close();
    await expect(journal.readChanges!(stream.streamId)).rejects.toThrow();
  });
  it('deduplicates a lost ACK before checking the now stale base, without duplicating a group', async () => {
    const journal = await open();
    await journal.open(stream);
    const first = await journal.append(change());
    const retry = await journal.append(change());
    expect(retry).toEqual({ status: 'duplicate', receipt: 'receipt' in first ? first.receipt : null });
    expect((await journal.read(stream.streamId)).entries).toHaveLength(1);
    expect(await journal.lookup(stream.streamId, 'local', 'epoch-a', 'r0')).toEqual((await journal.read(stream.streamId)).entries[0]);
    expect(replayContentJournal(await journal.read(stream.streamId), textReplay)).toBe('hello!');
    journal.close();
  });
  it('rejects request reuse, stale concurrent actor, wrong profile and seed without changing the head', async () => {
    const journal = await open(); await journal.open(stream);
    await journal.append(change());
    expect(await journal.append({ ...change(), delta: 'different' })).toMatchObject({ status: 'conflict', reason: 'request-reused' });
    expect(await journal.append(change(0, 'second', 'other-actor'))).toMatchObject({ status: 'conflict', reason: 'base' });
    expect(await journal.append({ ...change(1), profileId: 'unknown' })).toMatchObject({ status: 'conflict', reason: 'profile' });
    await expect(journal.open({ ...stream, initial: 'other' })).rejects.toThrow('HISTORY_SEED_CONFLICT');
    expect((await journal.read(stream.streamId)).head).toBe(1);
    journal.close();
  });
  it('keeps subject scopes separate and never treats file-root delta as content delta', async () => {
    const journal = await open(); await journal.open(stream);
    const files = { ...stream, streamId: 'workspace/files', subject: { ...stream.subject, root: 'files' as const } };
    await journal.open(files);
    await journal.append(change());
    expect((await journal.read(files.streamId)).head).toBe(0);
    await expect(journal.open({ ...stream, subject: files.subject })).rejects.toThrow('HISTORY_SEED_CONFLICT');
    journal.close();
  });
  it('rejects incomplete, reordered and unknown codec recovery instead of silently dropping edits', async () => {
    const journal = await open(); await journal.open(stream); await journal.append(change());
    const saved = await journal.read(stream.streamId);
    expect(() => replayContentJournal({ ...saved, entries: [] }, textReplay)).toThrow('HISTORY_INCOMPLETE_INTERVAL');
    expect(() => replayContentJournal(saved, { ...textReplay, profileId: 'newer/v2' })).toThrow('HISTORY_PROFILE_UNAVAILABLE');
    expect(() => replayContentJournal({ ...saved, entries: [{ ...saved.entries[0], receipt: { ...saved.entries[0].receipt, sequence: 2 } }] }, textReplay)).toThrow('HISTORY_INCOMPLETE_INTERVAL');
    journal.close();
  });
  it('captures caller values and rejects lossy JSON data', async () => {
    const journal = await open(); await journal.open(stream);
    const request = change(); const pending = journal.append(request);
    (request.delta as any).after = 'tampered';
    await pending;
    expect(replayContentJournal(await journal.read(stream.streamId), textReplay)).toBe('hello!');
    await expect(journal.append({ ...change(1), delta: NaN })).rejects.toThrow('HISTORY_NON_SERIALIZABLE');
    expect(historyCanonical({ b: 2, a: 1 })).toBe(historyCanonical({ a: 1, b: 2 }));
    journal.close();
  });
});

it('IDB commits entry, request index and head in one transaction across competing connections; reopens the acknowledged interval', async () => {
  const factory = new IDBFactory(); const dbName = 'multi-connection';
  const a = await createIndexedDbContentJournal({ factory, dbName });
  const b = await createIndexedDbContentJournal({ factory, dbName });
  await a.open(stream);
  const results = await Promise.all([a.append(change(0, 'a', 'actor-a')), b.append(change(0, 'b', 'actor-b'))]);
  expect(results.map(r => r.status).sort()).toEqual(['appended', 'conflict']);
  a.close(); b.close();
  const restarted = await createIndexedDbContentJournal({ factory, dbName });
  expect(replayContentJournal(await restarted.read(stream.streamId), textReplay)).toBe('hello!');
  const entry = (await restarted.read(stream.streamId)).entries[0];
  expect(entry.receipt.durability).toBe('workspace');
  expect(await restarted.append(entry.change)).toMatchObject({ status: 'duplicate' });
  restarted.close();
});

it('IDB change projection checks seed existence without fetching its payload', async () => {
  const factory = new IDBFactory(), dbName = 'changes-without-seed-copy';
  const journal = await createIndexedDbContentJournal({ factory, dbName });
  await journal.open({ ...stream, initial: { text: 'large'.repeat(10000) } });
  await journal.append(change());
  const originalGet = IDBObjectStore.prototype.get, originalGetKey = IDBObjectStore.prototype.getKey;
  let seedReads = 0, seedChecks = 0;
  try {
    IDBObjectStore.prototype.get = function (...args) { if (this.name === 'content-streams') seedReads++; return originalGet.apply(this, args); };
    IDBObjectStore.prototype.getKey = function (...args) { if (this.name === 'content-streams') seedChecks++; return originalGetKey.apply(this, args); };
    expect((await journal.readChanges!(stream.streamId)).head).toBe(1);
    expect(seedReads).toBe(0); expect(seedChecks).toBe(1);
    await journal.read(stream.streamId); expect(seedReads).toBe(1);
  } finally { IDBObjectStore.prototype.get = originalGet; IDBObjectStore.prototype.getKey = originalGetKey; }
  const request = factory.open(dbName);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const tx = db.transaction('content-streams', 'readwrite'); tx.objectStore('content-streams').delete(stream.streamId);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    await expect(journal.readChanges!(stream.streamId)).rejects.toThrow('HISTORY_STREAM_MISSING');
    await expect(journal.read(stream.streamId)).rejects.toThrow('HISTORY_STREAM_MISSING');
  } finally { db.close(); journal.close(); }
});

it('IDB head and complete projected records come from one transaction during append', async () => {
  const factory = new IDBFactory(), dbName = 'changes-concurrent';
  const a = await createIndexedDbContentJournal({ factory, dbName }), b = await createIndexedDbContentJournal({ factory, dbName });
  try {
    await a.open(stream);
    const [snapshot] = await Promise.all([a.readChanges!(stream.streamId), b.append(change())]);
    expect(snapshot.entries).toHaveLength(snapshot.head);
    expect(snapshot.entries.map(entry => entry.receipt.sequence)).toEqual(Array.from({ length: snapshot.head }, (_, index) => index + 1));
    expect((await a.readChanges!(stream.streamId)).head).toBe(1);
  } finally { a.close(); b.close(); }
});

it('IDB change projection propagates a missing head rather than substituting an empty history', async () => {
  const factory = new IDBFactory(), dbName = 'changes-missing-head';
  const journal = await createIndexedDbContentJournal({ factory, dbName }); await journal.open(stream);
  const request = factory.open(dbName);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const tx = db.transaction('content-heads', 'readwrite'); tx.objectStore('content-heads').delete(stream.streamId);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    await expect(journal.readChanges!(stream.streamId)).rejects.toThrow();
    await expect(journal.read(stream.streamId)).rejects.toThrow();
  } finally { db.close(); journal.close(); }
});
