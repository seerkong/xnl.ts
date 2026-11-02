import type { DataElementNode } from 'xnl-core';
import { applyVfsSnapshotMutations, diffVfsSnapshots, type VfsMutation } from './vfs-mutations';
import { VirtualFileSystem } from './vfs';
import { historyCanonical, type ContentJournal } from './content-history';
import { encodeXnlHistoryValue } from './xnl-content-history';
import type { RevisionedVfsAuthority, VfsRevision, RevisionedVfsOperationResult, RevisionedVfsCompareAndSwapResult } from './revisioned-persistence';

export interface FileTransaction {
  operationId: string; expectedRevision: VfsRevision; mutations: VfsMutation[];
  /** Causal references only: file Save does not replay content edits. */
  through?: { fileId: string; streamId: string; throughChange: number }[];
  restores?: string;
}
type Prepared = { stage: 'prepared'; request: FileTransaction; snapshot: DataElementNode };
type Materialized = { stage: 'materialized'; operationId: string; result: RevisionedVfsOperationResult };
type Rejected = { stage: 'rejected'; operationId: string; result: Exclude<RevisionedVfsCompareAndSwapResult, RevisionedVfsOperationResult> };

/** File-level save coordinator over the existing VFS authority. One explicit
 * batch is one file operation; content journals remain separate. Cross-store
 * durability is an outbox + authority receipt, never a fictional DB transaction. */
