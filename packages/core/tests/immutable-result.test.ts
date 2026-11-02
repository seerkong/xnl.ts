import { expect, it } from 'vitest';
import { captureImmutableData, dryRunImmutableMutations, dryRunMutations, parseXnl, type DataElementNode, type XnlMutation } from '../src';
import { hasXnlLiteralContext, isLiteralObject, markLiteralObject } from '../src/value-context';
import { replaceCapturedDataProperty, isCapturedImmutableData, isCapturedDenseArray } from 'immutable-data-core';
const config = captureImmutableData({ metadataIdMode: 'identity' as const, identityPolicy: 'allow-missing' as const,
  verifyValueBefore: true, literalValuePaths: undefined, literalAttributeRules: [{ tags: ['ComponentEmbed'], attributes: ['input'] }] });
const base = () => captureImmutableData(parseXnl('<Document #doc [<P #a {text="a"}><P #b {text="b"}>]>').nodes[0] as DataElementNode);
const batch = (path = "#a:attributes::'text'", valueBefore: any = 'a', valueAfter: any = 'changed') => captureImmutableData([{ type: 'OBJECT_UPDATE', path, valueBefore, valueAfter }] as XnlMutation[]);
const comparable = (result: ReturnType<typeof dryRunImmutableMutations>) => { const { representation, ...strict } = result; return strict; };
it('replaceable conversion and iteration methods cannot certify sparse named arrays as dense', () => {
  const edits = batch(':target:text');
  for (const poison of ['String', 'every']) {
    const array: any[] = new Array(1);
    Object.defineProperty(array, 'extra', { value: parseXnl('<P #dup>').nodes[0], enumerable: true });
    const originalString = globalThis.String, originalEvery = Array.prototype.every;
    let captured: any[] | undefined;
    try {
      if (poison === 'String') globalThis.String = (() => 'extra') as never;
      else Array.prototype.every = (() => true) as never;
      captured = captureImmutableData(array);
    } finally { globalThis.String = originalString; Array.prototype.every = originalEvery; }
    expect(isCapturedDenseArray(captured)).toBe(false);
    const root = captureImmutableData({ target: { text: 'a' }, array: captured, duplicate: parseXnl('<P #dup>').nodes[0] });
    const result = dryRunImmutableMutations(root as never, edits, config);
    expect(comparable(result)).toEqual(dryRunMutations(root as never, edits, config));
    expect(result.status).toBe('rejected'); expect(result.diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
  }
});
it('descriptor capture preserves special own names and the symbol-before-child fallback order', () => {
  const source = Object.create(null);
  Object.defineProperties(source, {
    __proto__: { value: { data: 1 }, enumerable: true },
    constructor: { value: 'business', enumerable: true },
    hidden: { value: 'omitted', enumerable: false },
  });
  // DefineProperties' descriptor dictionary needs an actual own __proto__ key.
  Object.defineProperty(source, '__proto__', { value: { data: 1 }, enumerable: true });
  const result = captureImmutableData(source);
  expect(Object.getPrototypeOf(result)).toBeNull(); expect(result.__proto__).toEqual({ data: 1 });
  expect(result.constructor).toBe('business'); expect(Object.prototype.hasOwnProperty.call(result, 'hidden')).toBe(false);
  let reads = 0;
  const input = { child: new Proxy({}, { ownKeys() { reads++; return []; } }), [Symbol('unsupported')]: 1 };
  expect(() => captureImmutableData(input)).toThrow(); expect(reads).toBe(0);
});
it('context negatives follow late marks and never publish partial raw or cyclic scans', () => {
  const child = captureImmutableData({ inner: {} }), root = captureImmutableData({ child });
  expect(hasXnlLiteralContext(root)).toBe(false);
  expect(hasXnlLiteralContext(root)).toBe(false);
  markLiteralObject(child.inner);
  expect(hasXnlLiteralContext(root)).toBe(true);
  const changed = replaceCapturedDataProperty(root, 'child', { inner: {} })!;
  expect(hasXnlLiteralContext(changed)).toBe(false);
  const shared = captureImmutableData([]), diamond = captureImmutableData({ left: { shared }, right: { shared } });
  expect(hasXnlLiteralContext(diamond)).toBe(false);
  markLiteralObject({ unrelated: true });
  expect(hasXnlLiteralContext(diamond)).toBe(false);
  markLiteralObject(shared);
  expect(hasXnlLiteralContext(diamond)).toBe(true);
  const first: any = {}, second: any = {};
  first.second = second; second.first = first; first.extra = {};
  const cycle = captureImmutableData(first);
  expect(hasXnlLiteralContext(cycle)).toBe(false);
  markLiteralObject(cycle.extra);
  expect(hasXnlLiteralContext(cycle.second)).toBe(true);
  const target = captureImmutableData({ inner: {} });
  const raw = { target, trap: new Proxy({}, { ownKeys() { markLiteralObject(target.inner); return []; } }) };
  expect(hasXnlLiteralContext(raw)).toBe(true);
  expect(hasXnlLiteralContext(target)).toBe(true);
  let reads = 0;
  expect(hasXnlLiteralContext({ get data() { reads++; return {}; } })).toBe(true);
  expect(reads).toBe(0);
});
it('inherited array setters cannot inject unrelated objects into context certificates', () => {
  const poisoned = captureImmutableData({ hidden: {} }), clean = captureImmutableData({ child: {} });
  markLiteralObject(poisoned.hidden);
  const prior = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  let result;
  try {
    Object.defineProperty(Array.prototype, '0', { configurable: true, set() {
      Object.defineProperty(this, '0', { value: poisoned, enumerable: true, configurable: true, writable: true });
    } });
    result = hasXnlLiteralContext(clean);
  } finally { if (prior) Object.defineProperty(Array.prototype, '0', prior); else delete (Array.prototype as any)[0]; }
  expect(result).toBe(false); expect(hasXnlLiteralContext(poisoned)).toBe(true);
});
it('accessor capture retains native isolation when descriptor prototypes have a value', () => {
  let reads = 0;
  const source = { get text() { reads++; return 'actual'; } };
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  let result: typeof source | undefined;
  try {
    Object.defineProperty(Object.prototype, 'value', Object.assign(Object.create(null), { value: 'forged', configurable: true }));
    result = captureImmutableData(source);
  } finally {
    delete (Object.prototype as any).value;
    if (prior) Object.defineProperty(Object.prototype, 'value', prior);
  }
  expect(result!.text).toBe('actual'); expect(reads).toBe(1);
  expect(isCapturedImmutableData(result)).toBe(false);
});
it('merged base scanning preserves identity diagnostic order and literal interpretation', () => {
  const sources = [
    '<Document #doc [<P id="a" {text="a"}><P #b {text="b"}>]>',
    '<Document #doc [<P #a {text="a"}><P #a {text="b"}>]>',
    '<Document #doc [<P {text="a"}><P #b {text="b"}>]>',
    '<Document #doc [<ComponentEmbed #comp {input={kind="DataElement" tag="P" id={kind="Word" namespace=[] name="doc"}}}><P #a {text="a"}>]>',
  ];
  for (const source of sources) {
    const root = captureImmutableData(parseXnl(source).nodes[0] as DataElementNode);
    for (const policy of ['allow-missing', 'require-elements'] as const) {
      const settings = captureImmutableData({ ...config, identityPolicy: policy });
      for (const edits of [batch(), batch(undefined, 'forged'), batch('#a:id:name', 'a', 'changed'),
        captureImmutableData([...batch(), ...batch(undefined, 'changed', 'again')])]) {
        expect(comparable(dryRunImmutableMutations(root, edits, settings))).toEqual(dryRunMutations(root, edits, settings));
      }
    }
  }
  const aliased = parseXnl('<Document #doc [<P #a {text="a"}>]>').nodes[0] as DataElementNode;
  aliased.body!.push(aliased.body![0]!);
  const root = captureImmutableData(aliased);
  expect(comparable(dryRunImmutableMutations(root, batch(), config))).toEqual(dryRunMutations(root, batch(), config));
  expect(dryRunImmutableMutations(root, batch(), config).diagnostics[0]?.code).toBe('DUPLICATE_IDENTITY');
});
it('the scalar probe keeps final path semantics for AST, Word and ordinary maps', () => {
  const input: any = parseXnl('<P #p {text="a"}>').nodes[0];
  input.foo = 'x'; input.id.extra = 'word';
  const root = captureImmutableData(input);
  for (const [path, before] of [["#p::'foo'", 'x'], ['#p:id:extra', 'word'], ['#p:attributes:text', 'a'], ["#p:attributes::'text'", 'a'], ["<id='p'>:attributes::'text'", 'a']] as const) {
    const edits = batch(path, before);
    const actual = dryRunImmutableMutations(root, edits, config);
    expect(comparable(actual)).toEqual(dryRunMutations(root, edits, config));
    if (path.includes('attributes')) expect(actual.status).toBe('applied');
    else expect(actual.status).toBe('rejected');
  }
});
it('explicit immutable results share untouched subtrees while default results stay mutable and isolated', () => {
  const source = base(), mutations = batch();
  const immutable = dryRunImmutableMutations(source, mutations, config), original = dryRunMutations(source, mutations, config);
  expect(comparable(immutable)).toEqual(original); expect(immutable.status).toBe('applied');
  expect(immutable.representation).toBe('captured-data');
  const next = immutable.value as DataElementNode;
  expect(next.body![1]).toBe(source.body![1]); expect(next.body![0]).not.toBe(source.body![0]);
  expect(Object.isFrozen(next)).toBe(true); expect(Object.isFrozen(next.body![1])).toBe(true);
  expect(Object.isFrozen(original.value)).toBe(false);
  expect((original.value as DataElementNode).body![1]).not.toBe(source.body![1]);
  expect((source.body![0] as DataElementNode).attributes!.text).toBe('a');
});
it.each([
  batch(undefined, 'forged'), batch('#a:id:name', undefined, 'forged'), batch('#doc:body:length', undefined, 0),
  batch('#a:kind', undefined, 'TextElement'), batch("#missing:attributes::'text'"), batch("#a:attributes::'text'", undefined),
].map(mutations => ({ mutations })))('keeps full strict diagnostics for rejected and uncertain paths', ({ mutations }) => {
  const source = base();
  expect(comparable(dryRunImmutableMutations(source, mutations, config))).toEqual(dryRunMutations(source, mutations, config));
});
it('aliases, cycles, mutable and Proxy inputs retain the original safe path', () => {
  const leaf = { text: 'a' }, source = captureImmutableData({ first: leaf, second: leaf });
  const mutations = batch(":first::'text'");
  const result = dryRunImmutableMutations(source as never, mutations, config);
  expect(comparable(result)).toEqual(dryRunMutations(source as never, mutations, config));
  expect(result.status).toBe('applied'); expect((result.value as any).first.text).toBe('changed');
  expect((result.value as any).first).toBe((result.value as any).second);
  const cyclic = parseXnl('<P #p {text="a"}>').nodes[0] as DataElementNode;
  cyclic.attributes!.link = cyclic;
  const cycle = captureImmutableData(cyclic), cycleBatch = batch("#p:attributes::'text'");
  const cycleResult = dryRunImmutableMutations(cycle, cycleBatch, config);
  expect(cycleResult.status).toBe('applied');
  expect(comparable(cycleResult)).toEqual(dryRunMutations(cycle, cycleBatch, config));
  expect((cycleResult.value as DataElementNode).attributes!.link).toBe(cycleResult.value);
  const proxy = new Proxy(base(), {});
  expect(() => dryRunImmutableMutations(proxy, batch(), config)).toThrow();
});
it('unrelated immutable aliases stay shared without hiding repeated target parents', () => {
  const payload = { label: 'shared' }, root = captureImmutableData({ target: { text: 'a' }, first: payload, second: payload });
  const edits = batch(":target::'text'");
  const result = dryRunImmutableMutations(root as never, edits, config);
  expect(comparable(result)).toEqual(dryRunMutations(root as never, edits, config));
  expect((result.value as any).first).toBe(root.first);
  expect((result.value as any).first).toBe((result.value as any).second);
  const ancestor = { target: { text: 'a' } }, aliased = captureImmutableData({ first: ancestor, second: ancestor });
  const aliasEdit = batch(":first::'target'::'text'");
  const updated = dryRunImmutableMutations(aliased as never, aliasEdit, config);
  expect(comparable(updated)).toEqual(dryRunMutations(aliased as never, aliasEdit, config));
  expect((updated.value as any).first).toBe((updated.value as any).second);
  expect((updated.value as any).second.target.text).toBe('changed');
});
it('inherited address setters cannot redirect the private scalar copy', () => {
  const root = captureImmutableData({ target: { text: 'a' }, other: { text: 'safe' } });
  const edits = batch(":target::'text'"), prior = Object.getOwnPropertyDescriptor(Object.prototype, 'address');
  let calls = 0, result, original;
  try {
    Object.defineProperty(Object.prototype, 'address', { configurable: true, set() {
      calls++;
      Object.defineProperty(this, 'address', { value: ['other', 'text'], writable: true, configurable: true });
    } });
    result = dryRunImmutableMutations(root as never, edits, config);
    original = dryRunMutations(root as never, edits, config);
  } finally { if (prior) Object.defineProperty(Object.prototype, 'address', prior); else delete (Object.prototype as any).address; }
  expect(comparable(result!)).toEqual(original); expect(calls).toBe(0);
  expect((result!.value as any).target.text).toBe('changed'); expect((result!.value as any).other.text).toBe('safe');
});
it('active-path promotion preserves deep graphs and later shallow siblings', () => {
  for (const depth of [31, 32, 33, 80]) {
    const chain = (tail: any) => { for (let index = 0; index < depth; index++) tail = { next: tail }; return tail; };
    const root = captureImmutableData({ first: chain({ text: 'a' }), second: chain({ text: 'other' }), shallow: { text: 'safe' } });
    const path = ':first' + ':next'.repeat(depth) + ":'text'";
    // InstanceProperty on the last plain-map field uses the same own read.
    const edits = batch(path.replace(":'text'", ':text'));
    const result = dryRunImmutableMutations(root as never, edits, config);
    expect(comparable(result)).toEqual(dryRunMutations(root as never, edits, config));
    expect(result.status).toBe('applied'); expect((result.value as any).second).toBe(root.second);
    expect((result.value as any).shallow).toBe(root.shallow);
    const cycle: any = { text: 'a' }; cycle.deep = chain(cycle);
    const captured = captureImmutableData(cycle), cycleEdits = batch(':text');
    expect(comparable(dryRunImmutableMutations(captured, cycleEdits, config))).toEqual(dryRunMutations(captured, cycleEdits, config));
  }
});
it('captured record enumeration preserves own key order and excludes inherited branches', () => {
  const node = (id: string) => parseXnl(`<P #${id}>`).nodes[0];
  const source = captureImmutableData({ '10': node('x'), '2': node('y'), tail: node('x'), later: node('y'), target: { text: 'a' } });
  const edits = batch(':target:text');
  const result = dryRunImmutableMutations(source as never, edits, config);
  expect(comparable(result)).toEqual(dryRunMutations(source as never, edits, config));
  expect(result.diagnostics.map(diagnostic => diagnostic.identity)).toEqual(['x', 'y']);
  const clean = captureImmutableData({ target: { text: 'a' }, body: [node('one')] });
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'foreignBranch');
  let actual, expected;
  try {
    Object.defineProperty(Object.prototype, 'foreignBranch', { value: clean.body[0], enumerable: true, configurable: true });
    actual = dryRunImmutableMutations(clean as never, edits, config);
    expected = dryRunMutations(clean as never, edits, config);
  } finally { if (previous) Object.defineProperty(Object.prototype, 'foreignBranch', previous); else delete (Object.prototype as any).foreignBranch; }
  expect(comparable(actual!)).toEqual(expected); expect(actual!.status).toBe('applied');
});
it('dense index traversal preserves nested arrays and named or sparse fallbacks', () => {
  const leaf = { empty: [] }, dense = captureImmutableData([{ text: 'a', arrays: [[], [leaf, leaf]] }, { keep: true }]);
  const edits = batch("::0::'text'");
  const result = dryRunImmutableMutations(dense as never, edits, config);
  expect(comparable(result)).toEqual(dryRunMutations(dense as never, edits, config));
  expect((result.value as any)[1]).toBe(dense[1]);
  const sparse = new Array(2); sparse[0] = { text: 'a' };
  const named = Object.assign([{ text: 'a' }], { extra: parseXnl('<P #named>').nodes[0] });
  for (const input of [sparse, named]) {
    const source = captureImmutableData(input);
    expect(comparable(dryRunImmutableMutations(source as never, edits, config))).toEqual(dryRunMutations(source as never, edits, config));
  }
});
it('literal fallback transfers syntax context to immutable output and later context changes are observed', () => {
  const source = parseXnl('<Document #doc [<ComponentEmbed #comp {input={kind="DataElement" tag="P" metadata={id="doc"}}}>]>').nodes[0] as DataElementNode;
  const result = dryRunImmutableMutations(source, [], config);
  expect(result.status).toBe('applied');
  const literal = ((result.value as DataElementNode).body![0] as DataElementNode).attributes!.input;
  expect(isLiteralObject(literal)).toBe(true);
  expect(comparable(dryRunImmutableMutations(result.value, captureImmutableData([]), config))).toEqual(dryRunMutations(result.value, [], config));
  const original = base();
  markLiteralObject(original.body![0] as object);
  expect(comparable(dryRunImmutableMutations(original, batch(), config))).toEqual(dryRunMutations(original, batch(), config));
});
it('malformed path probes fall back to original strict rejection instead of throwing early', () => {
  const source = base();
  for (const path of [[null, { type: 'MapKey', value: 'text' }], [{ type: 'UniqueName', value: null }, { type: 'MapKey', value: 'text' }]]) {
    const mutations = captureImmutableData([{ type: 'OBJECT_UPDATE', path, valueAfter: 'after' }]) as never;
    expect(comparable(dryRunImmutableMutations(source, mutations, config))).toEqual(dryRunMutations(source, mutations, config));
  }
  const missingValueSource = captureImmutableData({ undefined: 'before' });
  const missingValueBatch = captureImmutableData([{ type: 'OBJECT_UPDATE', path: [{ type: 'MapKey' }], valueAfter: 'after' }]) as never;
  expect(comparable(dryRunImmutableMutations(missingValueSource as never, missingValueBatch, config))).toEqual(dryRunMutations(missingValueSource as never, missingValueBatch, config));
  expect(comparable(dryRunImmutableMutations(source, captureImmutableData([]), config))).toEqual(dryRunMutations(source, [], config));
});
it('inherited identity fields retain the default clone interpretation instead of certifying a different source', () => {
  const source = captureImmutableData(parseXnl('<Document #doc [<Paragraph #a [<Text {text="a"}>]><Paragraph #b [<Text {text="b"}>]>]>').nodes[0] as DataElementNode);
  const edits = batch("#a:body::0:attributes::'text'");
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'id');
  let actual, expected;
  try {
    Object.defineProperty(Object.prototype, 'id', { configurable: true, value: { kind: 'Word', namespace: [], name: 'inherited' } });
    actual = comparable(dryRunImmutableMutations(source, edits, config)); expected = dryRunMutations(source, edits, config);
  } finally { if (prior) Object.defineProperty(Object.prototype, 'id', prior); else delete (Object.prototype as any).id; }
  expect(actual).toEqual(expected); expect(actual!.status).toBe('rejected');
});
it('non-data builtin results explicitly retain native isolation without claiming immutability', () => {
  const source = parseXnl('<P #p>').nodes[0] as DataElementNode;
  source.attributes = { date: new Date(0), map: new Map([['v', 1]]) } as never;
  const result = dryRunImmutableMutations(source, [], config);
  expect(result.status).toBe('applied'); expect(result.representation).toBe('isolated-native');
  const attrs = (result.value as DataElementNode).attributes as any;
  attrs.date.setTime(9); attrs.map.set('v', 2);
  expect((source.attributes as any).date.getTime()).toBe(0);
  expect((source.attributes as any).map.get('v')).toBe(1);
});
it('container updates issue only fresh captured own data and retain exact unrelated values', () => {
  const child = captureImmutableData({ text: 'unchanged' }), source = captureImmutableData([child, { text: 'old' }]);
  const changed = replaceCapturedDataProperty(source, '1', { text: 'new' })!;
  expect(changed[0]).toBe(child); expect(changed[1]).toEqual({ text: 'new' });
  expect(source[1]).toEqual({ text: 'old' }); expect(isCapturedImmutableData(changed[1])).toBe(true);
  expect(replaceCapturedDataProperty(Object.freeze({ key: 1 }), 'key', 2)).toBeUndefined();
  expect(replaceCapturedDataProperty(source, 'length', 0)).toBeUndefined();
  expect(replaceCapturedDataProperty(source, '2', 1)).toBeUndefined();
  expect(replaceCapturedDataProperty(source, '0', new Map())).toBeUndefined();
  const record = captureImmutableData({ key: 1, retained: child });
  const output = replaceCapturedDataProperty(record, 'key', 2)!;
  expect(output.retained).toBe(child); expect(Object.getPrototypeOf(output)).toBeNull(); expect(Object.isFrozen(output)).toBe(true);
  let conversions = 0;
  const forgedKey = { [Symbol.toPrimitive]() { return ++conversions === 1 ? 'key' : Symbol.for('forged'); } };
  expect(replaceCapturedDataProperty(record, forgedKey as never, 2)).toBeUndefined(); expect(conversions).toBe(0);
});
it('inherited numeric setters cannot inject mutable children into a captured array', () => {
  const source = captureImmutableData([{ value: 1 }, { value: 2 }]), injected = { value: 9 };
  const prior = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  let output: typeof source | undefined;
  try {
    Object.defineProperty(Array.prototype, '0', { configurable: true, set() {
      Object.defineProperty(this, '0', { value: injected, enumerable: true, configurable: true, writable: true });
    } });
    output = replaceCapturedDataProperty(source, '1', { value: 3 });
  } finally { if (prior) Object.defineProperty(Array.prototype, '0', prior); else delete (Array.prototype as any)[0]; }
  injected.value = 99;
  expect(output![0]).toBe(source[0]); expect(output![0]!.value).toBe(1);
  expect(isCapturedImmutableData(output![0])).toBe(true); expect(Object.isFrozen(output![0])).toBe(true);
});
