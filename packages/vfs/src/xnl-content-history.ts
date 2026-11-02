import { captureImmutableData, diffNodes, dryRunMutations, dryRunImmutableMutations, parsePath, type XnlNode, type XnlMutation, type XnlMutationBatchOptions } from 'xnl-core';
import { historyCanonical, replayContentJournal, validateContentJournalChanges, type ContentJournal, type ContentStream, type HistoryValue } from './content-history';

export const XNL_CONTENT_PROFILE = 'xnl/strict-mutation/v1';
export type XnlHistoryOptions = Pick<XnlMutationBatchOptions, 'metadataIdMode' | 'identityPolicy' | 'literalValuePaths' | 'literalAttributeRules'>;

/** XNL parser/mutation optional object fields may be undefined. This codec
 * explicitly treats them as absent; it rejects undefined array entries and all
 * other lossy JSON values. Literal grammar roles live in the persisted profile. */
export function encodeXnlHistoryValue(value: unknown, ancestors = new Set<object>()): HistoryValue {
  if (value === null || typeof value !== 'object') {
    historyCanonical(value);
    return value as HistoryValue;
  }
  if (ancestors.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw Error('HISTORY_NON_SERIALIZABLE');
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !property.enumerable || !Object.prototype.hasOwnProperty.call(property, 'value')
        || (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw Error('HISTORY_NON_SERIALIZABLE');
    }
    if (Array.isArray(value)) return Array.from(value, item => encodeXnlHistoryValue(item, ancestors));
    const result: Record<string, HistoryValue> = {};
    for (const key of Object.keys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.prototype.hasOwnProperty.call(property, 'value')) throw Error('HISTORY_NON_SERIALIZABLE');
      if (property.value !== undefined) Object.defineProperty(result, key, { value: encodeXnlHistoryValue(property.value, ancestors), enumerable: true, configurable: true, writable: true });
    }
    return result;
  } finally { ancestors.delete(value); }
}

export function xnlHistoryProfile(options: XnlHistoryOptions = {}): ContentStream['profile'] {
  return { id: XNL_CONTENT_PROFILE, config: {
    metadataIdMode: options.metadataIdMode ?? 'identity',
    identityPolicy: options.identityPolicy ?? 'allow-missing',
    literalValuePaths: structuredClone(options.literalValuePaths ?? []) as HistoryValue,
    literalAttributeRules: structuredClone(options.literalAttributeRules ?? []) as HistoryValue,
  } };
}

function optionsFromProfile(profile: ContentStream['profile']): XnlMutationBatchOptions {
  if (profile.id !== XNL_CONTENT_PROFILE) throw Error('HISTORY_PROFILE_UNAVAILABLE');
  const value = profile.config as Record<string, HistoryValue>;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['identity', 'metadata'].includes(value.metadataIdMode as string)
    || !['allow-missing', 'require-elements'].includes(value.identityPolicy as string)
    || !Array.isArray(value.literalValuePaths)
    || (value.literalAttributeRules !== undefined && (!Array.isArray(value.literalAttributeRules)
      || value.literalAttributeRules.some(rule => !rule || typeof rule !== 'object' || Array.isArray(rule)
        || !Array.isArray(rule.tags) || !rule.tags.every((tag: unknown) => typeof tag === 'string')
        || !Array.isArray(rule.attributes) || !rule.attributes.every((key: unknown) => typeof key === 'string'))))) throw Error('HISTORY_INVALID_XNL_PROFILE');
  return { ...(value as XnlHistoryOptions), verifyValueBefore: true };
}

export function replayXnlDelta(value: XnlNode, delta: HistoryValue, profile: ContentStream['profile']): XnlNode {
  if (!Array.isArray(delta)) throw Error('HISTORY_INVALID_XNL_DELTA');
  const result = dryRunMutations(value, structuredClone(delta) as unknown as XnlMutation[], optionsFromProfile(profile));
  if (result.status !== 'applied') throw Error(`HISTORY_XNL_REJECTED: ${result.diagnostics.map(d => d.code).join(',')}`);
  return result.value;
}

export function replayXnlHistory(snapshot: Awaited<ReturnType<ContentJournal['read']>>, checkpoint?: { sequence: number; value: XnlNode }): XnlNode {
  return replayContentJournal(snapshot, {
    profileId: XNL_CONTENT_PROFILE,
    decode: value => replayXnlDelta(value as XnlNode, [], snapshot.stream.profile),
    apply: replayXnlDelta,
    ...(checkpoint ? { checkpoint: { sequence: checkpoint.sequence, value: replayXnlDelta(checkpoint.value, [], snapshot.stream.profile) } } : {}),
  });
}

export interface XnlHistoryRevertInput {
  readonly snapshot: Awaited<ReturnType<ContentJournal['read']>>;
  readonly first: number;
  readonly last: number;
  readonly current: XnlNode;
  /** The same owner's immutable accepted snapshot, retained from its original
   * transition (no added per-edit clone). Untrusted callers omit this and use
   * verified full replay. This is not a remote authentication credential. */
  readonly acceptedHead?: { readonly head: number; readonly value: XnlNode };
  /** Select result representation only; all original history and strict checks
   * still run. Default retains the mutable isolated result contract. */
  readonly immutableResult?: boolean;
}

/** Prepare an unapplied inverse intent. A plan is not a validated candidate:
 * the original owner must still strict-apply it against its current document
 * and perform domain admission before recording any change. */