export function createFileWorkspace(input: { authority: RevisionedVfsAuthority; journal: ContentJournal; scope: string;
  actorId: string; sessionEpoch: string;
  checkpoints?: { append(input: { snapshot: DataElementNode; operationId: string; revision: VfsRevision; through: NonNullable<FileTransaction['through']> }): Promise<unknown> } }) {
  const streamId = JSON.stringify([input.scope, 'workspace', 'files']);
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>) => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
  async function readLog() {
    try { return await input.journal.read(streamId); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'HISTORY_STREAM_MISSING') throw error; }
    const initial = await input.authority.read();
    await input.journal.open({ streamId, subject: { scope: input.scope, id: 'workspace', root: 'files' },
      profile: { id: 'vfs/materialization/v1', config: {} }, initial: encodeXnlHistoryValue(initial) });
    return input.journal.read(streamId);
  }
  async function event(delta: Prepared | Materialized | Rejected, base: number) {
    const id = delta.stage === 'prepared' ? delta.request.operationId : delta.operationId;
    const result = await input.journal.append({ streamId, profileId: 'vfs/materialization/v1', actorId: input.actorId,
      sessionEpoch: 'file-materialization-v1', requestId: `${id}:${delta.stage}`, groupId: id, base, delta: encodeXnlHistoryValue(delta) });
    if (result.status === 'conflict') throw Error(`FILE_JOURNAL_${result.reason}`);
    return result;
  }
  async function state() {
    const log = await readLog();
    if (log.stream.profile.id !== 'vfs/materialization/v1') throw Error('FILE_PROFILE_UNAVAILABLE');
    const prepared = new Map<string, Prepared>(), complete = new Map<string, Materialized>(), rejected = new Map<string, Rejected>();
    let pending: Prepared | undefined;
    for (let i = 0; i < log.entries.length; i++) {
      const entry = log.entries[i], delta = entry.change.delta as unknown as Prepared | Materialized | Rejected;
      if (entry.change.base !== i || entry.receipt.sequence !== i + 1) throw Error('FILE_HISTORY_INCOMPLETE');
      if (delta.stage === 'prepared' && !pending && !prepared.has(delta.request.operationId)) { pending = delta; prepared.set(delta.request.operationId, delta); }
      else if (delta.stage === 'materialized' && pending?.request.operationId === delta.operationId) { complete.set(delta.operationId, delta); pending = undefined; }
      else if (delta.stage === 'rejected' && pending?.request.operationId === delta.operationId) { rejected.set(delta.operationId, delta); pending = undefined; }
      else throw Error('FILE_HISTORY_INCOMPLETE');
    }
    return { log, prepared, complete, rejected, pending };
  }
  async function complete(prepared: Prepared, base: number) {
    if (!input.authority.lookupOperation) throw Error('FILE_RECEIPT_CAPABILITY_REQUIRED');
    let result: RevisionedVfsCompareAndSwapResult | undefined = await input.authority.lookupOperation(prepared.request.operationId);
    result ??= await input.authority.compareAndSwap({ operationId: prepared.request.operationId,
      expectedRevision: prepared.request.expectedRevision, snapshot: prepared.snapshot });
    if (result.status !== 'applied' && result.status !== 'unchanged') {
      // Only an authoritative, definite rejection closes the outbox. An
      // exception/unknown result remains pending for receipt reconciliation.
      await event({ stage: 'rejected', operationId: prepared.request.operationId, result }, base);
      return result;
    }
    await event({ stage: 'materialized', operationId: prepared.request.operationId, result }, base);
    return checkpoint(prepared, result);
  }
  async function checkpoint(prepared: Prepared, result: RevisionedVfsOperationResult) {
    if (!input.checkpoints) return result;
    try {
      await input.checkpoints.append({ snapshot: prepared.snapshot, operationId: prepared.request.operationId,
        revision: result.status === 'applied' ? result.receipt.revision : result.revision, through: prepared.request.through ?? [] });
      return { ...result, history: { status: 'checkpointed' as const } };
    } catch (error) { return { ...result, history: { status: 'failed' as const, error: String(error) } }; }
  }
  const port = {
    read: () => input.authority.read(),
    history: () => readLog(),
    commit: (request: FileTransaction) => serial(async () => {
      if (!input.authority.lookupOperation) throw Error('FILE_RECEIPT_CAPABILITY_REQUIRED');
      const current = await state(), prior = current.prepared.get(request.operationId);
      if (prior && historyCanonical(encodeXnlHistoryValue(prior.request)) !== historyCanonical(encodeXnlHistoryValue(request))) throw Error('FILE_REQUEST_REUSED');
      if (current.complete.has(request.operationId)) return checkpoint(prior!, current.complete.get(request.operationId)!.result);
      if (current.rejected.has(request.operationId)) return current.rejected.get(request.operationId)!.result;
      if (current.pending) {
        if (current.pending.request.operationId !== request.operationId) throw Error('FILE_PENDING_OPERATION');
        return complete(current.pending, current.log.head);
      }
      const before = await input.authority.read();
      if (historyCanonical(before.revision) !== historyCanonical(request.expectedRevision)) throw Error('FILE_BASE_CONFLICT');
      const snapshot = applyVfsSnapshotMutations(before.snapshot, request.mutations);
      const prepared: Prepared = { stage: 'prepared', request: structuredClone(request), snapshot };
      await event(prepared, current.log.head);
      return complete(prepared, current.log.head + 1);
    }),
    reconcile: () => serial(async () => { const current = await state(); return current.pending ? complete(current.pending, current.log.head) : undefined; }),
    /** Stable file identity follows rename; deletion conflicts with an open buffer. */
    prepareContentSave: async (capture: { fileId: string; content: string; codec: 'utf8' | 'base64'; streamId: string; throughChange: number },
      base: { revision: VfsRevision; content: string }, operationId: string): Promise<FileTransaction> => {
      const observed = await input.authority.read(), vfs = new VirtualFileSystem(observed.snapshot);
      if (historyCanonical(observed.revision) !== historyCanonical(base.revision)) {
        const current = await state();
        let revision = base.revision;
        for (const [id, completion] of current.complete) {
          const preparation = current.prepared.get(id)!;
          if (historyCanonical(preparation.request.expectedRevision) !== historyCanonical(revision)) continue;
          if (preparation.request.mutations.some(m => m.type !== 'MOVE' && m.type !== 'RENAME')) throw Error('FILE_CONTENT_BASE_CONFLICT');
          revision = completion.result.status === 'applied' ? completion.result.receipt.revision : completion.result.revision;
        }
        if (historyCanonical(revision) !== historyCanonical(observed.revision)) throw Error('FILE_CONTENT_BASE_CONFLICT');
      }
      const content = await input.journal.read(capture.streamId);
      if (content.stream.subject.id !== capture.fileId || content.stream.subject.root !== 'content'
        || typeof content.stream.initial !== 'string' || !Number.isSafeInteger(capture.throughChange)
        || capture.throughChange < 0 || capture.throughChange > content.head) throw Error('FILE_CONTENT_BINDING_INVALID');
      const current = await state();
      let materializedContent = content.stream.initial;
      let materializedRevision = (content.stream.profile.config as any)?.initialFileRevision as VfsRevision | undefined;
      let materializedOperation: string | undefined;
      for (const [id, completion] of current.complete) {
        const preparation = current.prepared.get(id)!;
        if (!preparation.request.through?.some(item => item.fileId === capture.fileId && item.streamId === capture.streamId)) continue;
        const tree = new VirtualFileSystem(preparation.snapshot), file = tree.getPathIndex().resolvePath(capture.fileId);
        if (!file) throw Error('FILE_CONTENT_BINDING_INVALID');
        materializedContent = tree.readFile(file);
        materializedRevision = completion.result.status === 'applied' ? completion.result.receipt.revision : completion.result.revision;
        materializedOperation = id;
      }
      // A reopened buffer may replay an older stream. Its caller cannot make
      // that content fresh by supplying the external file's current revision.
      if (base.content !== materializedContent) throw Error('FILE_CONTENT_BASE_CONFLICT');
      if (!materializedRevision) throw Error('FILE_CONTENT_INITIAL_BINDING_REQUIRED');
      if (materializedRevision) {
        let revision = materializedRevision;
        let afterMaterialization = !materializedOperation;
        for (const [id, completion] of current.complete) {
          if (id === materializedOperation) { afterMaterialization = true; continue; }
          if (!afterMaterialization) continue;
          const preparation = current.prepared.get(id)!;
          if (historyCanonical(preparation.request.expectedRevision) !== historyCanonical(revision)) continue;
          if (preparation.request.mutations.some(m => m.type !== 'MOVE' && m.type !== 'RENAME')) throw Error('FILE_CONTENT_BASE_CONFLICT');
          revision = completion.result.status === 'applied' ? completion.result.receipt.revision : completion.result.revision;
        }
        if (historyCanonical(revision) !== historyCanonical(observed.revision)) throw Error('FILE_CONTENT_BASE_CONFLICT');
      }
      const file = vfs.getPathIndex().resolvePath(capture.fileId);
      if (!file) throw Error('FILE_DELETED');
      if (vfs.readFile(file) !== base.content) throw Error('FILE_CONTENT_CONFLICT');
      // Rebase path-only changes by stable identity, never changed file content.
      const binary = vfs.readFileType(file) === 'binary';
      if (binary !== (capture.codec === 'base64')) throw Error('FILE_CODEC_CONFLICT');
      return { operationId, expectedRevision: observed.revision, mutations: [{ type: 'CONTENT_UPDATE', path: file, expectedId: capture.fileId,
        payload: { content: capture.content } }], through: [{ fileId: capture.fileId, streamId: capture.streamId, throughChange: capture.throughChange }] };
    },
  };
  return { ...port,
    async restore(input: { version: string; operationId: string; expectedRevision: VfsRevision }) {
      const current = await state(), observed = await port.read();
      if (historyCanonical(observed.revision) !== historyCanonical(input.expectedRevision)) throw Error('FILE_BASE_CONFLICT');
      const prior = current.prepared.get(input.version);
      if (input.version !== 'initial' && (!prior || !current.complete.has(input.version))) throw Error('FILE_VERSION_NOT_FOUND');
      const target = input.version === 'initial' ? (current.log.stream.initial as unknown as { snapshot: DataElementNode }).snapshot : prior!.snapshot;
      return port.commit({ operationId: input.operationId, expectedRevision: input.expectedRevision,
        mutations: diffVfsSnapshots(observed.snapshot, target), restores: input.version });
    },
  };
}
