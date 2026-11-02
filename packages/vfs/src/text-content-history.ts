import { createContentUndoIndex, historyCanonical, replayContentJournal, validateContentChange, type ContentChange, type ContentJournal, type HistoryValue } from './content-history';
import type { VfsRevision } from './revisioned-persistence';

export const TEXT_CONTENT_PROFILE = 'text/splice-utf16/v1';
export interface TextSplice { offset: number; removed: string; inserted: string }
export function applyTextSplice(value: string, delta: HistoryValue): string {
  if (Array.isArray(delta)) return delta.reduce<string>((value, item) => applyTextSplice(value, item), value);
  const splice = delta as unknown as TextSplice;
  if (!splice || !Number.isSafeInteger(splice.offset) || splice.offset < 0
    || typeof splice.removed !== 'string' || typeof splice.inserted !== 'string'
    || splice.offset + splice.removed.length > value.length
    || value.slice(splice.offset, splice.offset + splice.removed.length) !== splice.removed)
    throw Error('TEXT_SPLICE_CONFLICT');
  return value.slice(0, splice.offset) + splice.inserted + value.slice(splice.offset + splice.removed.length);
}

/** A plain-text content owner, independent of extension, document schema and
 * host. The file owner is only consulted on explicit save. Accepted changes
 * remain retryable after journal failure; retry never applies the splice twice. */
export async function openTextContent(input: {
  journal: ContentJournal; scope: string; fileId: string; actorId: string; sessionEpoch: string;
  initial: string; codec: 'utf8';
  /** Initial carrier version, captured with initial text. Required for file Save;
   * standalone text owners may omit it. Reopen never replaces this binding. */
  fileRevision?: VfsRevision;
}) {
  const streamId = JSON.stringify([input.scope, input.fileId, 'content']);
  const profile = { id: TEXT_CONTENT_PROFILE, config: { codec: input.codec,
    ...(input.fileRevision ? { initialFileRevision: structuredClone(input.fileRevision) as unknown as HistoryValue } : {}) } };
  let history;
  try { history = await input.journal.read(streamId); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'HISTORY_STREAM_MISSING') throw error;
    await input.journal.open({ streamId, subject: { scope: input.scope, id: input.fileId, root: 'content' }, profile, initial: input.initial });
    history = await input.journal.read(streamId);
  }
  if (history.stream.profile.id !== profile.id || (history.stream.profile.config as any)?.codec !== input.codec) throw Error('TEXT_PROFILE_UNAVAILABLE');
  let value = replayContentJournal(history, { profileId: TEXT_CONTENT_PROFILE,
    decode: initial => { if (typeof initial !== 'string') throw Error('TEXT_SEED_INVALID'); return initial; }, apply: applyTextSplice });
  let head = history.head, closed = false;
  const groups = createContentUndoIndex(input.actorId);
  history.entries.forEach(entry => groups.observe(entry));
  let pending: ContentChange | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>) => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
  const active = () => { if (closed) throw Error('TEXT_OWNER_CLOSED'); };
  async function persist() {
    active(); if (!pending) return;
    const receipt = await input.journal.append(pending);
    if (receipt.status === 'conflict') throw Error(`TEXT_JOURNAL_${receipt.reason}`);
    active(); groups.observe({ change: pending, receipt: receipt.receipt }); head = receipt.receipt.sequence; pending = undefined;
    return receipt.receipt;
  }
  async function accept(change: ContentChange) {
    validateContentChange(change);
    const previous = await input.journal.lookup(streamId, input.actorId, input.sessionEpoch, change.requestId);
    if (previous) {
      if (historyCanonical(change) !== historyCanonical(previous.change)) throw Error('TEXT_REQUEST_REUSED');
      return previous.receipt;
    }
    if (change.base !== head) throw Error('TEXT_BASE_CONFLICT');
    const next = applyTextSplice(value, change.delta);
    pending = change; value = next;
    return persist();
  }
  return {
    read: () => ({ text: value, throughChange: head, journalPending: !!pending }),
    edit: (request: { expectedHead: number; requestId: string; groupId: string; splice: TextSplice }) => serial(async () => {
      active();
      if (pending) throw Error('TEXT_RETRY_REQUIRED');
      const change: ContentChange = { streamId, profileId: profile.id, actorId: input.actorId, sessionEpoch: input.sessionEpoch,
        requestId: request.requestId, groupId: request.groupId, base: request.expectedHead,
        delta: { ...request.splice } };
      // Fact and candidate are retained in the same owner transition.
      return accept(change);
    }),
    revert: (direction: 'undo' | 'redo', request: { expectedHead: number; requestId: string }) => serial(async () => {
      active(); if (pending) throw Error('TEXT_RETRY_REQUIRED');
      if (request.expectedHead !== head) throw Error('TEXT_BASE_CONFLICT');
      const group = groups.peek(direction); if (!group) return undefined;
      const snapshot = await input.journal.read(streamId);
      if (snapshot.head !== head) throw Error('TEXT_BASE_CONFLICT');
      // Until a text rebase strategy is installed, refuse a contribution from
      // another actor after this group. Never overwrite their text implicitly.
      if (snapshot.entries.slice(group.last).some(entry => entry.change.actorId !== input.actorId)) throw Error('TEXT_INTERVENING_ACTOR');
      const original = snapshot.entries.slice(group.first - 1, group.last)
        .flatMap(entry => Array.isArray(entry.change.delta) ? entry.change.delta : [entry.change.delta]) as unknown as TextSplice[];
      const inverse = [...original].reverse().map(splice => ({ offset: splice.offset, removed: splice.inserted, inserted: splice.removed }));
      return accept({ streamId, profileId: profile.id, actorId: input.actorId, sessionEpoch: input.sessionEpoch, requestId: request.requestId,
        groupId: request.requestId, base: head, delta: inverse, cause: { kind: direction, change: group.last } });
    }),
    retry: () => serial(persist),
    capture: () => { active(); if (pending) throw Error('TEXT_RETRY_REQUIRED'); return { fileId: input.fileId, content: value, codec: input.codec, throughChange: head, streamId }; },
    close() { closed = true; },
  };
}
