/** Captured immutable data is an isolation fact, never proof of schema,
 * identity, permissions, or candidate admission. Those validators still run. */
const captured = new WeakSet<object>();
const denseArrays = new WeakSet<object>();
// A mapper is external code. Capture exactly the capabilities used to issue
// its result's isolation proof before any callback can replace globals.
const hasCaptured = captured.has.bind(captured);
const addCaptured = captured.add.bind(captured);
const hasDenseArray = denseArrays.has.bind(denseArrays);
const addDenseArray = denseArrays.add.bind(denseArrays);
const freezeMapped = Object.freeze;
const setMappedPrototype = Object.setPrototypeOf;
const mappedArrayPrototype = Array.prototype;
const DataArray = Array;
const DataMap = Map;
const isArray = Array.isArray;
const recordPrototype = Object.prototype;
const getPrototype = Object.getPrototypeOf;
const getDescriptors = Object.getOwnPropertyDescriptors;
const getDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const enumerableKeys = Object.keys;
const createRecord = Object.create;
const assignRecord = Object.assign;
const defineProperty = Object.defineProperty;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const mapHas = Function.prototype.call.bind(Map.prototype.has);
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
const toNumber = Number;
const isSafeInteger = Number.isSafeInteger;
const unsupported = Symbol('native-clone-required');
declare const captureProof: unique symbol;
type CapturedData = object & { readonly [captureProof]: true };

export function isCapturedImmutableData(value: unknown): value is CapturedData {
  return value !== null && typeof value === 'object' && hasCaptured(value);
}

/** Shape only. Elements may still contain undefined, non-finite numbers,
 * ownership fields, aliases or cycles and require their original validators. */
export function isCapturedDenseArray(value: unknown): boolean {
  return value !== null && typeof value === 'object' && hasDenseArray(value);
}

/** Construct a new captured dense array from an owned dense source, without
 * first creating a mutable array and a second descriptor snapshot. Unknown
 * sources return undefined without invoking the mapper. Results must already
 * be captured values or primitives; this never certifies an external object. */
export function mapCapturedDataArray<T, U>(source: readonly T[], mapper: (item: T, index: number) => U): U[] | undefined {
  if (!hasDenseArray(source)) return;
  if (typeof mapper !== 'function') throw new TypeError('A captured array mapper must be a function.');
  const result: U[] = [];
  setMappedPrototype(result, null);
  result.length = source.length;
  for (let index = 0; index < source.length; index++) {
    const value = mapper(source[index]!, index);
    const type = typeof value;
    if (type === 'function' || type === 'symbol' || value !== null && type === 'object' && !hasCaptured(value as object)) {
      throw new TypeError('A captured array mapper must return a captured value or primitive.');
    }
    result[index] = value;
  }
  setMappedPrototype(result, mappedArrayPrototype);
  freezeMapped(result);
  addCaptured(result);
  addDenseArray(result);
  return result;
}

export function captureImmutableData<T>(value: T): T {
  const seen = new DataMap<object, any>();
  function copy(input: any): any {
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'function' || typeof input === 'symbol') throw unsupported;
      return input;
    }
    if (hasCaptured(input)) return input;
    if (mapHas(seen, input)) return mapGet(seen, input);
    const prototype = getPrototype(input);
    if (isArray(input) ? prototype !== mappedArrayPrototype : prototype !== recordPrototype && prototype !== null) throw unsupported;
    const descriptors = getDescriptors(input);
    const keys = ownKeys(descriptors);
    for (let index = 0; index < keys.length; index++) {
      if (typeof keys[index] === 'symbol') throw unsupported;
    }
    // Data records have no inherited fields. A shared captured record must
    // remain safe at boundaries that previously normalized to null-prototype
    // snapshots before reading optional schema fields.
    const result: any = isArray(input) ? new DataArray(input.length) : createRecord(null);
    mapSet(seen, input, result);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index] as string;
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) continue;
      if (!hasOwn(descriptor, 'value')) throw unsupported;
      defineProperty(result, key, { value: copy(descriptor.value), enumerable: true, configurable: true, writable: true });
    }
    freezeMapped(result);
    addCaptured(result);
    if (isArray(result)) {
      const keys = enumerableKeys(result);
      let dense = keys.length === result.length;
      for (let index = 0; dense && index < keys.length; index++) {
        if (keys[index] !== `${index}`) dense = false;
      }
      if (dense) addDenseArray(result);
    }
    return result;
  }
  try { return copy(value); }
  catch (error) {
    if (error !== unsupported) throw error;
    // Preserve the previous native clone behavior for non-data builtins and
    // accessors. Freezing a Map does not freeze its entries: never certify it.
    const cloned = structuredClone(value);
    const visited = new WeakSet<object>();
    function freeze(input: any): void {
      if (input === null || typeof input !== 'object' || visited.has(input)) return;
      visited.add(input);
      Object.values(input).forEach(freeze);
      freezeMapped(input);
    }
    freeze(cloned);
    return cloned;
  }
}

/** Replace one existing own data field in a captured container. The caller
 * receives a fresh frozen container, never a proof for an external object. */
export function replaceCapturedDataProperty<T extends object>(base: T, key: string, value: unknown): T | undefined {
  if (typeof key !== 'string' || !hasCaptured(base)) return;
  const property = getDescriptor(base, key);
  if (!property?.enumerable || !hasOwn(property, 'value')) return;
  const next = captureImmutableData(value);
  if (next !== null && (typeof next === 'object' ? !isCapturedImmutableData(next) : typeof next === 'function' || typeof next === 'symbol')) return;
  let result: any;
  if (isArray(base)) {
    const dense = hasDenseArray(base);
    const index = toNumber(key);
    if (!isSafeInteger(index) || index < 0 || index >= base.length || `${index}` !== key
      || !dense && enumerableKeys(base).length !== base.length) return;
    result = new DataArray(base.length);
    // This unpublished array has no inherited numeric setters. Ordinary
    // writes create own data fields without invoking species or iterators.
    setMappedPrototype(result, null);
    for (let index = 0; index < base.length; index++) {
      if (!dense && !hasOwn(base, index)) return;
      result[index] = base[index];
    }
    setMappedPrototype(result, mappedArrayPrototype);
  } else result = assignRecord(createRecord(null), base);
  defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
  freezeMapped(result); addCaptured(result);
  // The array branch copied every existing own index into a fresh array and
  // rejected all holes/extra keys before publishing the result.
  if (isArray(result)) addDenseArray(result);
  return result;
}


