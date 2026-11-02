import { describe, it, expect } from 'vitest';
import { captureImmutableData, dryRunMutations, isCapturedImmutableData, parseXnl, diffNodes, stringifyLiteral, type XnlNode, type DataElementNode } from 'xnl-core';
import { createMemoryContentJournal, historyCanonical, type HistoryValue, type ContentJournal } from '../src/content-history';
import { xnlHistoryProfile, replayXnlHistory, prepareXnlHistoryRevert, proposeXnlHistoryRevert, replayXnlDelta, encodeXnlHistoryValue } from '../src/xnl-content-history';

const parse = (source: string) => structuredClone(parseXnl(source).nodes[0]);
it('history data checks never treat inherited descriptor values as own data', () => {
  let reads = 0;
  const input = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 'actual'; } });
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  let canonicalError, encodedError;
  try {
    Object.defineProperty(Object.prototype, 'value', Object.assign(Object.create(null), { value: 'forged', configurable: true }));
    try { historyCanonical(input); } catch (error) { canonicalError = error; }
    try { encodeXnlHistoryValue(input); } catch (error) { encodedError = error; }
  } finally {
    delete (Object.prototype as any).value;
    if (previous) Object.defineProperty(Object.prototype, 'value', previous);
  }
  expect(String(canonicalError)).toContain('HISTORY_NON_SERIALIZABLE');
  expect(String(encodedError)).toContain('HISTORY_NON_SERIALIZABLE'); expect(reads).toBe(0);
});
const profile = xnlHistoryProfile({ literalValuePaths: ['#doc:attributes'], identityPolicy: 'require-elements' });
async function append(journal: ContentJournal, before: XnlNode, after: XnlNode, base: number, actorId = 'me') {
  const delta = diffNodes(before, after, [], profile.config as any);
  return journal.append({ streamId: 'doc', profileId: profile.id, actorId, sessionEpoch: 'one', requestId: `r${base}`,
    groupId: `r${base}`, base, delta: encodeXnlHistoryValue(delta) });
}
async function open(initial: XnlNode) {
  const journal = createMemoryContentJournal();
  await journal.open({ streamId: 'doc', subject: { scope: 'local', id: 'document', root: 'content' }, profile, initial: encodeXnlHistoryValue(initial) });
  return journal;
}
describe('strict XNL history profile', () => {
  it('prepares an unapplied inverse without granting strict success or changing the journal', async () => {
    const before = parse('<Document #doc { a = 0 }>'), after = parse('<Document #doc { a = 1 }>');
    const journal = await open(before); await append(journal, before, after, 0);
    const snapshot = await journal.read('doc');
    const input = { snapshot, first: 1, last: 1, current: after, acceptedHead: { head: 1, value: after } };
    const plan = prepareXnlHistoryRevert(input);
    expect(plan.status).toBe('plan');
    if (plan.status !== 'plan') throw Error('fixture');
    expect(dryRunMutations(after, plan.mutations, plan.options)).toMatchObject({ status: 'applied', value: before });
    expect(await journal.read('doc')).toEqual(snapshot);
    expect(input.current).toEqual(after);
    const poisoned = structuredClone(snapshot);
    (poisoned.entries[0].change.delta as any[])[0].valueAfter = 99;
    const invalid = { ...input, snapshot: poisoned };
    const prepared = prepareXnlHistoryRevert(invalid);
    expect(prepared.status).toBe('plan');
    if (prepared.status !== 'plan') throw Error('fixture');
    expect(dryRunMutations(after, prepared.mutations, prepared.options).status).toBe('rejected');
    expect(proposeXnlHistoryRevert(invalid).status).toBe('conflict');
    expect(() => prepareXnlHistoryRevert({ ...input, snapshot: { ...snapshot, entries: [] } })).toThrow('HISTORY_INCOMPLETE_INTERVAL');
    expect(prepareXnlHistoryRevert({ ...input, current: before })).toEqual({ status: 'conflict', reason: 'content-base' });
    expect(() => prepareXnlHistoryRevert({ ...input, snapshot: { ...snapshot, stream: { ...snapshot.stream,
      profile: { ...snapshot.stream.profile, id: 'foreign' } } } })).toThrow();
  });
  it('immutable revert selects sharing while preserving original history validation and default output', async () => {
    const before = captureImmutableData(parse('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>'));
    const after = captureImmutableData(parse('<Document #doc [<P #a {text="changed"}><P #b {text="b"}>]>'));
    const localProfile = xnlHistoryProfile();
    const journal = createMemoryContentJournal();
    await journal.open({ streamId: 'doc', subject: { scope: 'local', id: 'doc', root: 'content' }, profile: localProfile, initial: encodeXnlHistoryValue(before) });
    await journal.append({ streamId: 'doc', profileId: localProfile.id, actorId: 'me', sessionEpoch: 'one', requestId: 'r0', groupId: 'r0', base: 0,
      delta: encodeXnlHistoryValue(diffNodes(before, after)) });
    const snapshot = await journal.read('doc');
    const input = { snapshot, first: 1, last: 1, current: after, acceptedHead: { head: 1, value: after } };
    const shared = proposeXnlHistoryRevert({ ...input, immutableResult: true }), ordinary = proposeXnlHistoryRevert(input);
    expect(shared).toEqual(ordinary); expect(shared.status).toBe('candidate');
    if (shared.status !== 'candidate' || ordinary.status !== 'candidate') throw Error('fixture');
    expect(isCapturedImmutableData(shared.value)).toBe(true);
    expect((shared.value as DataElementNode).body![1]).toBe((after as DataElementNode).body![1]);
    expect(Object.isFrozen(ordinary.value)).toBe(false);
    expect(proposeXnlHistoryRevert({ ...input, current: before, immutableResult: true })).toEqual({ status: 'conflict', reason: 'content-base' });
    expect(() => proposeXnlHistoryRevert({ ...input, snapshot: { ...snapshot, entries: [] }, immutableResult: true })).toThrow('HISTORY_INCOMPLETE_INTERVAL');
    expect(() => proposeXnlHistoryRevert({ ...input, snapshot: { ...snapshot, entries: snapshot.entries.map(entry => ({ ...entry,
      receipt: { ...entry.receipt, streamId: 'other' } })) } })).toThrow('HISTORY_INCOMPLETE_INTERVAL');
    const structural = captureImmutableData(parse('<Document #doc [<P #a {text="changed"}><P #c {text="new"}>]>'));
    await journal.append({ streamId: 'doc', profileId: localProfile.id, actorId: 'me', sessionEpoch: 'one', requestId: 'r1', groupId: 'r1', base: 1,
      delta: encodeXnlHistoryValue(diffNodes(after, structural)) });
    const next = { snapshot: await journal.read('doc'), first: 2, last: 2, current: structural, acceptedHead: { head: 2, value: structural } };
    expect(proposeXnlHistoryRevert({ ...next, immutableResult: true })).toEqual(proposeXnlHistoryRevert(next));
  });
  it('transports explicit literal boundaries and preserves element identity during replay and revert', async () => {
    const literal = { kind: 'DataElement', tag: 'Thing', id: { kind: 'Word', namespace: [], name: 'business-id' }, metadata: {}, business: 1 };
    const before = parse(`<Document #doc { config = ${stringifyLiteral(literal)} }>`);
    const after = parse(`<Document #doc { config = ${stringifyLiteral({ ...literal, business: 2 })} }>`);
    const journal = await open(before); await append(journal, before, after, 0);
    const snapshot = JSON.parse(JSON.stringify(await journal.read('doc')));
    expect(replayXnlHistory(snapshot)).toEqual(after);
    expect(proposeXnlHistoryRevert({ snapshot, first: 1, last: 1, current: after })).toMatchObject({ status: 'candidate', value: before });
  });
  it('reverts my field and preserves the other actor field; rejects overlap and ABA', async () => {
    const before = parse('<Document #doc { a = 0 b = 0 }>');
    const mine = parse('<Document #doc { a = 1 b = 0 }>');
    const other = parse('<Document #doc { a = 1 b = 2 }>');
    const journal = await open(before); await append(journal, before, mine, 0); await append(journal, mine, other, 1, 'other');
    expect(proposeXnlHistoryRevert({ snapshot: await journal.read('doc'), first: 1, last: 1, current: other }))
      .toMatchObject({ status: 'candidate', value: parse('<Document #doc { a = 0 b = 2 }>') });
    const aba = parse('<Document #doc { a = 3 b = 2 }>');
    await append(journal, other, aba, 2, 'other'); await append(journal, aba, other, 3, 'other');
    expect(proposeXnlHistoryRevert({ snapshot: await journal.read('doc'), first: 1, last: 1, current: other }))
      .toEqual({ status: 'conflict', reason: 'intervening-change' });
  });
  it('refuses a stale buffer, illegal identity mutation and valueBefore mismatch', async () => {
    const before = parse('<Document #doc { a = 0 }>'); const after = parse('<Document #doc { a = 1 }>');
    const journal = await open(before); await append(journal, before, after, 0);
    expect(proposeXnlHistoryRevert({ snapshot: await journal.read('doc'), first: 1, last: 1, current: before }))
      .toEqual({ status: 'conflict', reason: 'content-base' });
    expect(() => replayXnlDelta(before, [{ type: 'OBJECT_UPDATE', path: '#doc:id', valueBefore: 'doc', valueAfter: 'other' }], profile)).toThrow('HISTORY_XNL_REJECTED');
    const delta = diffNodes(before, after, [], profile.config as any);
    expect(() => replayXnlDelta(after, delta as unknown as HistoryValue, profile)).toThrow('HISTORY_XNL_REJECTED');
  });
  it('a verified materialized checkpoint replays only its durable tail; accepted-head inverse still rejects stale content', async () => {
    const before = parse('<Document #doc { a = 0 }>'), saved = parse('<Document #doc { a = 1 }>'), edited = parse('<Document #doc { a = 2 }>');
    const journal = await open(before); await append(journal, before, saved, 0); await append(journal, saved, edited, 1);
    const snapshot = await journal.read('doc');
    expect(replayXnlHistory(snapshot, { sequence: 1, value: saved })).toEqual(edited);
    expect(proposeXnlHistoryRevert({ snapshot, first: 2, last: 2, current: edited, acceptedHead: { head: 2, value: edited } })).toMatchObject({ status: 'candidate', value: saved });
    expect(proposeXnlHistoryRevert({ snapshot, first: 2, last: 2, current: saved, acceptedHead: { head: 2, value: edited } })).toEqual({ status: 'conflict', reason: 'content-base' });
    expect(proposeXnlHistoryRevert({ snapshot, first: 2, last: 2, current: edited, acceptedHead: { head: 1, value: edited } })).toEqual({ status: 'conflict', reason: 'content-head' });
    expect(() => replayXnlHistory(snapshot, { sequence: 3, value: saved })).toThrow('HISTORY_INVALID_CHECKPOINT');
  });
});
