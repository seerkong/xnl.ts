/** Content changes are independent of file materialization. No document, DG,
 * Halfcode, filesystem or editor objects are required by this contract. */
export type HistoryValue = null | boolean | number | string | readonly HistoryValue[]
  | { readonly [key: string]: HistoryValue };

export interface ContentStream {
  readonly streamId: string;
  readonly subject: { readonly scope: string; readonly id: string; readonly root: 'content' | 'files' };
  /** Versioned codec/identity/literal rules, not a filename extension. */
  readonly profile: { readonly id: string; readonly config: HistoryValue };
  readonly initial: HistoryValue;
}

export interface ContentChange {
  readonly streamId: string;
  readonly profileId: string;
  readonly actorId: string;
  readonly sessionEpoch: string;
  readonly requestId: string;
  readonly groupId: string;
  readonly base: number;
  /** Actual accepted delta from the content owner, never the command to replay. */
  readonly delta: HistoryValue;
  readonly cause?: { readonly kind: 'edit' | 'undo' | 'redo' | 'restore'; readonly change?: number };
}

export interface ContentChangeReceipt {
  readonly status: 'journal-durable';
  readonly streamId: string;
  readonly sequence: number;
  readonly durability: 'memory' | 'workspace';
}
export interface ContentJournalEntry {
  readonly change: ContentChange;
  readonly receipt: ContentChangeReceipt;
}
export type ContentAppendResult =
  | { readonly status: 'appended' | 'duplicate'; readonly receipt: ContentChangeReceipt }
  | { readonly status: 'conflict'; readonly actualHead: number; readonly reason: 'base' | 'request-reused' | 'profile' };

export interface ContentJournalChanges {
  readonly streamId: string;
  readonly profileId: string;
  readonly head: number;
  readonly entries: readonly ContentJournalEntry[];
}

export interface ContentJournal {
  /** Idempotent seed creation; a different seed under an existing ID is an error. */
  open(stream: ContentStream): Promise<void>;
  read(streamId: string): Promise<{ readonly stream: ContentStream; readonly head: number; readonly entries: readonly ContentJournalEntry[] }>;
  /** Independent snapshot of all ordered entries, 1 through head, from one
   * backend read. The immutable seed is omitted, never a different lineage.
   * Missing/closed streams fail just as read(); this is not pagination. */
  readChanges?(streamId: string): Promise<ContentJournalChanges>;
  append(change: ContentChange): Promise<ContentAppendResult>;
  /** Stable request lookup after a dropped ACK. */
  lookup(streamId: string, actorId: string, sessionEpoch: string, requestId: string): Promise<ContentJournalEntry | undefined>;
  close(): void;
}

export interface ContentUndoGroup { first: number; last: number; id: string; epoch: string }
/** Projection only: the original content owner still validates/applies every
 * inverse. Group IDs are scoped by actor and epoch, including after reopen. */
export function createContentUndoIndex(actorId: string) {
  const undo: ContentUndoGroup[] = [], redo: ContentUndoGroup[] = [];
  return {
    peek(direction: 'undo' | 'redo') { const group = (direction === 'undo' ? undo : redo).at(-1); return group ? { ...group } : undefined; },
    observe(entry: ContentJournalEntry) {
      const { change, receipt } = entry;
      if (change.actorId !== actorId) return;
      const group = { first: receipt.sequence, last: receipt.sequence, id: change.groupId, epoch: change.sessionEpoch };
      if (change.cause?.kind === 'undo' || change.cause?.kind === 'redo') {
        const source = change.cause.kind === 'undo' ? undo : redo, target = change.cause.kind === 'undo' ? redo : undo;
        if (source.at(-1)?.last !== change.cause.change) throw Error('HISTORY_UNDO_LINEAGE_INVALID');
        source.pop(); target.push(group);
      } else {
        const last = undo.at(-1);
        if (last?.id === group.id && last.epoch === group.epoch && last.last === group.first - 1) last.last = group.last;
        else undo.push(group);
        redo.length = 0;
      }
    },
  };
}

