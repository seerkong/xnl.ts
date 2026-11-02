import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ensureDurableDirectory, syncFsDirectory as syncDirectory } from './local-fs-durability';
import { checkContentAppend, historyCanonical, historyRequestKey, validateContentChange, validateContentStream,
  type ContentJournal, type ContentJournalEntry, type ContentStream } from './content-history';

/** Local POSIX journal. An immutable numbered entry is the commit point, using
 * link(2) as create-if-absent CAS. No mutable head, lock lease, or whole-log
 * rewrite is needed. fsync(file + directory) precedes a durable receipt.
 * A crash may leave an unacknowledged committed entry; stable request lookup
 * resolves it. Temporary files are never considered committed history. */
export function createLocalFsContentJournal(config: { storageRootPath: string }): ContentJournal {
  const root = path.resolve(config.storageRootPath);
  ensureDurableDirectory(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('HISTORY_UNSAFE_STORAGE_ROOT');
  let closed = false;
  type State = { stream: ContentStream; entries: ContentJournalEntry[]; requests: Map<string, ContentJournalEntry> };
  const states = new Map<string, State>();
  const directory = (id: string) => path.join(root, createHash('sha256').update(id).digest('hex'));
  const active = () => { if (closed) throw Error('HISTORY_CLOSED'); };
  function read(file: string): unknown | undefined {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  function publish(file: string, value: unknown): boolean {
    const dir = path.dirname(file), temporary = path.join(dir, `.pending-${randomUUID()}`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, historyCanonical(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      try { fs.linkSync(temporary, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      syncDirectory(dir); return true;
    } finally { fs.unlinkSync(temporary); }
  }
  function refresh(id: string): State {
    active();
    let state = states.get(id);
    if (!state) {
      const seed = read(path.join(directory(id), 'stream.json')) as ContentStream | undefined;
      if (!seed) throw Error('HISTORY_STREAM_MISSING');
      validateContentStream(seed);
      if (seed.streamId !== id) throw Error('HISTORY_INVALID_STREAM');
      state = { stream: seed, entries: [], requests: new Map() }; states.set(id, state);
    }
    while (true) {
      const sequence = state.entries.length + 1;
      const entry = read(path.join(directory(id), `${sequence}.json`)) as ContentJournalEntry | undefined;
      if (!entry) break;
      validateContentChange(entry.change);
      if (entry.change.streamId !== id || entry.change.profileId !== state.stream.profile.id || entry.change.base !== sequence - 1
        || entry.receipt.streamId !== id || entry.receipt.sequence !== sequence || entry.receipt.status !== 'journal-durable'
        || entry.receipt.durability !== 'workspace' || state.requests.has(historyRequestKey(entry.change))) throw Error('HISTORY_INVALID_INTERVAL');
      state.entries.push(entry); state.requests.set(historyRequestKey(entry.change), entry);
    }
    return state;
  }
  return {
    async open(stream) {
      active(); validateContentStream(stream);
      const dir = directory(stream.streamId);
      ensureDurableDirectory(dir); syncDirectory(root);
      if (fs.lstatSync(dir).isSymbolicLink()) throw Error('HISTORY_UNSAFE_STORAGE_ROOT');
      publish(path.join(dir, 'stream.json'), stream);
      if (historyCanonical(refresh(stream.streamId).stream) !== historyCanonical(stream)) throw Error('HISTORY_SEED_CONFLICT');
    },
    async read(id) {
      const state = refresh(id);
      // Explicit recovery/export verifies no committed suffix is hidden by a gap.
      const count = fs.readdirSync(directory(id)).filter(name => /^[1-9][0-9]*\.json$/.test(name)).length;
      if (count !== state.entries.length) throw Error('HISTORY_INCOMPLETE_INTERVAL');
      return structuredClone({ stream: state.stream, entries: state.entries, head: state.entries.length });
    },
    async append(change) {
      active(); validateContentChange(change);
      const state = refresh(change.streamId);
      const checked = checkContentAppend(change, state.stream.profile.id, state.entries.length, state.requests.get(historyRequestKey(change)));
      if (checked) {
        if (checked.status === 'duplicate') syncDirectory(directory(change.streamId));
        return structuredClone(checked);
      }
      const entry: ContentJournalEntry = { change: structuredClone(change), receipt: { status: 'journal-durable', streamId: change.streamId, sequence: change.base + 1, durability: 'workspace' } };
      if (!publish(path.join(directory(change.streamId), `${entry.receipt.sequence}.json`), entry)) {
        const fresh = refresh(change.streamId);
        return structuredClone(checkContentAppend(change, fresh.stream.profile.id, fresh.entries.length, fresh.requests.get(historyRequestKey(change)))!);
      }
      refresh(change.streamId);
      return { status: 'appended', receipt: structuredClone(entry.receipt) };
    },
    async lookup(id, actorId, sessionEpoch, requestId) {
      return structuredClone(refresh(id).requests.get(historyRequestKey({ actorId, sessionEpoch, requestId })));
    },
    close() { closed = true; states.clear(); },
  };
}
