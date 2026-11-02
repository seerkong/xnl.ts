import { requestToPromise, transactionDone } from './indexeddb-schema';
import {
  checkContentAppend, historyCanonical, historyRequestKey, validateContentChange, validateContentStream,
  type ContentJournal, type ContentStream, type ContentJournalEntry, type ContentChangeReceipt,
} from './content-history';

const STORES = ['content-streams', 'content-heads', 'content-changes', 'content-requests'] as const;

/** Owns only its named content journal database. A separate document/VCS save
 * is not atomic with this transaction and must use a correlated save receipt. */
export async function createIndexedDbContentJournal(input: { readonly factory: IDBFactory; readonly dbName: string }): Promise<ContentJournal> {
  const opening = input.factory.open(input.dbName, 1);
  opening.onupgradeneeded = () => {
    for (const store of STORES) {
      const created = opening.result.createObjectStore(store);
      if (store === 'content-changes') created.createIndex('stream', 'change.streamId');
    }
  };
  const db = await requestToPromise(opening);
  db.onversionchange = () => db.close();
  async function transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = db.transaction([...STORES], mode);
    const done = transactionDone(tx);
    // Install rejection handling immediately, also when an action aborts.
    void done.catch(() => undefined);
    try {
      const result = await action(tx);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already completed/aborted */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
  async function stream(tx: IDBTransaction, id: string): Promise<ContentStream> {
    const value = await requestToPromise(tx.objectStore(STORES[0]).get(id)) as ContentStream | undefined;
    if (!value) throw Error('HISTORY_STREAM_MISSING');
    return value;
  }
  return {
    async open(input) {
      validateContentStream(input);
      const captured = structuredClone(input);
      await transaction('readwrite', async tx => {
        const store = tx.objectStore(STORES[0]);
        const previous = await requestToPromise(store.get(captured.streamId));
        if (previous && historyCanonical(previous) !== historyCanonical(captured)) throw Error('HISTORY_SEED_CONFLICT');
        if (!previous) {
          store.add(captured, captured.streamId);
          tx.objectStore(STORES[1]).add({ head: 0, profileId: captured.profile.id }, captured.streamId);
        }
      });
    },
    async read(id) {
      return transaction('readonly', async tx => {
        const initial = await stream(tx, id);
        const state = await requestToPromise(tx.objectStore(STORES[1]).get(id));
        const entries = await requestToPromise(tx.objectStore(STORES[2]).index('stream').getAll(id)) as ContentJournalEntry[];
        return { stream: initial, head: state.head as number, entries: entries.sort((a, b) => a.receipt.sequence - b.receipt.sequence) };
      });
    },
    async readChanges(id) {
      return transaction('readonly', async tx => {
        // Check the seed still exists without retrieving/cloning its value.
        const seed = await requestToPromise(tx.objectStore(STORES[0]).getKey(id));
        if (seed === undefined) throw Error('HISTORY_STREAM_MISSING');
        const state = await requestToPromise(tx.objectStore(STORES[1]).get(id));
        const entries = await requestToPromise(tx.objectStore(STORES[2]).index('stream').getAll(id)) as ContentJournalEntry[];
        return { streamId: id, profileId: state.profileId as string, head: state.head as number,
          entries: entries.sort((a, b) => a.receipt.sequence - b.receipt.sequence) };
      });
    },
    async append(input) {
      validateContentChange(input);
      const change = structuredClone(input);
      return transaction('readwrite', async tx => {
        const heads = tx.objectStore(STORES[1]);
        // No seed/snapshot read on the high-frequency path.
        const state = await requestToPromise(heads.get(change.streamId));
        if (!state) throw Error('HISTORY_STREAM_MISSING');
        const requestKey = [change.streamId, historyRequestKey(change)];
        const requests = tx.objectStore(STORES[3]);
        const priorSequence = await requestToPromise(requests.get(requestKey)) as number | undefined;
        const previous = priorSequence === undefined ? undefined
          : await requestToPromise(tx.objectStore(STORES[2]).get([change.streamId, priorSequence])) as ContentJournalEntry;
        const checked = checkContentAppend(change, state.profileId, state.head, previous);
        if (checked) return checked;
        const receipt: ContentChangeReceipt = { status: 'journal-durable', streamId: change.streamId, sequence: state.head + 1, durability: 'workspace' };
        const entry = { change, receipt };
        tx.objectStore(STORES[2]).add(entry, [change.streamId, receipt.sequence]);
        requests.add(receipt.sequence, requestKey);
        heads.put({ head: receipt.sequence, profileId: state.profileId }, change.streamId);
        return { status: 'appended' as const, receipt };
      });
    },
    async lookup(id, actorId, sessionEpoch, requestId) {
      return transaction('readonly', async tx => {
        const sequence = await requestToPromise(tx.objectStore(STORES[3]).get([id, historyRequestKey({ actorId, sessionEpoch, requestId })])) as number | undefined;
        return sequence === undefined ? undefined
          : await requestToPromise(tx.objectStore(STORES[2]).get([id, sequence])) as ContentJournalEntry;
      });
    },
    close() { db.close(); },
  };
}