export function prepareXnlHistoryRevert(input: XnlHistoryRevertInput):
  | { readonly status: 'plan'; readonly mutations: readonly XnlMutation[];
      readonly options: XnlMutationBatchOptions; readonly encodedUpdates: boolean }
  | { readonly status: 'conflict'; readonly reason: string } {
  const { snapshot, first, last, current } = input;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || first > last || last > snapshot.head)
    throw Error('HISTORY_INVALID_INTERVAL');
  if (input.acceptedHead && input.acceptedHead.head !== snapshot.head) return { status: 'conflict', reason: 'content-head' };
  if (input.acceptedHead) validateContentJournalChanges({ streamId: snapshot.stream.streamId,
    profileId: snapshot.stream.profile.id, head: snapshot.head, entries: snapshot.entries });
  const restored = input.acceptedHead?.value ?? replayXnlHistory(snapshot);
  // A caller cannot silently rebase a stale editor buffer onto journal head.
  if (restored !== current && historyCanonical(encodeXnlHistoryValue(restored)) !== historyCanonical(encodeXnlHistoryValue(current))) return { status: 'conflict', reason: 'content-base' };
  const prefix = (head: number) => replayXnlHistory({ ...snapshot, head, entries: snapshot.entries.slice(0, head) });
  const options = optionsFromProfile(snapshot.stream.profile);
  // Detect an intervening write even if its value later returned (ABA). With
  // positional structural changes, conservative conflict is preferable to loss.
  const touched = snapshot.entries.slice(first - 1, last).flatMap(e => e.change.delta as unknown as XnlMutation[]);
  // Sequential updates already contain exact before/after values. Invert their
  // order, then still require provenance, strict current preconditions and the
  // caller's original domain admission. Structural operations retain the fully
  // replayed fallback until their positional inverse algebra is available.
  const updates = touched.every(m => (m.type === 'OBJECT_UPDATE' || m.type === 'TREE_UPDATE') && Object.prototype.hasOwnProperty.call(m, 'valueBefore') && Object.prototype.hasOwnProperty.call(m, 'valueAfter'));
  const mutations = updates ? [...touched].reverse().map(m => ({ ...m, valueBefore: m.valueAfter, valueAfter: m.valueBefore }))
    : diffNodes(prefix(last), prefix(first - 1), [], options);
  // Explicit undo/redo pairs cancel their contribution. Ordinary A→B→A edits
  // do not: their provenance remains an intervening write (ABA).
  const contributions: Map<number, number>[] = [];
  for (let index = 0; index < snapshot.entries.length; index++) {
    const entry = snapshot.entries[index];
    const cause = entry.change.cause;
    const vector = new Map<number, number>();
    if ((cause?.kind === 'undo' || cause?.kind === 'redo') && cause.change) {
      const target = snapshot.entries[cause.change - 1];
      if (!target || cause.change > index || target.change.actorId !== entry.change.actorId)
        throw Error('HISTORY_INVALID_REVERT_CAUSE');
      let start = cause.change - 1;
      while (start > 0 && snapshot.entries[start - 1].change.groupId === target.change.groupId
        && snapshot.entries[start - 1].change.actorId === target.change.actorId
        && snapshot.entries[start - 1].change.sessionEpoch === target.change.sessionEpoch
        && (snapshot.entries[start - 1].change.cause?.kind ?? 'edit') === (target.change.cause?.kind ?? 'edit')) start--;
      for (let i = start; i < cause.change; i++) for (const [origin, weight] of contributions[i])
        vector.set(origin, (vector.get(origin) ?? 0) - weight);
    } else vector.set(index, 1);
    contributions.push(vector);
  }
  const laterContributions = new Map<number, number>();
  for (const vector of contributions.slice(last)) for (const [origin, weight] of vector)
    laterContributions.set(origin, (laterContributions.get(origin) ?? 0) + weight);
  const later = [...laterContributions].filter(([, weight]) => weight !== 0)
    .flatMap(([index]) => snapshot.entries[index].change.delta as unknown as XnlMutation[]);
  const structural = (m: XnlMutation) => m.type !== 'OBJECT_UPDATE' && m.type !== 'TREE_UPDATE';
  const path = (m: XnlMutation) => (typeof m.path === 'string' ? parsePath(m.path) : m.path).map(item => historyCanonical(encodeXnlHistoryValue(item)));
  const overlaps = (a: XnlMutation, b: XnlMutation) => {
    const left = path(a), right = path(b);
    return left.slice(0, Math.min(left.length, right.length)).every((part, index) => part === right[index]);
  };
  if (later.some(m => touched.some(t => structural(m) || structural(t) || overlaps(m, t))))
    return { status: 'conflict', reason: 'intervening-change' };
  return { status: 'plan', mutations, options, encodedUpdates: updates };
}

/** Builds a strictly checked proposal, not an owner write. The caller must
 * still submit it to its current domain owner against the live revision. */
export function proposeXnlHistoryRevert(input: XnlHistoryRevertInput):
  | { readonly status: 'candidate'; readonly value: XnlNode; readonly mutations: readonly XnlMutation[] }
  | { readonly status: 'conflict'; readonly reason: string } {
  const plan = prepareXnlHistoryRevert(input);
  if (plan.status === 'conflict') return plan;
  const { mutations, options } = plan;
  // Update inverses come from encoded journal data. Structural diff results
  // may carry hidden literal context and must retain the original batch.
  const result = input.immutableResult === true
    ? dryRunImmutableMutations(input.current, plan.encodedUpdates ? captureImmutableData(mutations) : mutations,
      captureImmutableData({ metadataIdMode: options.metadataIdMode, identityPolicy: options.identityPolicy,
        verifyValueBefore: options.verifyValueBefore, literalValuePaths: options.literalValuePaths, literalAttributeRules: options.literalAttributeRules }))
    : dryRunMutations(input.current, mutations, options);
  return result.status === 'applied' ? { status: 'candidate', value: result.value, mutations }
    : { status: 'conflict', reason: result.diagnostics.map(d => d.code).join(',') };
}
