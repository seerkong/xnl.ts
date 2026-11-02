import type { XnlMutationBatchOptions, XnlMutationOptions } from './index';
import { isCapturedImmutableData } from '../immutable-data';
import { isCapturedDenseArray } from 'immutable-data-core';

export interface ImmutableLiteralProfile { key: string; rules: readonly { tags: readonly string[]; attributes: readonly string[] }[]; options: XnlMutationBatchOptions }
interface Facts { binding: boolean; extend: boolean }
const profiles = new WeakMap<object, ImmutableLiteralProfile>();
const facts = new WeakMap<object, { key: string; value: Facts }>();
const clonedData = new WeakSet<object>();
const dataDescriptor = (value: PropertyDescriptor | undefined): value is PropertyDescriptor =>
  value !== undefined && Object.prototype.hasOwnProperty.call(value, 'value');

/** A successful native clone excludes Proxies throughout this frozen closure.
 * Record only after isolation succeeds; never infer this from Object.freeze. */
export function rememberClonedStructure(root: unknown, profile: ImmutableLiteralProfile): void {
  if (!root || typeof root !== 'object' || facts.get(root)?.key !== profile.key) return;
  const pending: object[] = [], seen = new Set<object>();
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object' || clonedData.has(value) || seen.has(value)) return;
    seen.add(value); pending.push(value);
    const values = Object.values(value);
    for (let index = 0; index < values.length; index++) visit(values[index]);
  }
  visit(root); pending.forEach(value => clonedData.add(value));
}
export function clonedStructureFacts(value: object, profile: ImmutableLiteralProfile): Facts | undefined {
  const proof = facts.get(value);
  return (clonedData.has(value) || isCapturedImmutableData(value)) && proof?.key === profile.key ? proof.value : undefined;
}

function frozenArray(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || Reflect.ownKeys(descriptors).length !== length + 1) return;
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, String(index))?.value as PropertyDescriptor | undefined;
    if (!dataDescriptor(descriptor) || !descriptor.enumerable) return;
    Object.defineProperty(result, index, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
function strings(value: unknown): string[] | undefined {
  const values = frozenArray(value); if (!values) return;
  for (let index = 0; index < values.length; index++) if (typeof values[index] !== 'string') return;
  return values as string[];
}
/** Supported rules are data, not methods supplied by an Array proxy. The same
 * own-index snapshot drives both the key and the actual literal matcher. */
export function immutableLiteralProfile(options: XnlMutationOptions): ImmutableLiteralProfile | undefined {
  try { return inspectLiteralProfile(options); } catch { return; }
}
function inspectLiteralProfile(options: XnlMutationOptions): ImmutableLiteralProfile | undefined {
  const previous = profiles.get(options); if (previous) return previous;
  if (!Object.isFrozen(options)) return;
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== null && prototype !== Object.prototype) return;
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const own = (key: string): PropertyDescriptor | undefined => Object.getOwnPropertyDescriptor(descriptors, key)?.value;
  // Missing fields retain legacy inherited semantics. Only an explicit closed
  // data configuration may be canonicalized and reused across calls.
  for (const key of ['metadataIdMode', 'literalValuePaths', 'literalAttributeRules', 'identityPolicy', 'verifyValueBefore']) {
    const descriptor = own(key);
    if (!dataDescriptor(descriptor)) return;
  }
  const paths = own('literalValuePaths')!, declared = own('literalAttributeRules')!;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !dataDescriptor(descriptors[key])) return;
  }
  if (!dataDescriptor(paths) || !dataDescriptor(declared)) return;
  if (paths.value !== undefined && frozenArray(paths.value)?.length !== 0) return;
  const source = declared.value === undefined ? [] : frozenArray(declared.value); if (!source) return;
  const rules: { tags: string[]; attributes: string[] }[] = [];
  for (let index = 0; index < source.length; index++) {
    const rule = source[index]; if (!rule || typeof rule !== 'object' || !Object.isFrozen(rule)) return;
    const fields = Object.getOwnPropertyDescriptors(rule);
    const tagsField = Object.getOwnPropertyDescriptor(fields, 'tags')?.value as PropertyDescriptor | undefined;
    const attributesField = Object.getOwnPropertyDescriptor(fields, 'attributes')?.value as PropertyDescriptor | undefined;
    if (Reflect.ownKeys(fields).length !== 2 || !dataDescriptor(tagsField) || !dataDescriptor(attributesField)) return;
    const tags = strings(tagsField.value), attributes = strings(attributesField.value);
    if (!tags || !attributes) return;
    Object.defineProperty(rules, index, { value: { tags, attributes }, enumerable: true, configurable: true, writable: true });
  }
  let key = `${rules.length}:`;
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]!;
    key += `${rule.tags.length}:`;
    for (let item = 0; item < rule.tags.length; item++) key += JSON.stringify(rule.tags[item]);
    key += `${rule.attributes.length}:`;
    for (let item = 0; item < rule.attributes.length; item++) key += JSON.stringify(rule.attributes[item]);
  }
  const mode = own('metadataIdMode')!.value, policy = own('identityPolicy')!.value, verify = own('verifyValueBefore')!.value;
  if (mode !== undefined && mode !== 'identity' && mode !== 'metadata'
    || policy !== undefined && policy !== 'allow-missing' && policy !== 'require-elements'
    || verify !== undefined && typeof verify !== 'boolean') return;
  const canonicalRules = Object.freeze(rules.map(rule => Object.freeze({ tags: Object.freeze(rule.tags), attributes: Object.freeze(rule.attributes) })));
  const canonicalOptions = Object.freeze({ metadataIdMode: mode, identityPolicy: policy, verifyValueBefore: verify,
    literalValuePaths: undefined, literalAttributeRules: canonicalRules });
  const result = Object.freeze({ rules: canonicalRules, key, options: canonicalOptions });
  profiles.set(options, result); profiles.set(canonicalOptions, result); return result;
}

