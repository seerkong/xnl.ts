import { expect, it } from 'vitest';
import { captureImmutableData, diffNodes, dryRunMutations, parseXnl, type DataElementNode } from '../src/index';
import { clonedStructureFacts, frozenStructureFacts, immutableLiteralProfile } from '../src/mutation/immutableFacts';
import { markLiteralObject } from '../src/value-context';

function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutable)) as T;
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)])))) as T;
}
const options = Object.freeze({ metadataIdMode: 'identity' as const, identityPolicy: 'allow-missing' as const, literalValuePaths: undefined,
  literalAttributeRules: immutable([{ tags: ['ComponentEmbed'], attributes: ['input'] }]), verifyValueBefore: true });
const profile = immutableLiteralProfile(options)!;
it('diff seeds the existing absence facts for a new captured root and preserves the raw oracle', () => {
  const base = captureImmutableData(parseXnl('<Document #doc [<P #a {text="one"}><P #b {text="other"}>]>').nodes[0] as DataElementNode);
  const first = base.body![0] as DataElementNode;
  const candidate = captureImmutableData({ ...base, body: [captureImmutableData({ ...first,
    attributes: { ...first.attributes, text: 'changed' } }), base.body![1]!] });
  expect(clonedStructureFacts(candidate, profile)).toBeUndefined();
  const expected = diffNodes(structuredClone(base), structuredClone(candidate), [], options);
  expect(diffNodes(base, candidate, [], options)).toEqual(expected);
  expect(clonedStructureFacts(candidate, profile)).toEqual({ binding: false, extend: false });
  expect(dryRunMutations(base, expected, options)).toMatchObject({ status: 'applied', value: candidate });
  markLiteralObject(candidate);
  expect(diffNodes(candidate, candidate, [], options)).toEqual([]);
});

