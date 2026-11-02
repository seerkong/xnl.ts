import { expect, test } from 'vitest';
import { captureImmutableData, isCapturedDenseArray, isCapturedImmutableData, mapCapturedDataArray, replaceCapturedDataProperty } from 'immutable-data-core';

test('mapping constructs an owned dense result and shares only owned values', () => {
  const child = captureImmutableData({ text: 'unchanged' });
  const source = captureImmutableData([child, child]);
  const calls: number[] = [];
  const result = mapCapturedDataArray(source, (value, index) => { calls.push(index); return value; })!;
  expect(calls).toEqual([0, 1]);
  expect(result).not.toBe(source);
  expect(result[0]).toBe(child);
  expect(result[1]).toBe(child);
  expect(isCapturedImmutableData(result)).toBe(true);
  expect(isCapturedDenseArray(result)).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
  expect(mapCapturedDataArray(source, (_, index) => index === 0 ? undefined : NaN)).toEqual([undefined, NaN]);
  const cyclic: any[] = []; cyclic.push(cyclic);
  const ownedCycle = captureImmutableData(cyclic);
  expect(mapCapturedDataArray(ownedCycle, value => value)![0]).toBe(ownedCycle);
});

test('unowned, sparse and named sources never call the mapper', () => {
  let calls = 0;
  const sparse = new Array(2); sparse[1] = 'value';
  const named = Object.assign(['value'], { extra: true });
  for (const source of [[], Object.freeze(['value']), captureImmutableData(sparse), captureImmutableData(named)]) {
    expect(mapCapturedDataArray(source, () => { calls++; return 1; })).toBeUndefined();
  }
  expect(calls).toBe(0);
  expect(() => mapCapturedDataArray(captureImmutableData([]), null as never)).toThrow(TypeError);
});

test('unowned results and mapper failures cannot publish or freeze external objects', () => {
  const source = captureImmutableData([1, 2]);
  const external = { text: 'mutable' };
  for (const value of [external, Object.freeze({}), new Map(), Promise.resolve(1), Symbol(), () => 1]) {
    expect(() => mapCapturedDataArray(source, () => value)).toThrow(TypeError);
    if (value !== null && typeof value === 'object') expect(isCapturedImmutableData(value)).toBe(false);
  }
  expect(Object.isFrozen(external)).toBe(false);
  let calls = 0;
  expect(() => mapCapturedDataArray(source, () => { calls++; throw Error('mapper failed'); })).toThrow('mapper failed');
  expect(calls).toBe(1);
  expect(source).toEqual([1, 2]);
});

test('callback replacement of issuance capabilities cannot forge an isolation proof', () => {
  const source = captureImmutableData([1]), external = { mutable: true };
  const original = { freeze: Object.freeze, setPrototypeOf: Object.setPrototypeOf,
    has: WeakSet.prototype.has, add: WeakSet.prototype.add };
  let result: unknown;
  try {
    result = mapCapturedDataArray(source, () => {
      Object.freeze = ((value: any) => value) as never;
      Object.setPrototypeOf = ((value: any) => value) as never;
      WeakSet.prototype.has = (() => true) as never;
      WeakSet.prototype.add = function () { return this; };
      return captureImmutableData({ nested: { value: 3 } });
    });
    expect(() => mapCapturedDataArray(source, () => external)).toThrow(TypeError);
  } finally {
    Object.freeze = original.freeze; Object.setPrototypeOf = original.setPrototypeOf;
    WeakSet.prototype.has = original.has; WeakSet.prototype.add = original.add;
  }
  expect(result).toEqual([{ nested: { value: 3 } }]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen((result as any)[0])).toBe(true);
  expect(Object.isFrozen((result as any)[0].nested)).toBe(true);
  expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
  expect(isCapturedImmutableData(result)).toBe(true);
  expect(isCapturedImmutableData(external)).toBe(false);
});

test('mapping uses no inherited numeric setter and supports reentrant construction', () => {
  const source = captureImmutableData([1, 2]);
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  let writes = 0, result: unknown;
  try {
    Object.defineProperty(Array.prototype, '0', { configurable: true, set() { writes++; } });
    result = mapCapturedDataArray(source, value => mapCapturedDataArray(source, () => value)!);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, '0', previous); else delete (Array.prototype as any)[0];
  }
  expect(writes).toBe(0);
  expect(result).toEqual([[1, 1], [2, 2]]);
  expect(isCapturedDenseArray(result)).toBe(true);
});

test('callback descriptor replacement cannot inject a mutable alias into a captured closure', () => {
  const source = captureImmutableData([1]);
  const external = { value: 1 };
  const original = Object.defineProperty;
  let result: any;
  try {
    result = mapCapturedDataArray(source, () => {
      Object.defineProperty = ((target: object, key: PropertyKey, descriptor: PropertyDescriptor) =>
        original(target, key, key === 'nested' ? { ...descriptor, value: external } : descriptor)) as typeof original;
      return captureImmutableData({ nested: { value: 1 } });
    });
  } finally { Object.defineProperty = original; }
  external.value = 2;
  expect(result[0].nested.value).toBe(1);
  expect(isCapturedImmutableData(result[0].nested)).toBe(true);
  expect(Object.isFrozen(result[0].nested)).toBe(true);
});

test('reentrant capture and replace use their original descriptor, shape and seen-map capabilities', () => {
  const source = captureImmutableData([1]);
  const capabilities: Array<[any, string]> = [
    [Object, 'getPrototypeOf'], [Object, 'getOwnPropertyDescriptors'], [Object, 'getOwnPropertyDescriptor'],
    [Object, 'defineProperty'], [Object, 'create'], [Object, 'assign'], [Object, 'keys'],
    [Reflect, 'ownKeys'], [Array, 'isArray'], [Map.prototype, 'has'], [Map.prototype, 'get'], [Map.prototype, 'set'],
    [Object.prototype, 'hasOwnProperty'], [Number, 'isSafeInteger'],
  ];
  const originals = capabilities.map(([target, key]) => target[key]);
  let result: any;
  try {
    result = mapCapturedDataArray(source, () => {
      for (const [target, key] of capabilities) target[key] = () => { throw Error('replaced capability used'); };
      const record = captureImmutableData({ nested: { value: 1 } });
      const array = captureImmutableData([record]);
      return replaceCapturedDataProperty(array, '0', replaceCapturedDataProperty(record, 'nested', { value: 2 }))!;
    });
  } finally {
    capabilities.forEach(([target, key], index) => { target[key] = originals[index]; });
  }
  expect(result).toEqual([[{ nested: { value: 2 } }]]);
  expect(isCapturedDenseArray(result[0])).toBe(true);
  expect(Object.isFrozen(result[0][0].nested)).toBe(true);
});