export function historyRequestKey(change: Pick<ContentChange, 'actorId' | 'sessionEpoch' | 'requestId'>): string {
  return JSON.stringify([change.actorId, change.sessionEpoch, change.requestId]);
}

/** Reject values that JSON would silently lose, and compare object key order
 * independently. Cost is proportional to the supplied delta, not its document. */
export function historyCanonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null || ancestors.has(value)) throw Error('HISTORY_NON_SERIALIZABLE');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw Error('HISTORY_NON_SERIALIZABLE');
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !property.enumerable || !Object.prototype.hasOwnProperty.call(property, 'value')
        || (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw Error('HISTORY_NON_SERIALIZABLE');
    }
    if (Array.isArray(value)) {
      const items = Array.from(value, item => historyCanonical(item, ancestors));
      return `[${items.join(',')}]`;
    }
    return `{${Object.keys(value).sort().map(key => {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.prototype.hasOwnProperty.call(property, 'value')) throw Error('HISTORY_NON_SERIALIZABLE');
      return `${JSON.stringify(key)}:${historyCanonical(property.value, ancestors)}`;
    }).join(',')}}`;
  } finally { ancestors.delete(value); }
}

export function validateContentStream(stream: ContentStream): void {
  historyCanonical(stream);
  for (const value of [stream.streamId, stream.subject.scope, stream.subject.id, stream.profile.id]) requireId(value);
  if (stream.subject.root !== 'content' && stream.subject.root !== 'files') throw Error('HISTORY_INVALID_ROOT');
}
export function validateContentChange(change: ContentChange): void {
  historyCanonical(change);
  for (const value of [change.streamId, change.profileId, change.actorId, change.sessionEpoch, change.requestId, change.groupId]) requireId(value);
  if (!Number.isSafeInteger(change.base) || change.base < 0) throw Error('HISTORY_INVALID_BASE');
  if (change.cause && !['edit', 'undo', 'redo', 'restore'].includes(change.cause.kind)) throw Error('HISTORY_INVALID_CAUSE');
  if ((change.cause?.kind === 'undo' || change.cause?.kind === 'redo') && change.cause.change === undefined) throw Error('HISTORY_INVALID_CAUSE');
  if (change.cause?.change !== undefined && (!Number.isSafeInteger(change.cause.change) || change.cause.change < 1 || change.cause.change > change.base))
    throw Error('HISTORY_INVALID_CAUSE');
}
function requireId(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) throw Error('HISTORY_INVALID_ID');
}

export function checkContentAppend(
  change: ContentChange, profileId: string, head: number, previous?: ContentJournalEntry,
): ContentAppendResult | undefined {
  if (previous) return historyCanonical(previous.change) === historyCanonical(change)
    ? { status: 'duplicate', receipt: previous.receipt }
    : { status: 'conflict', actualHead: head, reason: 'request-reused' };
  if (change.profileId !== profileId) return { status: 'conflict', actualHead: head, reason: 'profile' };
  if (change.base !== head) return { status: 'conflict', actualHead: head, reason: 'base' };
}

export function createMemoryContentJournal(): ContentJournal {
  const streams = new Map<string, { stream: ContentStream; entries: ContentJournalEntry[]; requests: Map<string, ContentJournalEntry> }>();
  let closed = false;
  function get(id: string) {
    if (closed) throw Error('HISTORY_CLOSED');
    const state = streams.get(id);
    if (!state) throw Error('HISTORY_STREAM_MISSING');
    return state;
  }
  return {
    async open(stream) {
      if (closed) throw Error('HISTORY_CLOSED');
      validateContentStream(stream);
      const previous = streams.get(stream.streamId);
      if (previous && historyCanonical(previous.stream) !== historyCanonical(stream)) throw Error('HISTORY_SEED_CONFLICT');
      if (!previous) streams.set(stream.streamId, { stream: structuredClone(stream), entries: [], requests: new Map() });
    },
    async read(id) {
      const state = get(id);
      return structuredClone({ stream: state.stream, head: state.entries.length, entries: state.entries });
    },
    async readChanges(id) {
      const state = get(id);
      return structuredClone({ streamId: state.stream.streamId, profileId: state.stream.profile.id,
        head: state.entries.length, entries: state.entries });
    },
    async append(input) {
      validateContentChange(input);
      const change = structuredClone(input);
      const state = get(change.streamId);
      const key = historyRequestKey(change);
      const checked = checkContentAppend(change, state.stream.profile.id, state.entries.length, state.requests.get(key));
      if (checked) return structuredClone(checked);
      const receipt: ContentChangeReceipt = { status: 'journal-durable', streamId: change.streamId, sequence: state.entries.length + 1, durability: 'memory' };
      const entry = { change, receipt };
      state.entries.push(entry);
      state.requests.set(key, entry);
      return { status: 'appended', receipt: structuredClone(receipt) };
    },
    async lookup(id, actorId, sessionEpoch, requestId) {
      return structuredClone(get(id).requests.get(historyRequestKey({ actorId, sessionEpoch, requestId })));
    },
    close() { closed = true; },
  };
}