it('new literal inputs and changed rule sets cannot inherit a prior negative', () => {
  const base = captureImmutableData(parseXnl('<Document #doc [<P #a {text="one"}>]>').nodes[0] as DataElementNode);
  diffNodes(base, base, [], options);
  const added = captureImmutableData(parseXnl('<ComponentEmbed #comp {input={kind="DataElement" tag="P" id={kind="Word" namespace=[] name="doc"} metadata={}}}>').nodes[0]!);
  const candidate = captureImmutableData({ ...base, body: [...base.body!, added] });
  const actual = diffNodes(base, candidate, [], options);
  const expected = diffNodes(structuredClone(base), structuredClone(candidate), [], options);
  expect(actual).toEqual(expected);
  expect(dryRunMutations(base, actual, options)).toMatchObject({ status: 'applied', value: candidate });
  const noRules = captureImmutableData({ ...options, literalAttributeRules: [] });
  expect(dryRunMutations(base, diffNodes(base, candidate, [], noRules), noRules).status).toBe('rejected');
});
it('an inherited descriptor value never turns an accessor option into own data', () => {
  let reads = 0;
  const config = Object.freeze({ ...options, get verifyValueBefore() { reads++; return true; } });
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  let actual;
  try {
    Object.defineProperty(Object.prototype, 'value', Object.assign(Object.create(null), { value: false, configurable: true }));
    actual = immutableLiteralProfile(config);
  } finally {
    delete (Object.prototype as any).value;
    if (inherited) Object.defineProperty(Object.prototype, 'value', inherited);
  }
  expect(actual).toBeUndefined(); expect(reads).toBe(0);
});
it('negative facts reuse immutable DAG data but never certify cycles or partial scans', () => {
  const leaf = immutable({ value: 1 }), dag = immutable({ left: leaf, right: leaf });
  expect(frozenStructureFacts(dag, profile)).toEqual({ binding: false, extend: false });
  expect(frozenStructureFacts(dag, profile)).toBe(frozenStructureFacts(dag, profile));
  const a: any = Object.create(null), b: any = Object.create(null);
  a.match = immutable({ kind: 'DataElement', tag: 'ComponentEmbed', metadata: {}, attributes: { input: {} } });
  a.b = b; b.a = a; Object.freeze(a); Object.freeze(b);
  expect(frozenStructureFacts(a, profile)).toBeUndefined();
  expect(frozenStructureFacts(b, profile)).toBeUndefined();
  expect(frozenStructureFacts(Object.freeze({ nested: {} }), profile)).toBeUndefined();
});
it('literal marks cannot invalidate a negative computed conservatively without them', () => {
  const root = immutable({ kind: 'DataElement', tag: 'P', metadata: {}, body: [] });
  expect(frozenStructureFacts(root, profile)?.binding).toBe(false);
  markLiteralObject(root);
  expect(frozenStructureFacts(root, profile)?.binding).toBe(false);
});
it('frozen rule proxies use the same own-index data for key and actual binding', () => {
  const proxy = (values: readonly string[]) => new Proxy(Object.freeze([...values]), { get(target, key, receiver) {
    if (key === 'includes') return () => false;
    if (key === Symbol.iterator) return function* () { yield 'forged'; };
    return Reflect.get(target, key, receiver);
  } });
  const rules = Object.freeze([Object.freeze({ tags: proxy(['ComponentEmbed']), attributes: proxy(['input']) })]);
  const proxied = Object.freeze({ ...options, literalAttributeRules: rules });
  expect(immutableLiteralProfile(proxied)?.key).toBe(profile.key);
  const base = immutable(parseXnl('<Document #doc [<ComponentEmbed #comp {label="before" input={kind="DataElement" tag="Fake" metadata={} id={kind="Word" namespace=[] name="doc"}}}>]>').nodes[0] as DataElementNode);
  expect(frozenStructureFacts(base, profile)?.binding).toBe(true);
  expect(dryRunMutations(base, [{ type: 'OBJECT_UPDATE', path: "#comp:attributes::'label'", valueBefore: 'before', valueAfter: 'after' }], proxied).status).toBe('applied');
});
it('prototype interpretation changes and structural edits never reuse the absence proof', () => {
  const base = immutable(parseXnl('<Document #doc [<P #a {text="one"}>]>').nodes[0] as DataElementNode);
  expect(frozenStructureFacts(base, profile)).toEqual({ binding: false, extend: false });
  for (const key of ['attributes', 'body', 'extend', 'order', 'input']) {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, key); let result;
    try { Object.defineProperty(Object.prototype, key, { configurable: true, value: {} }); result = frozenStructureFacts(base, profile); }
    finally { if (prior) Object.defineProperty(Object.prototype, key, prior); else delete (Object.prototype as any)[key]; }
    expect(result).toBeUndefined();
  }
  const bad = { order: ['a', 'a'], children: { a: parseXnl('<P #nested>').nodes[0] } };
  expect(dryRunMutations(base, [{ type: 'OBJECT_ADD', path: '#doc:extend', valueAfter: bad }], options).status).toBe('rejected');
  expect(dryRunMutations(base, [{ type: 'TREE_ADD', path: '#doc:body::1', valueAfter: base.body![0] }], options).status).toBe('rejected');
});
it('native isolation remains mandatory for a frozen Proxy pretending to be a data closure', () => {
  const target = immutable({ kind: 'DataElement', tag: 'P', metadata: {}, body: [] });
  const proxy = new Proxy(target, { get(object, key, receiver) { if (key === 'attributes') return { input: {} }; return Reflect.get(object, key, receiver); } });
  const config = Object.freeze({ ...options, literalAttributeRules: immutable([{ tags: ['P'], attributes: ['input'] }]) });
  expect(() => dryRunMutations(proxy, [], config)).toThrow();
  expect(() => diffNodes(proxy, proxy, [], config)).toThrow();
});
it('a canonical rule snapshot never reads the original rules length capability after warming', () => {
  let reads = 0;
  const rules = new Proxy(options.literalAttributeRules, { get(target, key, receiver) {
    if (key === 'length') reads++;
    return Reflect.get(target, key, receiver);
  } });
  const config = Object.freeze({ ...options, literalAttributeRules: rules });
  const base = immutable(parseXnl('<Document #doc [<P #a {text="one"}>]>').nodes[0] as DataElementNode);
  expect(dryRunMutations(base, [], config).status).toBe('applied');
  expect(diffNodes(base, base, [], config)).toEqual([]);
  expect(reads).toBe(0);
});
it('supported empty path data cannot grant a literal boundary through a Proxy iterator', () => {
  const paths = new Proxy(Object.freeze([]), { get(target, key, receiver) {
    if (key === Symbol.iterator) return function* () { yield "#comp:attributes::'input'"; };
    return Reflect.get(target, key, receiver);
  } });
  const data = parseXnl('<Document #doc [<ComponentEmbed #comp {input=<P #doc>}>]>').nodes[0] as DataElementNode;
  const config = Object.freeze({ ...options, literalValuePaths: paths, literalAttributeRules: Object.freeze([]) });
  expect(dryRunMutations(data, [], config).status).toBe('rejected');
});
it('unknown rule capabilities retain per-operation rebinding and skeleton validation', () => {
  let matches = 0;
  const tags = new Proxy(['ComponentEmbed'], { get(target, key, receiver) {
    if (key === 'includes') return (tag: string) => tag === 'ComponentEmbed' && ++matches > 1;
    return Reflect.get(target, key, receiver);
  } });
  const base = parseXnl('<Document #doc [<ComponentEmbed #comp mode="other" {input=<P #inside>}>]>').nodes[0] as DataElementNode;
  const result = dryRunMutations(base, [{ type: 'OBJECT_UPDATE', path: "#comp:metadata::'mode'", valueBefore: 'other', valueAfter: 'literal' }],
    { literalAttributeRules: [{ tags, attributes: ['input'] }] });
  expect(result.status).toBe('rejected');
  expect(result.diagnostics[0]?.code).toBe('IDENTITY_MUTATION_FORBIDDEN');
});

