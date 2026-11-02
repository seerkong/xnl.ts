import { expect, test } from 'vitest';
import { applyMutations, captureImmutableData, dryRunImmutableMutations, dryRunMutations, isWord,
  parseXnl, resolvePath, stringifyLineBlock, wordToString, type DataElementNode, type XnlWord } from '../src';

const word = (namespace: string[], name: string): XnlWord => ({ kind: 'Word', namespace, name });
const options = captureImmutableData({ metadataIdMode: 'identity' as const, identityPolicy: 'allow-missing' as const,
  verifyValueBefore: true, literalValuePaths: undefined, literalAttributeRules: [] });

test('canonical raw and captured Word data preserve namespace empty segments and the final empty name', () => {
  const cases: Array<[string[], string, string | undefined]> = [
    [[], '', undefined], [[], 'name', 'name'], [[''], '', undefined], [['', ''], 'name', 'name'],
    [['a'], '', 'a.'], [['a', '', 'b'], '', 'a.b.'], [['', 'a', '', 'b', ''], 'name', 'a.b.name'],
    [['中文', 'emoji🙂'], '尾', '中文.emoji🙂.尾'],
  ];
  for (const [namespace, name, expected] of cases) {
    const value = word(namespace, name);
    expect(wordToString(value)).toBe(expected);
    expect(wordToString(captureImmutableData(value))).toBe(expected);
  }
});

test('array algorithm overrides cannot erase canonical explicit or metadata Word identities', () => {
  const sources = ['<Document #ns.doc [<P #ns.dup><P #ns.dup>]>', '<Document #ns.doc [<P id=ns.dup><P id=ns.dup>]>'];
  const pairs = sources.map(source => {
    const raw = parseXnl(source).nodes[0]!;
    const captured = captureImmutableData(raw);
    expect(dryRunMutations(raw, [], options).diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
    return { raw, captured };
  });
  const original = { filter: Array.prototype.filter, join: Array.prototype.join,
    iterator: Array.prototype[Symbol.iterator], boolean: globalThis.Boolean,
    species: Object.getOwnPropertyDescriptor(Array, Symbol.species)! };
  const hooks = [
    () => { Array.prototype.filter = (() => []) as never; },
    () => { Array.prototype.join = (() => 'forged') as never; },
    () => { globalThis.Boolean = (() => false) as never; },
    () => { (Array.prototype as any)[Symbol.iterator] = function* () {
      // Target namespace-shaped arrays, without changing unrelated protocol
      // arrays such as the literal-path configuration or mutation batch.
      if (this[0] === 'ns' || this[0] === 'a') { yield 'forged'; return; }
      yield* original.iterator.call(this);
    }; },
    () => { Object.defineProperty(Array, Symbol.species, { configurable: true, get() { throw Error('word must not use species'); } }); },
  ];
  for (const install of hooks) {
    const codes: unknown[] = [];
    let text: string | undefined;
    try {
      install();
      text = wordToString(word(['a', '', 'b'], ''));
      for (let index = 0; index < pairs.length; index++) {
        const pair = pairs[index]!;
        const ordinary = dryRunMutations(pair.raw, [], options);
        const immutable = dryRunImmutableMutations(pair.captured, captureImmutableData([]), options);
        Object.defineProperty(codes, codes.length, { value: ordinary.diagnostics[0]?.code, enumerable: true, configurable: true });
        Object.defineProperty(codes, codes.length, { value: immutable.diagnostics[0]?.code, enumerable: true, configurable: true });
      }
    } finally {
      Array.prototype.filter = original.filter; Array.prototype.join = original.join;
      Array.prototype[Symbol.iterator] = original.iterator; globalThis.Boolean = original.boolean;
      Object.defineProperty(Array, Symbol.species, original.species);
    }
    expect(text).toBe('a.b.');
    expect(codes).toEqual(['DUPLICATE_IDENTITY', 'DUPLICATE_IDENTITY', 'DUPLICATE_IDENTITY', 'DUPLICATE_IDENTITY']);
  }
});

test('explicit noncanonical extensions retain the legacy formatting behavior', () => {
  const custom = ['ignored']; let filters = 0;
  Object.defineProperty(custom, 'filter', { value: () => { filters++; return ['custom']; } });
  expect(wordToString(word(custom, 'name'))).toBe('custom.name'); expect(filters).toBe(1);
  const sparse = new Array(3); sparse[1] = 'middle';
  expect(wordToString(word(sparse, 'name'))).toBe('middle.name');
  const named = Object.assign(['a'], { extra: true });
  expect(wordToString(word(named, 'name'))).toBe('a.name');
  expect(wordToString(word(['a', 0, false, null, undefined, 3] as never, 'name'))).toBe('a.3.name');
  expect(wordToString(word([{ toString: () => 'custom' }] as never, 'name'))).toBe('custom.name');
  let namespaceReads = 0, nameReads = 0, kindReads = 0;
  const accessors = { get kind() { kindReads++; return 'Word'; },
    get namespace() { namespaceReads++; return ['a']; }, get name() { nameReads++; return 'name'; } };
  expect(wordToString(accessors as XnlWord)).toBe('a.name');
  expect([kindReads, namespaceReads, nameReads]).toEqual([0, 1, 1]);
});

test('captured arrays cannot enter the canonical record path through inherited Word fields', () => {
  const value = captureImmutableData([]), namespace = captureImmutableData(['a']);
  const previous = ['kind', 'name', 'namespace'].map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)] as const);
  let kindReads = 0, result: string | undefined;
  try {
    Object.defineProperty(Array.prototype, 'kind', { configurable: true, get() { kindReads++; return 'Word'; } });
    Object.defineProperty(Array.prototype, 'name', { configurable: true, value: 'n' });
    Object.defineProperty(Array.prototype, 'namespace', { configurable: true, value: namespace });
    result = wordToString(value as never);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(Array.prototype, key, descriptor); else delete (Array.prototype as any)[key];
    }
  }
  expect(kindReads).toBe(0); expect(result).toBe('a.n');
});

test('canonical identity formatting stays consistent with path lookup and XNL output without reclassifying literals', () => {
  const raw = parseXnl('<Document #ns.doc [<P #ns.child {text="old"}>]>').nodes[0] as DataElementNode;
  const captured = captureImmutableData(raw);
  for (const source of [raw, captured]) {
    expect(wordToString(source.id)).toBe('ns.doc');
    expect((resolvePath(source, '#ns.child') as DataElementNode).tag).toBe('P');
    expect(stringifyLineBlock(source)).toContain('#ns.child');
    const mutations = [{ type: 'OBJECT_UPDATE' as const, path: "#ns.child:attributes::'text'", valueBefore: 'old', valueAfter: 'next' }];
    expect(dryRunMutations(source, mutations, options).status).toBe('applied');
    expect(dryRunImmutableMutations(source, captureImmutableData(mutations), options).status).toBe('applied');
  }
  const literal = captureImmutableData(parseXnl('<Document #doc {config={kind="Word" namespace=["business"] name="value"}}>').nodes[0] as DataElementNode);
  applyMutations(literal, [], { literalValuePaths: ['#doc:attributes::\'config\''] });
  expect(isWord(literal.attributes!.config)).toBe(false);
  expect(wordToString(literal.attributes!.config as XnlWord)).toBe('business.value');
});
