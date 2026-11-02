// src/index.ts
var captured = /* @__PURE__ */ new WeakSet();
var denseArrays = /* @__PURE__ */ new WeakSet();
var hasCaptured = captured.has.bind(captured);
var addCaptured = captured.add.bind(captured);
var hasDenseArray = denseArrays.has.bind(denseArrays);
var addDenseArray = denseArrays.add.bind(denseArrays);
var freezeMapped = Object.freeze;
var setMappedPrototype = Object.setPrototypeOf;
var mappedArrayPrototype = Array.prototype;
var DataArray = Array;
var DataMap = Map;
var isArray = Array.isArray;
var recordPrototype = Object.prototype;
var getPrototype = Object.getPrototypeOf;
var getDescriptors = Object.getOwnPropertyDescriptors;
var getDescriptor = Object.getOwnPropertyDescriptor;
var ownKeys = Reflect.ownKeys;
var enumerableKeys = Object.keys;
var createRecord = Object.create;
var assignRecord = Object.assign;
var defineProperty = Object.defineProperty;
var hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
var mapHas = Function.prototype.call.bind(Map.prototype.has);
var mapGet = Function.prototype.call.bind(Map.prototype.get);
var mapSet = Function.prototype.call.bind(Map.prototype.set);
var toNumber = Number;
var isSafeInteger = Number.isSafeInteger;
var unsupported = /* @__PURE__ */ Symbol("native-clone-required");
function isCapturedImmutableData(value) {
  return value !== null && typeof value === "object" && hasCaptured(value);
}
function isCapturedDenseArray(value) {
  return value !== null && typeof value === "object" && hasDenseArray(value);
}
function mapCapturedDataArray(source, mapper) {
  if (!hasDenseArray(source)) return;
  if (typeof mapper !== "function") throw new TypeError("A captured array mapper must be a function.");
  const result = [];
  setMappedPrototype(result, null);
  result.length = source.length;
  for (let index = 0; index < source.length; index++) {
    const value = mapper(source[index], index);
    const type = typeof value;
    if (type === "function" || type === "symbol" || value !== null && type === "object" && !hasCaptured(value)) {
      throw new TypeError("A captured array mapper must return a captured value or primitive.");
    }
    result[index] = value;
  }
  setMappedPrototype(result, mappedArrayPrototype);
  freezeMapped(result);
  addCaptured(result);
  addDenseArray(result);
  return result;
}
function captureImmutableData(value) {
  const seen = new DataMap();
  function copy(input) {
    if (input === null || typeof input !== "object") {
      if (typeof input === "function" || typeof input === "symbol") throw unsupported;
      return input;
    }
    if (hasCaptured(input)) return input;
    if (mapHas(seen, input)) return mapGet(seen, input);
    const prototype = getPrototype(input);
    if (isArray(input) ? prototype !== mappedArrayPrototype : prototype !== recordPrototype && prototype !== null) throw unsupported;
    const descriptors = getDescriptors(input);
    const keys = ownKeys(descriptors);
    for (let index = 0; index < keys.length; index++) {
      if (typeof keys[index] === "symbol") throw unsupported;
    }
    const result = isArray(input) ? new DataArray(input.length) : createRecord(null);
    mapSet(seen, input, result);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) continue;
      if (!hasOwn(descriptor, "value")) throw unsupported;
      defineProperty(result, key, { value: copy(descriptor.value), enumerable: true, configurable: true, writable: true });
    }
    freezeMapped(result);
    addCaptured(result);
    if (isArray(result)) {
      const keys2 = enumerableKeys(result);
      let dense = keys2.length === result.length;
      for (let index = 0; dense && index < keys2.length; index++) {
        if (keys2[index] !== `${index}`) dense = false;
      }
      if (dense) addDenseArray(result);
    }
    return result;
  }
  try {
    return copy(value);
  } catch (error) {
    let freeze = function(input) {
      if (input === null || typeof input !== "object" || visited.has(input)) return;
      visited.add(input);
      Object.values(input).forEach(freeze);
      freezeMapped(input);
    };
    if (error !== unsupported) throw error;
    const cloned = structuredClone(value);
    const visited = /* @__PURE__ */ new WeakSet();
    freeze(cloned);
    return cloned;
  }
}
function replaceCapturedDataProperty(base, key, value) {
  if (typeof key !== "string" || !hasCaptured(base)) return;
  const property = getDescriptor(base, key);
  if (!property?.enumerable || !hasOwn(property, "value")) return;
  const next = captureImmutableData(value);
  if (next !== null && (typeof next === "object" ? !isCapturedImmutableData(next) : typeof next === "function" || typeof next === "symbol")) return;
  let result;
  if (isArray(base)) {
    const dense = hasDenseArray(base);
    const index = toNumber(key);
    if (!isSafeInteger(index) || index < 0 || index >= base.length || `${index}` !== key || !dense && enumerableKeys(base).length !== base.length) return;
    result = new DataArray(base.length);
    setMappedPrototype(result, null);
    for (let index2 = 0; index2 < base.length; index2++) {
      if (!dense && !hasOwn(base, index2)) return;
      result[index2] = base[index2];
    }
    setMappedPrototype(result, mappedArrayPrototype);
  } else result = assignRecord(createRecord(null), base);
  defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
  freezeMapped(result);
  addCaptured(result);
  if (isArray(result)) addDenseArray(result);
  return result;
}
export {
  captureImmutableData,
  isCapturedDenseArray,
  isCapturedImmutableData,
  mapCapturedDataArray,
  replaceCapturedDataProperty
};
//# sourceMappingURL=index.js.map