it('incomplete frozen options preserve inherited verification semantics after warming', () => {
  const incomplete = Object.freeze({ literalValuePaths: undefined, literalAttributeRules: Object.freeze([]) });
  expect(immutableLiteralProfile(incomplete)).toBeUndefined();
  const base = parseXnl('<P #p {label="before"}>').nodes[0] as DataElementNode;
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'verifyValueBefore');
  let frozenStatus: string | undefined, plainStatus: string | undefined;
  try {
    Object.defineProperty(Object.prototype, 'verifyValueBefore', { configurable: true, value: true });
    const batch = [{ type: 'OBJECT_UPDATE' as const, path: "#p:attributes::'label'", valueBefore: 'forged', valueAfter: 'after' }];
    frozenStatus = dryRunMutations(base, batch, incomplete).status;
    plainStatus = dryRunMutations(base, batch, { ...incomplete }).status;
  } finally {
    if (prior) Object.defineProperty(Object.prototype, 'verifyValueBefore', prior);
    else delete (Object.prototype as any).verifyValueBefore;
  }
  expect(frozenStatus).toBe('rejected'); expect(frozenStatus).toBe(plainStatus);
});

it('rule fields and array indexes must have their own data descriptors', () => {
  const priorTags = Object.getOwnPropertyDescriptor(Object.prototype, 'tags');
  const priorAttributes = Object.getOwnPropertyDescriptor(Object.prototype, 'attributes');
  let result;
  try {
    Object.defineProperty(Object.prototype, 'tags', { configurable: true, value: { value: Object.freeze(['P']) } });
    Object.defineProperty(Object.prototype, 'attributes', { configurable: true, value: { value: Object.freeze(['input']) } });
    result = immutableLiteralProfile(Object.freeze({ ...options, literalAttributeRules: Object.freeze([Object.freeze({ wrong: 1, other: 2 })]) }) as any);
  } finally {
    for (const [key, descriptor] of [['tags', priorTags], ['attributes', priorAttributes]] as const) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor); else delete (Object.prototype as any)[key];
    }
  }
  expect(result).toBeUndefined();
  const sparse: any[] = new Array(1); Object.defineProperty(sparse, 'extra', { value: 'P' }); Object.freeze(sparse);
  const priorIndex = Object.getOwnPropertyDescriptor(Object.prototype, '0');
  try {
    Object.defineProperty(Object.prototype, '0', { configurable: true, writable: true, value: { value: 'P', enumerable: true } });
    result = immutableLiteralProfile(Object.freeze({ ...options, literalAttributeRules: Object.freeze([Object.freeze({ tags: sparse, attributes: Object.freeze(['input']) })]) }));
  } finally { if (priorIndex) Object.defineProperty(Object.prototype, '0', priorIndex); else delete (Object.prototype as any)[0]; }
  expect(result).toBeUndefined();
});