function validateJournalEntry(entry: ContentJournalEntry, index: number, streamId: string, profileId: string, requests: Set<string>): void {
  const { change, receipt } = entry;
  validateContentChange(change);
  const key = historyRequestKey(change);
  if (change.streamId !== streamId || change.profileId !== profileId || change.base !== index
    || receipt.streamId !== change.streamId || receipt.sequence !== index + 1 || receipt.status !== 'journal-durable' || requests.has(key)) {
    throw Error('HISTORY_INCOMPLETE_INTERVAL');
  }
  requests.add(key);
}

/** Validate an acknowledged interval without decoding its immutable seed.
 * This checks record continuity/provenance, never current domain admission. */
export function validateContentJournalChanges(snapshot: ContentJournalChanges): void {
  if (typeof snapshot.streamId !== 'string' || !snapshot.streamId || typeof snapshot.profileId !== 'string' || !snapshot.profileId
    || !Number.isSafeInteger(snapshot.head) || snapshot.head < 0 || !Array.isArray(snapshot.entries) || snapshot.head !== snapshot.entries.length) {
    throw Error('HISTORY_INCOMPLETE_INTERVAL');
  }
  const requests = new Set<string>();
  for (let index = 0; index < snapshot.entries.length; index++) {
    validateJournalEntry(snapshot.entries[index]!, index, snapshot.streamId, snapshot.profileId, requests);
  }
}

/** Recovery validates a continuous acknowledged interval before replay. An
 * unavailable profile is an error, never an excuse to drop a durable tail. */
export function replayContentJournal<T>(
  snapshot: Awaited<ReturnType<ContentJournal['read']>>,
  runtime: { readonly profileId: string; readonly decode: (value: HistoryValue) => T;
    readonly apply: (value: T, delta: HistoryValue, profile: ContentStream['profile']) => T;
    /** Supplied only after the storage owner verified its materialization
     * receipt/base. Entries before it are still checked, but not re-applied. */
    readonly checkpoint?: { readonly sequence: number; readonly value: T } },
): T {
  validateContentStream(snapshot.stream);
  if (runtime.profileId !== snapshot.stream.profile.id) throw Error('HISTORY_PROFILE_UNAVAILABLE');
  if (snapshot.head !== snapshot.entries.length) throw Error('HISTORY_INCOMPLETE_INTERVAL');
  if (runtime.checkpoint && (!Number.isSafeInteger(runtime.checkpoint.sequence) || runtime.checkpoint.sequence < 0 || runtime.checkpoint.sequence > snapshot.head)) throw Error('HISTORY_INVALID_CHECKPOINT');
  let value = runtime.checkpoint ? runtime.checkpoint.value : runtime.decode(snapshot.stream.initial);
  const requests = new Set<string>();
  for (let i = 0; i < snapshot.entries.length; i++) {
    const { change } = snapshot.entries[i];
    validateJournalEntry(snapshot.entries[i]!, i, snapshot.stream.streamId, runtime.profileId, requests);
    if (i >= (runtime.checkpoint?.sequence ?? 0)) value = runtime.apply(value, change.delta, snapshot.stream.profile);
  }
  return value;
}
