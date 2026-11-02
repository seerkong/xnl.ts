import { expect, test } from 'vitest';
import { captureImmutableData, capturedLiteralContextVersion, dryRunImmutableMutations, dryRunMutations,
  immutableScalarUpdatePath, parseXnl, type DataElementNode, type XnlMutation } from '../src';
import { markLiteralObject } from '../src/value-context';

const options = captureImmutableData({ metadataIdMode: 'identity' as const, identityPolicy: 'allow-missing' as const,
  verifyValueBefore: true, literalValuePaths: undefined, literalAttributeRules: [] });
const base = () => captureImmutableData(parseXnl('<Document #doc [<P #a {text="old"}><P #b {text="other"}>]>').nodes[0] as DataElementNode);
const batch = (before = 'old', after = 'next') => captureImmutableData([{ type: 'OBJECT_UPDATE',
  path: "<id='a'>:attributes::'text'", valueBefore: before, valueAfter: after }] as XnlMutation[]);

test('only the exact directed scalar path-copy publishes an immutable structural relation', () => {
  const initial = base(), result = dryRunImmutableMutations(initial, batch(), options);
  expect(result.status).toBe('applied');
  const path = immutableScalarUpdatePath(initial, result.value)!;
  expect(path).toEqual(['body', '0', 'attributes', 'text']);
  expect(Object.isFrozen(path)).toBe(true);
  expect(() => (path as string[]).push('forged')).toThrow();
  expect(immutableScalarUpdatePath(result.value, initial)).toBeUndefined();
  expect(immutableScalarUpdatePath(captureImmutableData(structuredClone(initial)), result.value)).toBeUndefined();
  expect(immutableScalarUpdatePath(initial, captureImmutableData(structuredClone(result.value)))).toBeUndefined();
  const next = dryRunImmutableMutations(result.value, batch('next', 'last'), options);
  expect(next.status).toBe('applied');
  expect(immutableScalarUpdatePath(result.value, next.value)).toEqual(path);
  expect(immutableScalarUpdatePath(initial, next.value)).toBeUndefined();
});

test('default, raw, rejected, multi-step and object replacements have no scalar relation', () => {
  const initial = base();
  for (const result of [dryRunMutations(initial, batch(), options),
    dryRunImmutableMutations(structuredClone(initial), batch(), options),
    dryRunImmutableMutations(initial, batch('wrong'), options),
    dryRunImmutableMutations(initial, captureImmutableData([...batch(), ...batch('next', 'last')]), options),
    dryRunImmutableMutations(initial, captureImmutableData([{ type: 'OBJECT_UPDATE', path: "<id='a'>:attributes::'text'",
      valueBefore: 'old', valueAfter: { text: 'object' } }] as XnlMutation[]), options)]) {
    expect(immutableScalarUpdatePath(initial, result.value)).toBeUndefined();
  }
});

test('late captured syntax context invalidates relations; new raw parser marks do not', () => {
  const initial = base(), result = dryRunImmutableMutations(initial, batch(), options);
  const version = capturedLiteralContextVersion();
  markLiteralObject({ raw: true });
  expect(capturedLiteralContextVersion()).toBe(version);
  expect(immutableScalarUpdatePath(initial, result.value)).toBeDefined();
  markLiteralObject(initial);
  expect(capturedLiteralContextVersion()).not.toBe(version);
  expect(immutableScalarUpdatePath(initial, result.value)).toBeUndefined();
});

test('changed prototype semantics conservatively suppress the structural query', () => {
  const initial = base(), result = dryRunImmutableMutations(initial, batch(), options);
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'kind');
  let path: unknown;
  try {
    Object.defineProperty(Object.prototype, 'kind', { value: 'DataElement', configurable: true });
    path = immutableScalarUpdatePath(initial, result.value);
  } finally {
    if (previous) Object.defineProperty(Object.prototype, 'kind', previous); else delete (Object.prototype as any).kind;
  }
  expect(path).toBeUndefined();
  expect(immutableScalarUpdatePath(initial, result.value)).toBeDefined();
});
