import { captureImmutableData, hasXnlLiteralContext, applyMutations, parseXnl, type DataElementNode } from 'xnl-core';
import { expect, it } from 'vitest';
import { MemoryRevisionedVfsAuthority } from '../src/revisioned-persistence';
const node = () => parseXnl('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>').nodes[0] as DataElementNode;
it('explicit data sharing keeps synchronous submission isolation, CAS, failures and old reads', async () => {
  const initial = captureImmutableData(node()), authority = new MemoryRevisionedVfsAuthority(initial, { authorityId: 'data', snapshotMode: 'immutable-data' });
  const before = authority.read(); expect(before.snapshot).toBe(initial);
  const mutable = structuredClone(initial); (mutable.body![0] as DataElementNode).attributes!.text = 'new';
  const pending = authority.compareAndSwap({ expectedRevision: before.revision, snapshot: mutable });
  (mutable.body![0] as DataElementNode).attributes!.text = 'late';
  expect((await pending).status).toBe('applied');
  const current = authority.read(); expect((current.snapshot.body![0] as DataElementNode).attributes!.text).toBe('new');
  expect((before.snapshot.body![0] as DataElementNode).attributes!.text).toBe('a');
  expect(Object.isFrozen(current.snapshot)).toBe(true);
  expect((await authority.compareAndSwap({ expectedRevision: before.revision, snapshot: initial })).status).toBe('conflict');
  expect((await authority.compareAndSwap({ expectedRevision: current.revision, snapshot: current.snapshot })).status).toBe('unchanged');
  authority.failNextFlush({ code: 'TEST', message: 'failure' });
  expect((await authority.compareAndSwap({ expectedRevision: current.revision, snapshot: initial })).status).toBe('failed');
  expect(authority.read().revision).toEqual(current.revision); expect(authority.read().snapshot).toBe(current.snapshot);
});
it('read-bind-read strips hidden syntax context even on shared frozen data', () => {
  const authority = new MemoryRevisionedVfsAuthority(captureImmutableData(node()), { authorityId: 'context', snapshotMode: 'immutable-data' });
  const first = authority.read(); expect(hasXnlLiteralContext(first.snapshot)).toBe(false);
  applyMutations(first.snapshot, [], { literalValuePaths: ['#doc:body::0'] });
  expect(hasXnlLiteralContext(first.snapshot)).toBe(true);
  const second = authority.read(); expect(hasXnlLiteralContext(second.snapshot)).toBe(false);
  expect(second.snapshot).toEqual(first.snapshot); expect(second.snapshot).not.toBe(first.snapshot); expect(second.revision).toEqual(first.revision);
});
it('native builtins remain isolated on each read in either storage mode', () => {
  for (const snapshotMode of ['isolated', 'immutable-data'] as const) {
    const initial = node(); initial.attributes = { date: new Date(0), map: new Map([['v', 1]]) } as never;
    const authority = new MemoryRevisionedVfsAuthority(initial, { authorityId: snapshotMode, snapshotMode });
    const read = authority.read().snapshot.attributes as any; read.date.setTime(9); read.map.set('v', 2);
    const again = authority.read().snapshot.attributes as any;
    expect(again.date.getTime()).toBe(0); expect(again.map.get('v')).toBe(1);
  }
});
