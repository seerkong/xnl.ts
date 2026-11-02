import { expect, test } from 'vitest';
import { captureImmutableData } from 'immutable-data-core';
import type { DataElementNode } from 'xnl-core';
import { areXnlSnapshotsStructurallyEqual } from '../src/revisioned-persistence';

function compare(left: unknown, right: unknown): boolean {
  return areXnlSnapshotsStructurallyEqual(left as DataElementNode, right as DataElementNode);
}

test('owned dense comparison matches the cold complete comparison', () => {
  const cases: Array<[unknown, unknown]> = [
    [[], []], [[1, 2], [1, 2]], [[1, 2], [2, 1]], [[1], [1, 2]],
    [[undefined], [undefined]], [[NaN], [NaN]], [[-0], [0]],
    [[{ body: [1, { id: 'same' }] }], [{ body: [1, { id: 'same' }] }]],
    [[{ body: [1, { id: 'same' }] }], [{ body: [1, { id: 'other' }] }]],
  ];
  const cycleA: any[] = [], cycleB: any[] = []; cycleA.push(cycleA); cycleB.push(cycleB);
  cases.push([cycleA, cycleB]);
  const shared = { value: 'same' };
  cases.push([[shared, shared], [{ value: 'same' }, { value: 'same' }]]);
  for (const [left, right] of cases) {
    const expected = compare(left, right);
    const capturedLeft = captureImmutableData(left), capturedRight = captureImmutableData(right);
    expect(compare(capturedLeft, capturedRight)).toBe(expected);
    expect(compare(capturedRight, capturedLeft)).toBe(expected);
    expect(compare(capturedLeft, right)).toBe(expected);
    expect(compare(left, capturedRight)).toBe(expected);
  }
});

test('holes and named fields retain complete own-presence comparisons', () => {
  const sparse = new Array(1), dense = [undefined];
  const named = Object.assign([undefined], { extra: true });
  for (const [left, right] of [[sparse, dense], [dense, named], [named, sparse]]) {
    expect(compare(captureImmutableData(left), captureImmutableData(right))).toBe(false);
    expect(compare(captureImmutableData(left), right)).toBe(false);
    expect(compare(left, captureImmutableData(right))).toBe(false);
  }
  expect(compare(captureImmutableData(sparse), captureImmutableData(new Array(1)))).toBe(true);
  expect(compare(captureImmutableData(named), captureImmutableData(Object.assign([undefined], { extra: true })))).toBe(true);
});
