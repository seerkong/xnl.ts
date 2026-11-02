import { expect, test } from 'vitest';
import { captureImmutableData, dryRunImmutableMutations, dryRunMutations, immutableScalarUpdatePath, parseXnl,
  type XnlMutation, type XnlNode, type XnlMutationBatchOptions } from '../src';

const options = captureImmutableData({ metadataIdMode: 'identity' as const, identityPolicy: 'allow-missing' as const,
  verifyValueBefore: true, literalValuePaths: undefined, literalAttributeRules: [] });
const edits = (path: string) => captureImmutableData([{ type: 'OBJECT_UPDATE', path, valueBefore: 'old', valueAfter: 'next' }] as XnlMutation[]);
function compare(root: unknown, path: string, config: XnlMutationBatchOptions = options) {
  const base = captureImmutableData(root) as XnlNode, batch = edits(path);
  const expected = dryRunMutations(base, batch, config);
  for (let index = 0; index < 2; index++) {
    const { representation, ...actual } = dryRunImmutableMutations(base, batch, config);
    expect(actual).toEqual(expected);
  }
  return { base, batch, result: dryRunImmutableMutations(base, batch, config) };
}

test('primitive leaf targets are still located and target aliases keep full semantics', () => {
  const direct = compare({ text: 'old', enabled: true, count: 1 }, ':text');
  expect(direct.result.status).toBe('applied');
  expect(immutableScalarUpdatePath(direct.base, direct.result.value)).toEqual(['text']);
  const target = { text: 'old', enabled: true };
  const alias = compare({ target, other: target }, ':target:text');
  expect(alias.result.status).toBe('applied');
  expect((alias.result.value as any).other.text).toBe('next');
  expect(immutableScalarUpdatePath(alias.base, alias.result.value)).toBeUndefined();
});

test('primitive namespace sharing does not hide identified object arrays or policy failures', () => {
  const namespace = ['shared'];
  const word = (name: string) => ({ kind: 'Word', namespace, name });
  const element = (name: string) => ({ kind: 'DataElement', tag: 'P', id: word(name), metadata: {} });
  const valid = compare({ target: { text: 'old' }, nodes: [element('a'), element('b')] }, ':target:text');
  expect(valid.result.status).toBe('applied');
  const duplicate = compare({ target: { text: 'old' }, nodes: [element('same'), element('same')] }, ':target:text');
  expect(duplicate.result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
  const required = captureImmutableData({ ...options, identityPolicy: 'require-elements' as const });
  const missing = compare({ target: { text: 'old' }, nodes: parseXnl('<P>').nodes }, ':target:text', required);
  expect(missing.result.diagnostics[0]?.code).toBe('MISSING_IDENTITY');
  const named = Object.assign(['primitive'], { extra: element('same') });
  const extra = compare({ target: { text: 'old', named }, duplicate: element('same') }, ':target:text');
  expect(extra.result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
});

test('deep promotion exits leaf records and keeps independent DAG branches eligible', () => {
  const leaf = { value: 'shared', enabled: true };
  const wrap = (value: unknown) => { for (let index = 0; index < 40; index++) value = { child: value }; return value; };
  const dag = compare({ first: wrap(leaf), second: wrap(leaf), target: { text: 'old' } }, ':target:text');
  expect(dag.result.status).toBe('applied');
  expect(immutableScalarUpdatePath(dag.base, dag.result.value)).toEqual(['target', 'text']);
  const cycle: any = { value: 'cycle' }; cycle.back = cycle;
  const cyclic = compare({ deep: wrap(cycle), target: { text: 'old' } }, ':target:text');
  expect(immutableScalarUpdatePath(cyclic.base, cyclic.result.value)).toBeUndefined();
});

test('prototype guard changes cannot turn shape facts into identity admission', () => {
  const { base, batch } = compare({ target: { text: 'old', namespace: ['a'] } }, ':target:text');
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'kind');
  try {
    Object.defineProperty(Object.prototype, 'kind', { configurable: true, value: 'DataElement' });
    const { representation, ...actual } = dryRunImmutableMutations(base, batch, options);
    expect(actual).toEqual(dryRunMutations(base, batch, options));
  } finally {
    if (prior) Object.defineProperty(Object.prototype, 'kind', prior); else delete (Object.prototype as any).kind;
  }
});

test('legacy Word callbacks cannot hide temporary array identities from the complete base scan', () => {
  const word = (namespace: string[], name: unknown) => ({ kind: 'Word', namespace, name });
  const element = (namespace: string[], name: unknown) => ({ kind: 'DataElement', tag: 'P', id: word(namespace, name), metadata: {} });
  const base = captureImmutableData({ first: element(['poison'], 1), extra: { a: [], b: [] },
    target: { text: 'old' }, last: element(['restore'], 2) }) as XnlNode;
  const originals = new Map<string, PropertyDescriptor | undefined>(['kind', 'tag', 'metadata'].map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)]));
  const filter = Array.prototype.filter;
  const restore = () => { for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(Array.prototype, key, descriptor); else delete (Array.prototype as any)[key];
  } };
  const install = () => {
    Array.prototype.filter = function (this: any[], ...args: any[]) {
      if (this[0] === 'poison') {
        Object.defineProperties(Array.prototype, {
          kind: { configurable: true, value: 'DataElement' }, tag: { configurable: true, value: 'P' },
          metadata: { configurable: true, value: { id: word([], 'temporary-duplicate') } },
        });
      } else if (this[0] === 'restore') restore();
      return filter.apply(this, args as any);
    } as any;
  };
  try {
    install();
    const expected = dryRunMutations(base, edits(':target:text'), options);
    expect(expected.diagnostics.some(item => item.code === 'DUPLICATE_IDENTITY')).toBe(true);
    for (let index = 0; index < 2; index++) {
      restore();
      const actual = dryRunImmutableMutations(base, edits(':target:text'), options);
      expect(actual.status).toBe('rejected');
      expect(actual.diagnostics).toEqual(expected.diagnostics);
    }
  } finally { Array.prototype.filter = filter; restore(); }
});

test('object-child derivations preserve numeric key order and an own __proto__ edge', () => {
  const root = Object.create(null);
  root['10'] = parseXnl('<Ten>').nodes[0];
  root['2'] = parseXnl('<Two>').nodes[0];
  Object.defineProperty(root, '__proto__', { enumerable: true, value: parseXnl('<OwnProto>').nodes[0] });
  root.target = { text: 'old' };
  const required = captureImmutableData({ ...options, identityPolicy: 'require-elements' as const });
  const { result } = compare(root, ':target:text', required);
  expect(result.diagnostics.map(item => item.message)).toEqual([
    "DataElement 'Two' is missing an effective identity",
    "DataElement 'Ten' is missing an effective identity",
    "DataElement 'OwnProto' is missing an effective identity",
  ]);
});