// These are exactly the inherited reads used by the conservative binding and
// Extend facts below. No identity or path resolution is certified here.
export function structureFactPrototypesSafe(profile?: ImmutableLiteralProfile): boolean {
  if (Object.getPrototypeOf(Object.prototype) !== null || Object.getPrototypeOf(Array.prototype) !== Object.prototype) return false;
  for (const key of ['kind', 'tag', 'id', 'metadata', 'attributes', 'body', 'extend', 'order', 'children', 'namespace', 'name']) {
    if (Object.getOwnPropertyDescriptor(Object.prototype, key) || Object.getOwnPropertyDescriptor(Array.prototype, key)) return false;
  }
  if (profile) for (let rule = 0; rule < profile.rules.length; rule++) for (let index = 0; index < profile.rules[rule]!.attributes.length; index++) {
    const key = profile.rules[rule]!.attributes[index]!;
    if (Object.getOwnPropertyDescriptor(Object.prototype, key) || Object.getOwnPropertyDescriptor(Array.prototype, key)) return false;
  }
  return true;
}

/** Own-data facts, used only after the original structuredClone has succeeded.
 * This is not a certificate of cloneability: e.g. a Proxy can report frozen
 * own fields but still fails the native clone. Never use it to skip isolation.
 * Only immutable own-data closures qualify. Ignore literal markers entirely:
 * later marking can remove actual matches, never invalidate these negatives.
 * Cycles are unknown; publish nothing from a failed/partial traversal. */
export function frozenStructureFacts(root: unknown, profile: ImmutableLiteralProfile): Facts | undefined {
  try { return inspectStructureFacts(root, profile); } catch { return; }
}
function inspectStructureFacts(root: unknown, profile: ImmutableLiteralProfile): Facts | undefined {
  if (!structureFactPrototypesSafe(profile)) return;
  const pending = new Map<object, Facts>(), active = new Set<object>();
  function visit(value: unknown): Facts | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return { binding: false, extend: false };
    if (typeof value !== 'object' || active.has(value)) return;
    const prior = facts.get(value); if (prior?.key === profile.key) return prior.value;
    const completed = pending.get(value); if (completed) return completed;
    if (!Object.isFrozen(value)) return;
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== null) return;
    if (array && isCapturedDenseArray(value)) {
      active.add(value);
      let binding = false, extend = false;
      for (let index = 0; index < value.length; index++) {
        const child = visit(value[index]); if (!child) return;
        binding ||= child.binding; extend ||= child.extend;
      }
      active.delete(value);
      const result = Object.freeze({ binding, extend }); pending.set(value, result); return result;
    }
    const captured = isCapturedImmutableData(value);
    const descriptors = captured ? undefined : Object.getOwnPropertyDescriptors(value);
    const keys = captured ? Object.keys(value) : Reflect.ownKeys(descriptors!);
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : undefined;
    if (array && keys.length !== length + (captured ? 0 : 1)) return;
    const data: Record<string, unknown> = Object.create(null);
    active.add(value);
    let binding = false, extend = false;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (array && key === 'length') continue;
      const descriptor = typeof key === 'string' && descriptors ? descriptors[key] : undefined;
      if (!captured && (!dataDescriptor(descriptor) || !descriptor.enumerable)
        || array && (!/^(0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= length)) return;
      // The package-owned capture proof certifies own data descriptors only;
      // literal/identity/schema facts still come from this traversal.
      const field = captured ? (value as Record<string, unknown>)[String(key)] : descriptor!.value;
      const child = visit(field); if (!child) return;
      data[String(key)] = field; binding ||= child.binding; extend ||= child.extend;
    }
    active.delete(value);
    extend ||= Array.isArray(data.order);
    if ((data.kind === 'DataElement' || data.kind === 'TextElement') && typeof data.tag === 'string'
      && data.metadata !== null && typeof data.metadata === 'object' && !Array.isArray(data.metadata)) {
      for (let index = 0; index < profile.rules.length; index++) {
        const rule = profile.rules[index]!;
        for (let tag = 0; tag < rule.tags.length; tag++) if (rule.tags[tag] === data.tag) {
          const attrs = data.attributes as Record<string, unknown> | null | undefined;
          if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || Object.getPrototypeOf(attrs) !== null)) { binding = true; continue; }
          for (let attribute = 0; attribute < rule.attributes.length; attribute++) {
            const literal = attrs?.[rule.attributes[attribute]!];
            binding ||= literal !== null && typeof literal === 'object';
          }
        }
      }
    }
    const result = Object.freeze({ binding, extend }); pending.set(value, result); return result;
  }
  const result = visit(root);
  if (!result || !structureFactPrototypesSafe(profile)) return;
  pending.forEach((value, object) => facts.set(object, { key: profile.key, value }));
  return result;
}
