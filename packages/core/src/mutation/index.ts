import { deleteAtPath, parsePath, resolvePath, setPathValue, XnlPath, XnlPathError, PathItem } from "../path";
import { DataElementNode, ExtendBody, TextElementNode, XnlNode, isWord, wordToString } from "../types";
import { capturedLiteralContextVersion, cloneWithValueContext, isLiteralObject, markLiteralObject, markLiteralTree } from "../value-context";
import { captureImmutableData, isCapturedImmutableData } from '../immutable-data';
import { isCapturedDenseArray, replaceCapturedDataProperty } from 'immutable-data-core';
import { clonedStructureFacts, frozenStructureFacts, immutableLiteralProfile, rememberClonedStructure, structureFactPrototypesSafe } from './immutableFacts';

export type MutationType =
  | "TREE_ADD"
  | "TREE_DELETE"
  | "TREE_MOVE"
  | "TREE_UPDATE"
  | "TREE_MOVE_SAME_LEVEL"
  | "TREE_MOVE_CROSS_LEVEL"
  | "OBJECT_ADD"
  | "OBJECT_DELETE"
  | "OBJECT_UPDATE";

export interface XnlMutation {
  type: MutationType;
  path: string | XnlPath;
  pathBefore?: string | XnlPath;
  valueBefore?: XnlNode;
  valueAfter?: XnlNode;
  metadata?: Record<string, unknown>;
  destinationKey?: string;
  targetUniqueName?: string;
  parentUniqueNameBefore?: string;
  parentUniqueNameAfter?: string;
}

export type MetadataIdMode = "identity" | "metadata";

export interface XnlMutationOptions {
  metadataIdMode?: MetadataIdMode;
  /** Explicit data roots for constructed or transported ASTs. Paths resolve against each complete tree. */
  literalValuePaths?: readonly (string | XnlPath)[];
  /** Schema-declared literal attributes. Unlike instance paths these rules also
   * cover newly inserted nodes after transport, without enumerating every ID. */
  literalAttributeRules?: readonly {
    readonly tags: readonly string[];
    readonly attributes: readonly string[];
  }[];
}

export type XnlMutationBatch = readonly XnlMutation[];

export type XnlMutationIdentityPolicy = "allow-missing" | "require-elements";

export type XnlMutationDiagnosticCode =
  | "DUPLICATE_IDENTITY"
  | "MISSING_IDENTITY"
  | "IDENTITY_MUTATION_FORBIDDEN"
  | "PRECONDITION_FAILED"
  | "APPLY_FAILED"
  | "RESULT_IDENTITY_INVALID"
  | "RESULT_STRUCTURE_INVALID";

export interface XnlMutationDiagnostic {
  readonly code: XnlMutationDiagnosticCode;
  readonly message: string;
  /** Zero-based position in the ordered input batch, when tied to a mutation. */
  readonly mutationIndex?: number;
  /** Target path associated with the rejection, when one can be resolved. */
  readonly path?: XnlMutation["path"];
  /** Effective element identity associated with the rejection, when known. */
  readonly identity?: string;
}

export interface XnlMutationBatchOptions extends XnlMutationOptions {
  /** For delete, update, and move, compare an available valueBefore before applying. */
  readonly verifyValueBefore?: boolean;
  /** Defaults to allow-missing; require-elements rejects elements without identity. */
  readonly identityPolicy?: XnlMutationIdentityPolicy;
}

export type XnlMutationBatchResult =
  | {
      readonly status: "applied";
      /** The fully applied isolated clone. */
      readonly value: XnlNode;
      readonly mutations: XnlMutationBatch;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: "rejected";
      /** An isolated clone of the unchanged base, never a partially applied value. */
      readonly value: XnlNode;
      readonly mutations: XnlMutationBatch;
      readonly diagnostics: readonly XnlMutationDiagnostic[];
    };

export type XnlDryRunMutations = (
  base: XnlNode,
  mutations: XnlMutationBatch,
  options?: XnlMutationBatchOptions
) => XnlMutationBatchResult;

function resolveMetaIdMode(opts: XnlMutationOptions): MetadataIdMode {
  return opts.metadataIdMode ?? "identity";
}

function isMetadataIdPath(path: XnlPath): boolean {
  const n = path.length;
  return (
    n >= 2 &&
    path[n - 2]?.type === "InstanceProperty" &&
    path[n - 2]?.value === "metadata" &&
    path[n - 1]?.type === "MapKey" &&
    path[n - 1]?.value === "id"
  );
}

function isMetadataMapPath(path: XnlPath): boolean {
  const last = path[path.length - 1];
  return last?.type === "InstanceProperty" && last.value === "metadata";
}

function cloneValue<T>(value: T): T {
  return cloneWithValueContext(value);
}

function someDeclaredLiteralAttribute(node: DataElementNode | TextElementNode, options: XnlMutationOptions, predicate: (value: unknown) => boolean): boolean {
  const profile = immutableLiteralProfile(options);
  if (profile) {
    for (let index = 0; index < profile.rules.length; index++) {
      const rule = profile.rules[index]!;
      let matched = false;
      for (let tag = 0; tag < rule.tags.length; tag++) if (rule.tags[tag] === node.tag) matched = true;
      if (!matched) continue;
      for (let attribute = 0; attribute < rule.attributes.length; attribute++) if (predicate(node.attributes?.[rule.attributes[attribute]!])) return true;
    }
    return false;
  }
  for (const rule of options.literalAttributeRules ?? []) {
    if (!rule.tags.includes(node.tag)) continue;
    for (const key of rule.attributes) if (predicate(node.attributes?.[key])) return true;
  }
  return false;
}

function bindLiteralPaths(root: XnlNode, options: XnlMutationOptions): void {
  const profile = immutableLiteralProfile(options);
  if (profile ? profile.rules.length : options.literalAttributeRules?.length) {
    const visited = new WeakSet<object>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object' || visited.has(value) || isLiteralObject(value)) return;
      visited.add(value);
      if (isDataElement(value) || isTextElement(value)) {
        someDeclaredLiteralAttribute(value, options, literal => { if (literal !== undefined) markLiteralTree(literal); return false; });
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(root);
  }
  for (const path of profile ? [] : options.literalValuePaths ?? []) {
    const value = resolvePath(root, path, { strict: false });
    if (value !== undefined) markLiteralTree(value);
  }
}

/** Whether this invocation needs isolated literal marks. Do not mark shared
 * input trees or persist schema-specific interpretation across calls. */
function needsLiteralBinding(root: XnlNode, options: XnlMutationOptions): boolean {
  const profile = immutableLiteralProfile(options);
  let canUseFacts = !!profile && structureFactPrototypesSafe(profile);
  for (const path of profile ? [] : options.literalValuePaths ?? []) {
    const value = resolvePath(root, path, { strict: false });
    if (value !== null && typeof value === 'object') return true;
  }
  if (!(profile ? profile.rules.length : options.literalAttributeRules?.length)) return false;
  // Seed the new captured ancestors here, before strict apply. Unchanged
  // children can reuse the same conservative, rule-specific absence facts.
  if (profile && canUseFacts && isCapturedImmutableData(root)
    && frozenStructureFacts(root, profile)?.binding === false) return false;
  canUseFacts = !!profile && structureFactPrototypesSafe(profile);
  const visited = new WeakSet<object>();
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object' || visited.has(value) || isLiteralObject(value)) return false;
    if (canUseFacts && profile && clonedStructureFacts(value, profile)?.binding === false) return false;
    visited.add(value);
    if (isDataElement(value) || isTextElement(value)) {
      if (someDeclaredLiteralAttribute(value, options, attribute => attribute !== null && typeof attribute === 'object')) return true;
    }
    const values = Object.values(value);
    // Unknown input may execute getters/Proxy traps. Refresh after those reads,
    // before skipping any proven frozen child. Proven closures invoke no code.
    canUseFacts = !!profile && structureFactPrototypesSafe(profile);
    for (let index = 0; index < values.length; index++) if (visit(values[index])) return true;
    return false;
  };
  return visit(root);
}

/** Queries the original diff's isolated literal-binding requirement without
 * marking or applying. False is not an identity/schema validity proof. Raw
 * getters and Proxy traps can execute during the original underlying reads. */
export function needsXnlLiteralBinding(root: XnlNode, options: XnlMutationOptions = {}): boolean {
  return needsLiteralBinding(root, options);
}

interface ImmutableScalarInspection {
  target: object;
  key: string;
  actual: unknown;
  stack: string[];
  targetSeen: boolean;
  aliased: boolean;
  address?: readonly string[];
}
const capturedObjectPrototype = Object.getPrototypeOf;
const objectChildKeys = new WeakMap<object, readonly string[]>();
const readObjectChildKeys = objectChildKeys.get.bind(objectChildKeys);
const writeObjectChildKeys = objectChildKeys.set.bind(objectChildKeys);
const childKeysPrototype = Object.setPrototypeOf;
const childKeysFreeze = Object.freeze;

// Representation only. All object edges, including every array and backedge,
// still enter the original identity/alias/cycle validation on every operation.
function capturedObjectChildKeys(value: object): readonly string[] | undefined {
  if (!isCapturedImmutableData(value) || capturedObjectPrototype(value) !== null) return;
  const previous = readObjectChildKeys(value);
  if (previous !== undefined) return previous;
  const keys: string[] = childKeysPrototype([], null);
  for (const key in value) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object') keys[keys.length] = key;
  }
  const snapshot = childKeysFreeze(keys);
  writeObjectChildKeys(value, snapshot);
  return snapshot;
}

function validateIdentities(
  root: XnlNode,
  policy: XnlMutationIdentityPolicy,
  inspection?: ImmutableScalarInspection,
): XnlMutationDiagnostic[] {
  const diagnostics: XnlMutationDiagnostic[] = [];
  const identities = new Set<string>();
  // The immutable scalar probe needs only its short active path, not a Set
  // allocation for every shallow enter/leave. Promote once for deep graphs;
  // unknown/default input keeps the original Set from the start.
  let ancestors = inspection ? undefined : new Set<object>();
  const active: object[] | undefined = inspection ? Object.setPrototypeOf([], null) : undefined;

  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== "object") return;

    const objectValue = value as object;
    if (inspection && objectValue === inspection.target) {
      if (inspection.targetSeen) inspection.aliased = true;
      inspection.targetSeen = true;
      inspection.address = [...inspection.stack.slice(0, depth), inspection.key];
    }
    if (!ancestors) {
      for (let index = 0; index < depth; index++) {
        if (active![index] === objectValue) {
          inspection!.aliased = true;
          return;
        }
      }
      if (depth < 32) active![depth] = objectValue;
      else {
        ancestors = new Set<object>();
        for (let index = 0; index < depth; index++) ancestors.add(active![index]!);
        ancestors.add(objectValue);
      }
    } else {
      if (ancestors.has(objectValue)) {
        if (inspection) inspection.aliased = true;
        return;
      }
      ancestors.add(objectValue);
    }

    if (isDataElement(value) || isTextElement(value)) {
      const identity = readIdOrMetadaataId(value);
      if (identity) {
        if (identities.has(identity)) {
          diagnostics.push({
            code: "DUPLICATE_IDENTITY",
            message: `Effective identity '${identity}' appears more than once`,
            identity,
          });
        } else {
          identities.add(identity);
        }
      } else if (policy === "require-elements") {
        diagnostics.push({
          code: "MISSING_IDENTITY",
          message: `${value.kind} '${value.tag}' is missing an effective identity`,
        });
      }
    }

    if (inspection && capturedObjectPrototype(value) === null) {
      const keys = capturedObjectChildKeys(value);
      if (keys !== undefined) {
        for (let index = 0; index < keys.length; index++) {
          const key = keys[index]!;
          if (depth < inspection.stack.length) inspection.stack[depth] = key;
          else Object.defineProperty(inspection.stack, depth, { value: key, enumerable: true, configurable: true, writable: true });
          visit((value as Record<string, unknown>)[key], depth + 1);
        }
      } else {
        for (const key in value) {
          if (depth < inspection.stack.length) inspection.stack[depth] = key;
          else Object.defineProperty(inspection.stack, depth, { value: key, enumerable: true, configurable: true, writable: true });
          visit((value as Record<string, unknown>)[key], depth + 1);
        }
      }
    } else if (inspection && isCapturedDenseArray(value)) {
      const array = value as readonly unknown[];
      for (let index = 0; index < array.length; index++) {
        const key = `${index}`;
        if (depth < inspection.stack.length) inspection.stack[depth] = key;
        else Object.defineProperty(inspection.stack, depth, { value: key, enumerable: true, configurable: true, writable: true });
        visit(array[index], depth + 1);
      }
    } else {
      for (const key of Object.keys(value)) {
        if (inspection) {
          if (depth < inspection.stack.length) inspection.stack[depth] = key;
          else Object.defineProperty(inspection.stack, depth, { value: key, enumerable: true, configurable: true, writable: true });
        }
        visit((value as Record<string, unknown>)[key], depth + 1);
      }
    }
    ancestors?.delete(objectValue);
  };

  visit(root, 0);
  return diagnostics;
}

type IdentityAuthority = "explicit-id" | "metadata-fallback";

interface IdentityDescriptor {
  readonly authority: IdentityAuthority;
  readonly value: string;
}

interface IdentitySkeletonEntry {
  readonly path: string;
  readonly descriptor: IdentityDescriptor;
}

function readIdentityDescriptor(node: unknown): IdentityDescriptor | undefined {
  if (!isDataElement(node) && !isTextElement(node)) return undefined;

  const explicitId = wordToString((node as DataElementNode | TextElementNode).id);
  if (explicitId) return { authority: "explicit-id", value: explicitId };

  const metaId = (node as DataElementNode | TextElementNode).metadata?.id;
  const fallback = typeof metaId === "string" ? metaId : isWord(metaId) ? wordToString(metaId) : undefined;
  return fallback ? { authority: "metadata-fallback", value: fallback } : undefined;
}

function collectIdentitySkeleton(root: XnlNode): IdentitySkeletonEntry[] {
  const entries: IdentitySkeletonEntry[] = [];
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;

    const objectValue = value as object;
    if (ancestors.has(objectValue)) return;
    ancestors.add(objectValue);

    const descriptor = readIdentityDescriptor(value);
    if (descriptor) {
      entries.push({ path, descriptor });
    }

    if (isDataElement(value) || isTextElement(value)) {
      visitPlainMap(value.metadata, `${path}:metadata`);
      if (value.attributes !== undefined) visitPlainMap(value.attributes, `${path}:attributes`);
      if (isDataElement(value)) {
        if (value.body !== undefined) visitArray(value.body, `${path}:body`);
        if (value.extend !== undefined) visitExtend(value.extend, `${path}:extend`);
      }
    } else if (Array.isArray(value)) {
      visitArray(value, path);
    } else if (isPlainObject(value)) {
      visitPlainMap(value, path);
    }

    ancestors.delete(objectValue);
  };

  const visitArray = (values: readonly unknown[], path: string): void => {
    values.forEach((item, index) => visit(item, `${path}[${index}]`));
  };

  const visitPlainMap = (map: Record<string, unknown>, path: string): void => {
    for (const key of Object.keys(map).sort()) {
      visit(map[key], `${path}{${key}}`);
    }
  };

  const visitExtend = (extend: ExtendBody, path: string): void => {
    extend.order.forEach((tag, index) => {
      visit(extend.children[tag], `${path}[${index}:${tag}]`);
    });
  };

  visit(root, "$");
  return entries;
}

function identitySkeletonsEqual(
  before: readonly IdentitySkeletonEntry[],
  after: readonly IdentitySkeletonEntry[]
): boolean {
  return (
    before.length === after.length &&
    before.every((entry, index) => {
      const other = after[index];
      return (
        other !== undefined &&
        entry.path === other.path &&
        entry.descriptor.authority === other.descriptor.authority &&
        entry.descriptor.value === other.descriptor.value
      );
    })
  );
}

// Scalar fields can change neither element recognition nor the identity Word
// or ordered containers. Array length is structural even when addressed as a
// named property rather than an index.
const identityStructureKeys = new Set(['kind', 'tag', 'id', 'metadata', 'body', 'extend', 'order', 'children', 'namespace', 'name', 'length', '__proto__', 'constructor', 'prototype']);
const scalarMutationValue = (value: unknown) => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number';
function isIdentityNeutralScalarUpdate(root: XnlNode, mutation: XnlMutation, path: XnlPath, options: XnlMutationOptions): boolean {
  if (!isUpdateMutation(mutation)) return false;
  // Explicit paths may use metadata selectors whose matches change after a
  // scalar metadata edit. Rebinding can then change an object's interpretation.
  const profile = immutableLiteralProfile(options);
  if (!profile || !structureFactPrototypesSafe(profile)) return false;
  const last = path[path.length - 1];
  if (!last || (last.type !== 'MapKey' && last.type !== 'InstanceProperty') || identityStructureKeys.has(last.value)) return false;
  const parent = path.length === 1 ? root : resolvePath(root, path.slice(0, -1), { strict: false, metadataIdMode: 'identity' });
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) return false;
  return scalarMutationValue(mutation.valueAfter) && scalarMutationValue(resolveObservableTarget(root, mutation, path));
}

function isUpdateMutation(mutation: XnlMutation): boolean {
  return (
    mutation.type === "TREE_UPDATE" ||
    mutation.type === "OBJECT_UPDATE"
  );
}

function resolveEffectiveMetadataIdTarget(
  root: XnlNode,
  path: XnlPath
): DataElementNode | TextElementNode | undefined {
  if (!isMetadataIdPath(path)) return undefined;
  const elementPath = path.slice(0, -2);
  const candidate =
    elementPath.length === 0
      ? root
      : resolvePath(root, elementPath, { strict: false, metadataIdMode: "identity" });
  if (!isDataElement(candidate) && !isTextElement(candidate)) return undefined;
  return wordToString(candidate.id) ? undefined : candidate;
}

function containsIdentifiedElement(value: unknown): boolean {
  const ancestors = new WeakSet<object>();

  const visit = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate !== "object") return false;

    const objectValue = candidate as object;
    if (ancestors.has(objectValue)) return false;
    ancestors.add(objectValue);

    if (readIdentityDescriptor(candidate)) {
      ancestors.delete(objectValue);
      return true;
    }

    if (isDataElement(candidate) || isTextElement(candidate)) {
      if (visit(candidate.metadata) || visit(candidate.attributes)) {
        ancestors.delete(objectValue);
        return true;
      }
      if (isDataElement(candidate) && (visit(candidate.body) || visit(candidate.extend))) {
        ancestors.delete(objectValue);
        return true;
      }
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (visit(item)) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    } else if (isExtendBody(candidate)) {
      for (const tag of candidate.order) {
        if (visit(candidate.children[tag])) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    } else if (isPlainObject(candidate)) {
      for (const key of Object.keys(candidate)) {
        if (visit(candidate[key])) {
          ancestors.delete(objectValue);
          return true;
        }
      }
    }

    ancestors.delete(objectValue);
    return false;
  };

  return visit(value);
}

function resolveMoveSource(root: XnlNode, mutation: XnlMutation): unknown {
  if (!isMoveMutation(mutation)) return undefined;
  if (mutation.targetUniqueName) {
    return resolvePath(root, [{ type: "UniqueName", value: mutation.targetUniqueName }], {
      strict: false,
      metadataIdMode: "identity",
    });
  }
  if (mutation.pathBefore) {
    return resolvePath(root, mutation.pathBefore, { strict: false, metadataIdMode: "identity" });
  }
  return undefined;
}

function tagOf(value: unknown): string | undefined {
  return isDataElement(value) || isTextElement(value) ? value.tag : undefined;
}

function resolveOccupiedDestination(
  root: XnlNode,
  mutation: XnlMutation,
  path: XnlPath,
  valueAfter: unknown
): unknown {
  const last = path[path.length - 1];
  if (!last) return undefined;
  const parent = resolvePath(root, path.slice(0, -1), { strict: false, metadataIdMode: "identity" });
  if (parent === undefined) return undefined;

  if (last.type === "ListIndex") {
    if (isExtendBody(parent)) {
      const key = mutation.destinationKey ?? tagOf(valueAfter);
      return key ? parent.children[key] : undefined;
    }
    return undefined;
  }

  if (last.type === "MapKey") {
    return isExtendBody(parent) ? parent.children[mutation.destinationKey ?? last.value] : parent[last.value];
  }

  if (last.type === "InstanceProperty") {
    return parent[last.value];
  }

  return undefined;
}

function validateStructuralDestination(
  root: XnlNode,
  mutation: XnlMutation,
  path: XnlPath,
  mutationIndex: number,
  originalPath: XnlMutation["path"]
): XnlMutationDiagnostic | undefined {
  if (
    mutation.type !== "TREE_ADD" &&
    mutation.type !== "OBJECT_ADD" &&
    !isMoveMutation(mutation)
  ) {
    return undefined;
  }

  const valueAfter = isMoveMutation(mutation) ? resolveMoveSource(root, mutation) : mutation.valueAfter;
  const occupied = resolveOccupiedDestination(root, mutation, path, valueAfter);
  if (occupied === undefined || occupied === valueAfter || !containsIdentifiedElement(occupied)) {
    return undefined;
  }

  return {
    code: "IDENTITY_MUTATION_FORBIDDEN",
    message: "Strict structural mutations cannot overwrite an occupied identified destination",
    mutationIndex,
    path: originalPath,
    identity: readIdOrMetadaataId(occupied),
  };
}

function validateExtendCoherence(root: XnlNode): XnlMutationDiagnostic[] {
  const diagnostics: XnlMutationDiagnostic[] = [];
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;

    const objectValue = value as object;
    if (ancestors.has(objectValue)) return;
    ancestors.add(objectValue);

    if (isExtendBody(value)) {
      const orderSet = new Set(value.order);
      const childKeys = Object.keys(value.children);
      if (orderSet.size !== value.order.length || orderSet.size !== childKeys.length) {
        diagnostics.push({
          code: "RESULT_STRUCTURE_INVALID",
          message: "Extend order and child keys must be unique and coherent",
        });
      }
      for (const key of childKeys) {
        const child = value.children[key];
        if (!orderSet.has(key) || !child || child.tag !== key) {
          diagnostics.push({
            code: "RESULT_STRUCTURE_INVALID",
            message: `Extend child '${key}' is not coherent with order/key/tag storage`,
            identity: readIdOrMetadaataId(child),
          });
        }
      }
      for (const tag of value.order) {
        visit(value.children[tag]);
      }
    } else if (isDataElement(value) || isTextElement(value)) {
      visit(value.metadata);
      visit(value.attributes);
      if (isDataElement(value)) {
        visit(value.body);
        visit(value.extend);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isPlainObject(value)) {
      for (const key of Object.keys(value)) visit(value[key]);
    }

    ancestors.delete(objectValue);
  };

  visit(root);
  return diagnostics;
}

function isAddUpdateOrDelete(mutation: XnlMutation): boolean {
  return (
    mutation.type === "TREE_ADD" ||
    mutation.type === "TREE_DELETE" ||
    mutation.type === "TREE_UPDATE" ||
    mutation.type === "OBJECT_ADD" ||
    mutation.type === "OBJECT_DELETE" ||
    mutation.type === "OBJECT_UPDATE"
  );
}

function resolveDirectElementIdTarget(
  root: XnlNode,
  mutation: XnlMutation,
  path: XnlPath
): DataElementNode | TextElementNode | undefined {
  if (!isAddUpdateOrDelete(mutation)) return undefined;

  const last = path[path.length - 1];
  if (last?.type !== "InstanceProperty" || last.value !== "id") return undefined;

  const parentPath = path.slice(0, -1);
  const parent =
    parentPath.length === 0
      ? root
      : resolvePath(root, parentPath, { strict: false, metadataIdMode: "identity" });
  return isDataElement(parent) || isTextElement(parent) ? parent : undefined;
}

function isMoveMutation(mutation: XnlMutation): boolean {
  return (
    mutation.type === "TREE_MOVE" ||
    mutation.type === "TREE_MOVE_SAME_LEVEL" ||
    mutation.type === "TREE_MOVE_CROSS_LEVEL"
  );
}

function supportsValueBefore(mutation: XnlMutation): boolean {
  return (
    isMoveMutation(mutation) ||
    mutation.type === "TREE_DELETE" ||
    mutation.type === "TREE_UPDATE" ||
    mutation.type === "OBJECT_DELETE" ||
    mutation.type === "OBJECT_UPDATE"
  );
}

function resolveObservableTarget(root: XnlNode, mutation: XnlMutation, path: XnlPath): unknown {
  if (isMoveMutation(mutation)) {
    if (mutation.targetUniqueName) {
      const target = resolvePath(
        root,
        [{ type: "UniqueName", value: mutation.targetUniqueName }],
        { strict: false, metadataIdMode: "identity" }
      );
      if (target !== undefined) return target;
    }
    if (mutation.pathBefore) {
      return resolvePath(root, mutation.pathBefore, { strict: false, metadataIdMode: "identity" });
    }
    return undefined;
  }

  return resolvePath(root, path, { strict: false, metadataIdMode: "identity" });
}

function isStructurallyEqual(
  left: unknown,
  right: unknown,
  seen: WeakMap<object, WeakSet<object>> = new WeakMap()
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  let rightValues = seen.get(left);
  if (rightValues?.has(right)) return true;
  if (!rightValues) {
    rightValues = new WeakSet<object>();
    seen.set(left, rightValues);
  }
  rightValues.add(right);

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isStructurallyEqual(value, right[index], seen));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      isStructurallyEqual(leftRecord[key], rightRecord[key], seen)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const dryRunMutations: XnlDryRunMutations = (base, mutations, options = {}) => runStrictMutations(base, mutations, options, false);

const scalarUpdateRelations = new WeakMap<object, WeakMap<object, {
  readonly path: readonly string[]; readonly contextVersion: bigint;
}>>();

/** A structural derivation only: this exact captured result was constructed
 * from this exact base by one scalar path-copy. It grants no admission, schema
 * or identity proof, and never skips strict validation of a new operation. */
export function immutableScalarUpdatePath(base: XnlNode, candidate: XnlNode): readonly string[] | undefined {
  if (!isCapturedImmutableData(base) || !isCapturedImmutableData(candidate) || !structureFactPrototypesSafe()) return;
  const relation = scalarUpdateRelations.get(base)?.get(candidate);
  return relation?.contextVersion === capturedLiteralContextVersion() ? relation.path : undefined;
}

export type XnlImmutableMutationBatchResult = XnlMutationBatchResult & {
  readonly representation: 'captured-data' | 'isolated-native';
};
/** Explicit immutable data result: unchanged frozen subtrees may be shared.
 * Non-data builtins retain the original mutable isolation contract, explicitly
 * reported as isolated-native. They never receive the captured-data proof.
 * The default dryRunMutations contract remains a fully isolated clone. */
export const dryRunImmutableMutations = (base: XnlNode, mutations: XnlMutationBatch, options: XnlMutationBatchOptions = {}): XnlImmutableMutationBatchResult => {
  const result = runStrictMutations(base, mutations, options, true);
  const value = captureXnlResult(result.value), captured = isCapturedImmutableData(value);
  return { ...result, value: captured ? value : result.value, representation: captured ? 'captured-data' : 'isolated-native' };
};

function captureXnlResult(value: XnlNode): XnlNode {
  if (isCapturedImmutableData(value)) return value;
  const result = captureImmutableData(value), seen = new WeakSet<object>();
  const transfer = (source: unknown, target: unknown): void => {
    if (!source || typeof source !== 'object' || !target || typeof target !== 'object' || seen.has(source)) return;
    seen.add(source);
    if (isLiteralObject(source)) markLiteralObject(target);
    for (const key of Object.keys(source)) transfer((source as any)[key], (target as any)[key]);
  };
  transfer(value, result); return result;
}

// This probe grants no identity/alias proof. The original complete base
// identity traversal below must still succeed and collect a unique address.
function immutableScalarTarget(base: XnlNode, mutations: XnlMutationBatch): ImmutableScalarInspection | undefined {
  if (!isCapturedImmutableData(base) || !isCapturedImmutableData(mutations) || mutations.length !== 1) return;
  const mutation = mutations[0]!;
  if (mutation.type !== 'OBJECT_UPDATE') return;
  let path: XnlPath;
  try { path = Array.isArray(mutation.path) ? mutation.path : parsePath(mutation.path); }
  catch { return; }
  if (!path.every(item => item !== null && typeof item === 'object'
    && typeof Object.getOwnPropertyDescriptor(item, 'type')?.value === 'string'
    && typeof Object.getOwnPropertyDescriptor(item, 'value')?.value === 'string'
    && (['UniqueName', 'InstanceProperty', 'MapKey', 'ListIndex'].includes(item.type)
      // Identity selectors are the normal output of diffNodes. The original
      // resolver validates their complete syntax; other selectors stay cold.
      || item.type === 'MetadataSelector' && item.value.startsWith('<id=')))) return;
  const last = path[path.length - 1];
  if (!last || (last.type !== 'MapKey' && last.type !== 'InstanceProperty')
    || identityStructureKeys.has(last.value) || !scalarMutationValue(mutation.valueAfter)) return;
  const parent = resolvePath(base, path.slice(0, -1), { strict: false, metadataIdMode: 'identity' });
  // A captured null-prototype record with neither kind nor order cannot be
  // an AST node, Word or Extend body. Both supported final path operations
  // read/write its own field. Other parent shapes keep full path semantics.
  if (!isCapturedImmutableData(parent) || Array.isArray(parent) || Object.getPrototypeOf(parent) !== null
    || Object.prototype.hasOwnProperty.call(parent, 'kind') || Object.prototype.hasOwnProperty.call(parent, 'order')) return;
  const field = Object.getOwnPropertyDescriptor(parent, last.value);
  if (!field || !Object.prototype.hasOwnProperty.call(field, 'value') || !scalarMutationValue(field.value)) return;
  return { target: parent, key: last.value, actual: field.value, targetSeen: false, stack: [], aliased: false, address: undefined };
}
function copyImmutableScalar(base: XnlNode, address: readonly string[], after: XnlNode): XnlNode {
  const replace = (value: any, depth: number): any => {
    if (depth === address.length) return after;
    const key = address[depth]!;
    const result = replaceCapturedDataProperty(value, key, replace(value[key], depth + 1));
    if (!result) throw new Error('IMMUTABLE_CONTAINER_UNAVAILABLE');
    if (isLiteralObject(value)) markLiteralObject(result);
    return result;
  };
  return replace(base, 0);
}

const runStrictMutations = (
  base: XnlNode,
  mutations: XnlMutationBatch,
  options: XnlMutationBatchOptions = {},
  immutable: boolean,
): XnlMutationBatchResult => {
  const profile = immutableLiteralProfile(options);
  if (profile) options = profile.options;
  const immutableBase = profile && frozenStructureFacts(base, profile);
  let inspection: ImmutableScalarInspection | undefined;
  try {
    inspection = immutable && profile && immutableBase && !immutableBase.binding && !immutableBase.extend && structureFactPrototypesSafe(profile)
      ? immutableScalarTarget(base, mutations) : undefined;
  } catch { /* An uncertain probe must retain the original strict diagnostics. */ }
  const rejectedValue = inspection ? base : cloneValue(base);
  if (!inspection && profile && immutableBase) rememberClonedStructure(base, profile);
  if (!profile || !immutableBase || immutableBase.binding || !structureFactPrototypesSafe(profile)) bindLiteralPaths(rejectedValue, options);
  const reject = (
    diagnostics: readonly XnlMutationDiagnostic[]
  ): XnlMutationBatchResult => {
    // The working clone may already contain earlier edits. Isolate the
    // unchanged base only on rejection rather than copying it on every apply.
    const unchanged = cloneValue(base);
    bindLiteralPaths(unchanged, options);
    return { status: "rejected", value: unchanged, mutations, diagnostics };
  };

  let baseIdentityDiagnostics: XnlMutationDiagnostic[];
  try {
    baseIdentityDiagnostics = validateIdentities(
      rejectedValue,
      options.identityPolicy ?? "allow-missing",
      inspection,
    );
  } catch (error) {
    if (inspection) return runStrictMutations(base, mutations, options, false);
    return reject([
      {
        code: "APPLY_FAILED",
        message: `Base identity validation failed: ${errorMessage(error)}`,
      },
    ]);
  }
  if (inspection && (inspection.aliased || !inspection.address)) return runStrictMutations(base, mutations, options, false);
  if (baseIdentityDiagnostics.length > 0) {
    return reject(baseIdentityDiagnostics);
  }
  const address = inspection?.address;

  let current: XnlNode;
  let mutationCopies: XnlMutationBatch;
  let identityUnchanged = true;
  try {
    current = rejectedValue;
    mutationCopies = cloneValue(mutations);
  } catch (error) {
    return reject([
      {
        code: "APPLY_FAILED",
        message: `Failed to isolate mutation batch: ${errorMessage(error)}`,
      },
    ]);
  }

  for (let mutationIndex = 0; mutationIndex < mutationCopies.length; mutationIndex++) {
    const mutation = mutationCopies[mutationIndex];
    try {
      const path = Array.isArray(mutation.path) ? mutation.path : parsePath(mutation.path);
      const identityTarget = resolveDirectElementIdTarget(current, mutation, path);
      if (identityTarget) {
        return reject([
          {
            code: "IDENTITY_MUTATION_FORBIDDEN",
            message: "Strict mutation batches cannot add, update, or delete an element id field",
            mutationIndex,
            path: mutations[mutationIndex]?.path ?? mutation.path,
            identity: readIdOrMetadaataId(identityTarget),
          },
        ]);
      }
      const metadataFallbackTarget =
        resolveMetaIdMode(options) === "identity"
          ? resolveEffectiveMetadataIdTarget(current, path)
          : undefined;
      if (metadataFallbackTarget && isAddUpdateOrDelete(mutation)) {
        return reject([
          {
            code: "IDENTITY_MUTATION_FORBIDDEN",
            message: "Strict mutation batches cannot directly mutate an effective metadata fallback id",
            mutationIndex,
            path: mutations[mutationIndex]?.path ?? mutation.path,
            identity: readIdOrMetadaataId(metadataFallbackTarget),
          },
        ]);
      }

      if (
        options.verifyValueBefore &&
        supportsValueBefore(mutation) &&
        mutation.valueBefore !== undefined
      ) {
        const actual = address ? inspection!.actual : resolveObservableTarget(current, mutation, path);
        if (!isStructurallyEqual(actual, mutation.valueBefore)) {
          return reject([
            {
              code: "PRECONDITION_FAILED",
              message: `Mutation ${mutationIndex} valueBefore does not match its current target`,
              mutationIndex,
              path: mutations[mutationIndex]?.path ?? mutation.path,
              identity: mutation.targetUniqueName,
            },
          ]);
        }
      }

      const destinationDiagnostic = validateStructuralDestination(
        current,
        mutation,
        path,
        mutationIndex,
        mutations[mutationIndex]?.path ?? mutation.path
      );
      if (destinationDiagnostic) {
        return reject([destinationDiagnostic]);
      }

      const identityNeutral = !!address || isIdentityNeutralScalarUpdate(current, mutation, path, options);
      identityUnchanged &&= identityNeutral;
      const skeletonBefore = isUpdateMutation(mutation) && !identityNeutral
        ? collectIdentitySkeleton(current)
        : undefined;
      current = address ? copyImmutableScalar(current, address, mutation.valueAfter as XnlNode) : applySingle(current, mutation, options);
      // A primitive replacement outside AST/identity/container fields cannot
      // introduce an object needing literal interpretation. Other operations
      // keep the complete original rebinding and identity checks.
      if (!identityNeutral) bindLiteralPaths(current, options);
      if (skeletonBefore) {
        const skeletonAfter = collectIdentitySkeleton(current);
        if (!identitySkeletonsEqual(skeletonBefore, skeletonAfter)) {
          return reject([
            {
              code: "IDENTITY_MUTATION_FORBIDDEN",
              message: "Strict update mutations must preserve the ordered full-tree identity skeleton",
              mutationIndex,
              path: mutations[mutationIndex]?.path ?? mutation.path,
              identity: mutation.targetUniqueName,
            },
          ]);
        }
      }
    } catch (error) {
      return reject([
        {
          code: "APPLY_FAILED",
          message: `Mutation ${mutationIndex} failed to apply: ${errorMessage(error)}`,
          mutationIndex,
          path: mutations[mutationIndex]?.path ?? mutation.path,
          identity: mutation.targetUniqueName,
        },
      ]);
    }
  }

  const resultStructureDiagnostics = identityUnchanged && immutableBase && !immutableBase.extend && structureFactPrototypesSafe(profile)
    ? [] : validateExtendCoherence(current);
  if (resultStructureDiagnostics.length > 0) {
    return reject(resultStructureDiagnostics);
  }

  let resultIdentityDiagnostics: XnlMutationDiagnostic[];
  try {
    // Only our completed, single scalar path-copy has this proof. No object,
    // key, Word or container changed, and every copied ancestor retained its
    // literal context. Other updates still run the original complete check.
    resultIdentityDiagnostics = address && identityUnchanged && structureFactPrototypesSafe(profile)
      ? [] : validateIdentities(current, options.identityPolicy ?? "allow-missing");
  } catch (error) {
    return reject([
      {
        code: "RESULT_IDENTITY_INVALID",
        message: `Result identity validation failed: ${errorMessage(error)}`,
      },
    ]);
  }
  if (resultIdentityDiagnostics.length > 0) {
    return reject(
      resultIdentityDiagnostics.map((diagnostic) => ({
        code: "RESULT_IDENTITY_INVALID",
        message: `Result identity validation failed: ${diagnostic.message}`,
        identity: diagnostic.identity,
      }))
    );
  }

  if (immutable && address && identityUnchanged && isCapturedImmutableData(base) && isCapturedImmutableData(current)) {
    let candidates = scalarUpdateRelations.get(base);
    if (!candidates) { candidates = new WeakMap(); scalarUpdateRelations.set(base, candidates); }
    candidates.set(current, { path: captureImmutableData(address), contextVersion: capturedLiteralContextVersion() });
  }

  return {
    status: "applied",
    value: current,
    mutations,
    diagnostics: [],
  };
};

export function applyMutations(root: XnlNode, mutations: XnlMutation[], opts: XnlMutationOptions = {}): XnlNode {
  opts = immutableLiteralProfile(opts)?.options ?? opts;
  bindLiteralPaths(root, opts);
  let current = root;
  for (const mutation of mutations) {
    current = applySingle(current, mutation, opts);
    bindLiteralPaths(current, opts);
  }
  return current;
}

/** Produces preconditions against the sequential state observed by strict apply. */
export function diffNodes(
  oldNode: XnlNode,
  newNode: XnlNode,
  basePath: string | XnlPath = [],
  opts: XnlMutationOptions = {}
): XnlMutation[] {
  opts = immutableLiteralProfile(opts)?.options ?? opts;
  if (needsLiteralBinding(oldNode, opts) || needsLiteralBinding(newNode, opts)) {
    oldNode = cloneValue(oldNode);
    newNode = cloneValue(newNode);
    bindLiteralPaths(oldNode, opts);
    bindLiteralPaths(newNode, opts);
  }
  const mutations = diffNodesInternal(oldNode, newNode, basePath, opts);
  // Paths with an externally supplied base cannot be resolved against this subtree.
  // Normal root and identity-selected root paths can be simulated locally.
  const path = Array.isArray(basePath) ? basePath : parsePath(basePath);
  if (path.length > 0 && !(path.length === 1 && path[0]?.type === "UniqueName")) return mutations;
  let current = oldNode;
  let isolated = false;
  return mutations.map((mutation, index) => {
    const next = cloneValue(mutation);
    if (supportsValueBefore(next)) {
      const targetPath = Array.isArray(next.path) ? next.path : parsePath(next.path);
      next.valueBefore = cloneValue(resolveObservableTarget(current, next, targetPath)) as XnlNode;
    }
    // Only earlier operations affect the next precondition. The final apply
    // is verified by strict dry-run; diff need not clone/apply a discarded tree.
    if (index + 1 < mutations.length) {
      if (!isolated) { current = cloneValue(current); isolated = true; }
      current = applySingle(current, cloneValue(next), opts);
    }
    return next;
  });
}

function diffNodesInternal(
  oldNode: XnlNode,
  newNode: XnlNode,
  basePath: string | XnlPath = [],
  opts: XnlMutationOptions = {}
): XnlMutation[] {
  if (oldNode === newNode) return [];
  const pathItems = Array.isArray(basePath) ? basePath : parsePath(basePath);
  if (!sameKind(oldNode, newNode)) {
    return [{ type: "OBJECT_UPDATE", path: pathToDsl(pathItems), valueBefore: oldNode, valueAfter: newNode }];
  }
  if (isValueLiteral(oldNode) || isComment(oldNode)) {
    return oldNode === newNode ? [] : [{ type: "OBJECT_UPDATE", path: pathToDsl(pathItems), valueBefore: oldNode, valueAfter: newNode }];
  }
  if (Array.isArray(oldNode) && Array.isArray(newNode)) {
    return diffArray(oldNode, newNode, pathItems, undefined, undefined, opts);
  }
  if (isPlainObject(oldNode) && isPlainObject(newNode)) {
    return diffMap(oldNode as Record<string, any>, newNode as Record<string, any>, pathItems, undefined, undefined, opts);
  }
  if (isTextElement(oldNode) && isTextElement(newNode)) {
    return diffTextElement(oldNode, newNode, pathItems, opts);
  }
  if (isDataElement(oldNode) && isDataElement(newNode)) {
    const mutations = diffDataElement(oldNode, newNode, pathItems, opts);
    return reconcileMoves(mutations, opts);
  }
  return isEqual(oldNode, newNode) ? [] : [{ type: "OBJECT_UPDATE", path: pathToDsl(pathItems), valueBefore: oldNode, valueAfter: newNode }];
}

function applySingle(root: XnlNode, mutation: XnlMutation, opts: XnlMutationOptions): XnlNode {
  const { type, path, valueAfter } = mutation;
  const pathItems = Array.isArray(path) ? path : parsePath(path);
  if (pathItems.length === 0 && (type === "OBJECT_UPDATE" || type === "TREE_UPDATE")) return valueAfter as XnlNode;

  if (resolveMetaIdMode(opts) === "identity" && isMetadataIdPath(pathItems)) {
    return root;
  }

  if (type === "TREE_MOVE" || type === "TREE_MOVE_SAME_LEVEL" || type === "TREE_MOVE_CROSS_LEVEL") {
    if (!mutation.targetUniqueName && !mutation.pathBefore) {
      throw new XnlPathError("TREE_MOVE requires targetUniqueName or pathBefore");
    }
    const fromPath = mutation.pathBefore
      ? Array.isArray(mutation.pathBefore)
        ? mutation.pathBefore
        : parsePath(mutation.pathBefore)
      : [];
    let moved = mutation.targetUniqueName ? extractByUniqueId(root, mutation.targetUniqueName) : undefined;
    if (moved === undefined && fromPath.length > 0) {
      try {
        const found = resolvePath(root, fromPath, { strict: false });
        if (moved === undefined) moved = found;
        deleteAtPath(root, fromPath, { strict: false });
      } catch {
        /* ignore */
      }
    }
    if (moved === undefined && mutation.targetUniqueName) {
      throw new XnlPathError(`TREE_MOVE could not find node '${mutation.targetUniqueName}' to move`);
    }
    return applySingle(root, { ...mutation, type: "TREE_ADD", path, valueAfter: moved }, opts);
  }

  switch (type) {
    case "TREE_ADD":
      setPathValue(root, pathItems, valueAfter, {
        mode: "insert",
        destinationKey: mutation.destinationKey,
      });
      return root;
    case "TREE_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    case "TREE_UPDATE":
      setPathValue(root, pathItems, valueAfter, {
        mode: "replace",
        destinationKey: mutation.destinationKey,
      });
      return root;
    case "OBJECT_ADD":
    case "OBJECT_UPDATE":
      setPathValue(root, pathItems, valueAfter, {
        mode: "replace",
        destinationKey: mutation.destinationKey,
      });
      return root;
    case "OBJECT_DELETE":
      deleteAtPath(root, pathItems);
      return root;
    default:
      throw new XnlPathError(`Unknown mutation type ${type}`);
  }
}

function diffOptionalAttributes(
  oldAttributes: DataElementNode["attributes"] | TextElementNode["attributes"],
  newAttributes: DataElementNode["attributes"] | TextElementNode["attributes"],
  basePath: XnlPath,
  parentBefore: DataElementNode | TextElementNode,
  parentAfter: DataElementNode | TextElementNode,
  opts: XnlMutationOptions
): XnlMutation[] {
  if (oldAttributes === undefined && newAttributes !== undefined) {
    return [{
      type: "OBJECT_ADD",
      path: pathToDsl(basePath),
      valueAfter: newAttributes,
      parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
    }];
  }
  if (oldAttributes !== undefined && newAttributes === undefined) {
    return [{
      type: "OBJECT_DELETE",
      path: pathToDsl(basePath),
      valueBefore: oldAttributes,
      parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
    }];
  }
  if (oldAttributes === undefined || newAttributes === undefined) {
    return [];
  }
  return diffMap(oldAttributes, newAttributes, basePath, parentBefore, parentAfter, opts);
}

function diffTextElement(
  oldNode: TextElementNode,
  newNode: TextElementNode,
  basePath: XnlPath,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  if (oldNode.tag !== newNode.tag) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("tag")]),
      valueBefore: oldNode.tag,
      valueAfter: newNode.tag,
    });
  }
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, [...basePath, ip("metadata")], oldNode, newNode, opts));
  mutations.push(
    ...diffOptionalAttributes(
      oldNode.attributes,
      newNode.attributes,
      [...basePath, ip("attributes")],
      oldNode,
      newNode,
      opts
    )
  );
  if (oldNode.text !== newNode.text) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("text")]),
      valueAfter: newNode.text,
    });
  }
  if (oldNode.textMarker !== newNode.textMarker) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("textMarker")]),
      valueAfter: newNode.textMarker,
    });
  }
  return mutations;
}

function diffDataElement(
  oldNode: DataElementNode,
  newNode: DataElementNode,
  basePath: XnlPath,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  if (oldNode.tag !== newNode.tag) {
    mutations.push({
      type: "TREE_UPDATE",
      path: pathToDsl([...basePath, ip("tag")]),
      valueBefore: oldNode.tag,
      valueAfter: newNode.tag,
    });
  }
  const metaPath = [...basePath, ip("metadata")];
  mutations.push(...diffMap(oldNode.metadata, newNode.metadata, metaPath, oldNode, newNode, opts));
  const attrPath = [...basePath, ip("attributes")];
  mutations.push(
    ...diffOptionalAttributes(
      oldNode.attributes,
      newNode.attributes,
      attrPath,
      oldNode,
      newNode,
      opts
    )
  );

  if (oldNode.body || newNode.body) {
    mutations.push(
      ...diffArray(oldNode.body ?? [], newNode.body ?? [], [...basePath, ip("body")], oldNode, newNode, opts)
    );
  }
  const parentId =
    resolveMetaIdMode(opts) === "identity"
      ? readIdOrMetadaataId(oldNode) ?? readIdOrMetadaataId(newNode)
      : undefined;
  const bodyPath = parentId
    ? [ms("id", parentId) as PathItem, ip("body")]
    : [...basePath, ip("body")];
  if (oldNode.body === undefined && newNode.body?.length === 0) {
    mutations.push({
      type: "OBJECT_ADD",
      path: pathToDsl(bodyPath),
      valueAfter: [],
    });
  } else if (oldNode.body !== undefined && newNode.body === undefined) {
    mutations.push({
      type: "OBJECT_DELETE",
      path: pathToDsl(bodyPath),
    });
  }
  if (oldNode.extend || newNode.extend) {
    const extendMutations = diffExtend(
      oldNode.extend,
      newNode.extend,
      [...basePath, ip("extend")],
      oldNode,
      newNode,
      opts
    );
    mutations.push(...extendMutations);

    const extendPath = parentId
      ? [ms("id", parentId) as PathItem, ip("extend")]
      : [...basePath, ip("extend")];
    if (
      oldNode.extend === undefined &&
      newNode.extend !== undefined &&
      extendMutations.length === 0
    ) {
      mutations.push({
        type: "OBJECT_ADD",
        path: pathToDsl(extendPath),
        valueAfter: newNode.extend,
      });
    } else if (oldNode.extend !== undefined && newNode.extend === undefined) {
      mutations.push({
        type: "OBJECT_DELETE",
        path: pathToDsl(extendPath),
      });
    }
  }
  return mutations;
}

function diffArray(
  oldArr: XnlNode[],
  newArr: XnlNode[],
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];

  const parentId =
    resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : undefined;

  const pathBase = parentId ? [ms("id", parentId) as PathItem, ip("body")] : basePath;
  // With the same ordered identities there are no inserts/deletes/moves to
  // reconcile. Shared immutable subtrees need no ID maps or repeated matching;
  // changed siblings still go through the original recursive diff.
  if (resolveMetaIdMode(opts) === 'identity' && oldArr.length === newArr.length
    && oldArr.every((item, index) => item === newArr[index]
      || (!!readIdOrMetadaataId(item) && readIdOrMetadaataId(item) === readIdOrMetadaataId(newArr[index])))) {
    for (let index = 0; index < oldArr.length; index++) {
      if (oldArr[index] !== newArr[index]) mutations.push(...diffNodesInternal(oldArr[index], newArr[index], [...pathBase, li(index)], opts));
    }
    return mutations;
  }
  const oldById: Record<string, { index: number; value: XnlNode }> = {};
  const newById: Record<string, { index: number; value: XnlNode }> = {};
  oldArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) oldById[id] = { index: idx, value: item };
  });
  newArr.forEach((item, idx) => {
    const id = readIdOrMetadaataId(item);
    if (id) newById[id] = { index: idx, value: item };
  });

  const max = Math.max(oldArr.length, newArr.length);
  for (let i = 0; i < max; i++) {
    const oldItem = oldArr[i];
    const newItem = newArr[i];
    const path = [...pathBase, li(i)];
    if (oldItem === undefined && newItem !== undefined) {
      const id = readIdOrMetadaataId(newItem);
      mutations.push({
        type: "TREE_ADD",
        path: pathToDsl(path),
        valueAfter: newItem,
        targetUniqueName: id,
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      continue;
    }
    if (oldItem !== undefined && newItem === undefined) {
      const id = readIdOrMetadaataId(oldItem);
      mutations.push({
        type: "TREE_DELETE",
        path: pathToDsl(path),
        valueBefore: oldItem,
        targetUniqueName: id,
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
      });
      continue;
    }
    if (oldItem !== undefined && newItem !== undefined) {
      const useIdentity = resolveMetaIdMode(opts) === "identity";

      const oldId = readIdOrMetadaataId(oldItem);
      const newId = readIdOrMetadaataId(newItem);

      if (useIdentity && oldId && newId && oldId !== newId) {
        mutations.push({
          type: "TREE_DELETE",
          path: pathToDsl(path),
          valueBefore: oldItem,
          targetUniqueName: oldId,
          parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
        });
        mutations.push({
          type: "TREE_ADD",
          path: pathToDsl(path),
          valueAfter: newItem,
          targetUniqueName: newId,
          parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
        });
        continue;
      }

      if (isEqual(oldItem, newItem)) {
        continue;
      }

      const nested = diffNodesInternal(oldItem, newItem, path, opts);
      if (nested.length === 0) {
        if (!useIdentity) {
          mutations.push({
            type: "TREE_UPDATE",
            path: pathToDsl(path),
            valueAfter: newItem,
            targetUniqueName: readIdOrMetadaataId(newItem),
          });
        }
      } else {
        mutations.push(...nested);
      }
    }
  }

  if (resolveMetaIdMode(opts) === "identity") {
    const oldIds = oldArr.map(readIdOrMetadaataId).filter(Boolean) as string[];
    const newIds = newArr.map(readIdOrMetadaataId).filter(Boolean) as string[];
    const identityOrderChanged =
      oldIds.length !== newIds.length ||
      oldIds.some((id, index) => id !== newIds[index]);
    if (oldIds.length && newIds.length && identityOrderChanged) {
      // Cross-parent insertions can shift a retained sibling even when its old
      // and target numeric indexes happen to match.
      for (const id of oldIds) {
        if (!(id in newById)) continue;
        const oldIdx = oldById[id]?.index ?? -1;
        const newIdx = newById[id]?.index ?? -1;
        if (oldIdx !== -1 && newIdx !== -1) {
          mutations.push({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: pathToDsl([...pathBase, li(oldIdx)]),
            path: pathToDsl([...pathBase, li(newIdx)]),
            targetUniqueName: id,
            parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
            parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
          });
        }
      }
    }
  }
  return mutations;
}

function diffMap(
  oldMap: Record<string, any>,
  newMap: Record<string, any>,
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];
  const keys = new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]);
  for (const key of keys) {
    if (resolveMetaIdMode(opts) === "identity" && isMetadataMapPath(basePath) && key === "id") {
      continue;
    }
    const oldVal = oldMap && Object.prototype.hasOwnProperty.call(oldMap, key) ? oldMap[key] : undefined;
    const newVal = newMap && Object.prototype.hasOwnProperty.call(newMap, key) ? newMap[key] : undefined;
    const path = [...basePath, mk(key)];
    if (oldVal === undefined && newVal !== undefined) {
      mutations.push({
        type: "OBJECT_ADD",
        path: pathToDsl(path),
        valueAfter: newVal,
        targetUniqueName: readIdOrMetadaataId(newVal),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      continue;
    }
    if (oldVal !== undefined && newVal === undefined) {
      mutations.push({
        type: "OBJECT_DELETE",
        path: pathToDsl(path),
        valueBefore: oldVal,
        targetUniqueName: readIdOrMetadaataId(oldVal),
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
      });
      continue;
    }
    if (!isEqual(oldVal, newVal)) {
      const nested = diffNodesInternal(oldVal, newVal, path, opts);
      if (nested.length === 0) {
        mutations.push({ type: "OBJECT_UPDATE", path: pathToDsl(path), valueAfter: newVal });
      } else {
        mutations.push(...nested);
      }
    }
  }
  return mutations;
}

function diffExtend(
  oldExtend: DataElementNode["extend"] | undefined,
  newExtend: DataElementNode["extend"] | undefined,
  basePath: XnlPath,
  parentBefore: any,
  parentAfter: any,
  opts: XnlMutationOptions
): XnlMutation[] {
  const mutations: XnlMutation[] = [];

  const parentId =
    resolveMetaIdMode(opts) === "identity" ? readIdOrMetadaataId(parentBefore) ?? readIdOrMetadaataId(parentAfter) : undefined;

  const pathBase = parentId ? [{ type: "UniqueName", value: parentId } as PathItem, ip("extend")] : basePath;
  const oldChildren = oldExtend?.children ?? {};
  const newChildren = newExtend?.children ?? {};
  const oldOrder = oldExtend?.order ?? [];
  const newOrder = newExtend?.order ?? [];
  const oldByIdentity = new Map<string, string>();
  const usedOldTags = new Set<string>();
  const matchedByNewTag = new Map<string, { oldTag: string; oldChild: XnlNode; newChild: XnlNode }>();

  for (const tag of oldOrder) {
    const id = readIdOrMetadaataId(oldChildren[tag]);
    if (id && !oldByIdentity.has(id)) oldByIdentity.set(id, tag);
  }

  for (const tag of newOrder) {
    const newChild = newChildren[tag];
    const newId = readIdOrMetadaataId(newChild);
    const oldTagByIdentity = newId ? oldByIdentity.get(newId) : undefined;
    const oldTag =
      oldTagByIdentity && !usedOldTags.has(oldTagByIdentity)
        ? oldTagByIdentity
        : oldChildren[tag] !== undefined && !usedOldTags.has(tag)
          ? tag
          : undefined;
    if (!oldTag) continue;
    usedOldTags.add(oldTag);
    matchedByNewTag.set(tag, { oldTag, oldChild: oldChildren[oldTag], newChild });
  }

  for (const tag of oldOrder) {
    const oldChild = oldChildren[tag];
    if (usedOldTags.has(tag)) continue;
    mutations.push({
      type: "TREE_DELETE",
      path: pathToDsl([...pathBase, mk(tag)]),
      valueBefore: oldChild,
      targetUniqueName: readIdOrMetadaataId(oldChild),
      parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
    });
  }

  const workingOrder = oldOrder.filter((tag) => usedOldTags.has(tag));
  const currentTagByOldTag = new Map<string, string>();
  for (const tag of oldOrder) {
    if (usedOldTags.has(tag)) currentTagByOldTag.set(tag, tag);
  }

  for (let newIndex = 0; newIndex < newOrder.length; newIndex++) {
    const newTag = newOrder[newIndex];
    const match = matchedByNewTag.get(newTag);
    if (!match) {
      const newChild = newChildren[newTag];
      mutations.push({
        type: "TREE_ADD",
        path: pathToDsl([...pathBase, li(newIndex)]),
        valueAfter: newChild,
        targetUniqueName: readIdOrMetadaataId(newChild),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      const insertAt = Math.max(0, Math.min(newIndex, workingOrder.length));
      workingOrder.splice(insertAt, 0, newTag);
      continue;
    }

    const currentTag = currentTagByOldTag.get(match.oldTag) ?? match.oldTag;
    const currentIndex = workingOrder.indexOf(currentTag);
    if (currentIndex === -1) continue;
    if (currentIndex !== newIndex || currentTag !== newTag) {
      const id = readIdOrMetadaataId(match.oldChild);
      mutations.push({
        type: "TREE_MOVE_SAME_LEVEL",
        pathBefore: pathToDsl([...pathBase, li(currentIndex)]),
        path: pathToDsl([...pathBase, li(newIndex)]),
        valueBefore: match.oldChild,
        valueAfter: match.newChild,
        destinationKey: currentTag === newTag ? undefined : newTag,
        targetUniqueName: id,
        parentUniqueNameBefore: readIdOrMetadaataId(parentBefore),
        parentUniqueNameAfter: readIdOrMetadaataId(parentAfter),
      });
      workingOrder.splice(currentIndex, 1);
      workingOrder.splice(newIndex, 0, newTag);
      currentTagByOldTag.set(match.oldTag, newTag);
    }

    const id = readIdOrMetadaataId(match.oldChild) ?? readIdOrMetadaataId(match.newChild);
    const childPath = id ? [{ type: "UniqueName", value: id } as PathItem] : [...pathBase, mk(newTag)];
    const nested = diffNodesInternal(match.oldChild, match.newChild, childPath, opts);
    if (nested.length === 0) {
      if (!isStructurallyEqual(match.oldChild, match.newChild)) {
        mutations.push({ type: "TREE_UPDATE", path: pathToDsl(childPath), valueAfter: match.newChild });
      }
    } else {
      mutations.push(...nested);
    }
  }
  return mutations;
}

function pathToDsl(path: XnlPath): string {
  let out = "";
  for (const item of path) {
    if (item.type === "UniqueName") {
      out += `#${item.value}`;
      continue;
    }
    if (item.type === "MetadataSelector") {
      out += item.value;
      continue;
    }
    if (item.type === "InstanceProperty") {
      out += `:${item.value}`;
      continue;
    }
    if (item.type === "MapKey") {
      out += `::'${item.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      continue;
    }
    out += `::${item.value}`;
  }
  return out;
}

function sameKind(a: XnlNode, b: XnlNode): boolean {
  if (isDataElement(a) && isDataElement(b)) return true;
  if (isTextElement(a) && isTextElement(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return true;
  if (isPlainObject(a) && isPlainObject(b)) return true;
  if (isValueLiteral(a) && isValueLiteral(b)) return true;
  return typeof a === typeof b;
}

function isEqual(a: any, b: any): boolean {
  if (isWord(a) && isWord(b)) {
    return wordToString(a) === wordToString(b);
  }
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => isEqual(item, b[idx]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => isEqual(a[key], (b as any)[key]));
  }
  return false;
}

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !isDataElement(value) && !isTextElement(value) && !isWord(value);
}

function isDataElement(node: any): node is DataElementNode {
  return node && !isLiteralObject(node) && node.kind === "DataElement" && typeof node.tag === "string" && node.metadata !== null && typeof node.metadata === "object" && !Array.isArray(node.metadata);
}

function isTextElement(node: any): node is TextElementNode {
  return node && !isLiteralObject(node) && node.kind === "TextElement" && typeof node.tag === "string" && node.metadata !== null && typeof node.metadata === "object" && !Array.isArray(node.metadata);
}

function isExtendBody(node: any): node is ExtendBody {
  return node && !isLiteralObject(node) && typeof node === "object" && Array.isArray(node.order) && node.children;
}

function isValueLiteral(node: any): boolean {
  return (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean" ||
    node === null ||
    isWord(node)
  );
}

function isComment(node: any): boolean {
  return node && !isLiteralObject(node) && node.kind === "Comment";
}

const ip = (value: string): PathItem => ({ type: "InstanceProperty", value });
const mk = (value: string): PathItem => ({ type: "MapKey", value });
const li = (value: number | string): PathItem => ({ type: "ListIndex", value: String(value) });

function ms(key: string, value: string): PathItem {
  return { type: "MetadataSelector", value: `<${key}='${value}'>` } as PathItem;
}

function readIdOrMetadaataId(node: any): string | undefined {
  if (isDataElement(node) || isTextElement(node)) {
    const nodeId = wordToString((node as any).id);
    if (nodeId) return nodeId;

    const metaId = (node as any).metadata?.id;
    if (typeof metaId === "string") return metaId;
    if (isWord(metaId)) return wordToString(metaId);
  }
  return undefined;
}

function extractByUniqueId(root: any, id: string): any {
  if (Array.isArray(root)) {
    const idx = root.findIndex((item) => readIdOrMetadaataId(item) === id);
    if (idx !== -1) {
      const [removed] = root.splice(idx, 1);
      return removed;
    }
    for (const item of root) {
      const found = extractByUniqueId(item, id);
      if (found !== undefined) return found;
    }
  } else if (isDataElement(root)) {
    if (root.body) {
      const idx = root.body.findIndex((item) => readIdOrMetadaataId(item) === id);
      if (idx !== -1) {
        const [removed] = root.body.splice(idx, 1);
        return removed;
      }
      for (const child of root.body) {
        const found = extractByUniqueId(child, id);
        if (found !== undefined) return found;
      }
    }
    if (root.extend) {
      const tags = [...root.extend.order];
      for (const tag of tags) {
        const child = root.extend.children[tag];
        if (readIdOrMetadaataId(child) === id) {
          delete root.extend.children[tag];
          root.extend.order = root.extend.order.filter((t) => t !== tag);
          return child;
        }
        const found = extractByUniqueId(child, id);
        if (found !== undefined) return found;
      }
    }
  }
  return undefined;
}

function isExtendDestination(path: XnlMutation["path"]): boolean {
  const items = Array.isArray(path) ? path : parsePath(path);
  if (items.length < 2) return false;
  const parent = items[items.length - 2];
  const last = items[items.length - 1];
  return (
    parent.type === "InstanceProperty" &&
    parent.value === "extend" &&
    (last.type === "ListIndex" || last.type === "MapKey")
  );
}

function resolveMoveDestinationKey(add: XnlMutation, del: XnlMutation): string | undefined {
  if (add.destinationKey !== undefined) return add.destinationKey;
  if (!isExtendDestination(add.path)) return undefined;
  const sourceTag = tagOf(del.valueBefore);
  const destinationTag = tagOf(add.valueAfter);
  return destinationTag !== undefined && destinationTag !== sourceTag ? destinationTag : undefined;
}

function reconcileMoves(
  mutations: XnlMutation[],
  opts: XnlMutationOptions
): XnlMutation[] {
  const addsById: Record<string, XnlMutation[]> = {};
  const deletesById: Record<string, XnlMutation[]> = {};
  for (const m of mutations) {
    if (m.type === "TREE_ADD" && m.targetUniqueName) {
      addsById[m.targetUniqueName] = addsById[m.targetUniqueName] ?? [];
      addsById[m.targetUniqueName].push(m);
    }
    if (m.type === "TREE_DELETE" && m.targetUniqueName) {
      deletesById[m.targetUniqueName] = deletesById[m.targetUniqueName] ?? [];
      deletesById[m.targetUniqueName].push(m);
    }
  }

  const result: XnlMutation[] = [];
  const moveUpdates: XnlMutation[] = [];
  const usedAdds = new Set<XnlMutation>();
  const usedDeletes = new Set<XnlMutation>();

  for (const [id, dels] of Object.entries(deletesById)) {
    const adds = addsById[id];
    if (!adds || adds.length === 0) continue;
    const del = dels[0];
    const add = adds[0];
    if (!isSameElementKind(del.valueBefore, add.valueAfter)) continue;
    usedAdds.add(add);
    usedDeletes.add(del);
    const sameParent =
      add.parentUniqueNameAfter !== undefined &&
      add.parentUniqueNameAfter === del.parentUniqueNameBefore;
    const type: MutationType = sameParent ? "TREE_MOVE_SAME_LEVEL" : "TREE_MOVE_CROSS_LEVEL";
    const destinationKey = resolveMoveDestinationKey(add, del);
    const move: XnlMutation = {
      type,
      path: add.path,
      pathBefore: del.path,
      valueBefore: del.valueBefore,
      valueAfter: add.valueAfter,
      ...(destinationKey === undefined ? {} : { destinationKey }),
      targetUniqueName: id,
      parentUniqueNameBefore: del.parentUniqueNameBefore,
      parentUniqueNameAfter: add.parentUniqueNameAfter,
    };
    result.push(move);
    moveUpdates.push(
      ...diffNodesInternal(
        del.valueBefore as XnlNode,
        add.valueAfter as XnlNode,
        [{ type: "UniqueName", value: id }],
        opts
      )
    );
  }

  result.push(...moveUpdates);
  for (const m of mutations) {
    if (usedAdds.has(m) || usedDeletes.has(m)) continue;
    result.push(m);
  }

  const filtered: XnlMutation[] = [];
  const seenMoveKeys = new Set<string>();
  for (const m of result) {
    if ((m.type === "TREE_MOVE_SAME_LEVEL" || m.type === "TREE_MOVE_CROSS_LEVEL") && m.targetUniqueName) {
      const key = `${m.type}:${m.targetUniqueName}:${JSON.stringify(m.path)}:${JSON.stringify(m.pathBefore)}`;
      if (seenMoveKeys.has(key)) continue;
      seenMoveKeys.add(key);
    }
    filtered.push(m);
  }

  return orderMutations(filtered);
}

function isSameElementKind(
  before: XnlNode | undefined,
  after: XnlNode | undefined
): boolean {
  return (
    (isDataElement(before) && isDataElement(after)) ||
    (isTextElement(before) && isTextElement(after))
  );
}

function listIndex(path: XnlMutation["path"] | undefined): number | undefined {
  if (path === undefined) return undefined;
  const items = Array.isArray(path) ? path : parsePath(path);
  const last = items[items.length - 1];
  return last?.type === "ListIndex" ? Number(last.value) : undefined;
}

function parentPath(path: XnlMutation["path"]): string {
  const items = Array.isArray(path) ? path : parsePath(path);
  return pathToDsl(items.slice(0, -1));
}

function orderMutations(mutations: XnlMutation[]): XnlMutation[] {
  const indexed = mutations.map((mutation, order) => ({ mutation, order }));

  // Deletes consume old indexes, insertions establish target indexes, and
  // payload updates run only after structural positions have settled.
  const deletes = indexed
    .filter(({ mutation }) => mutation.type === "TREE_DELETE")
    .sort((left, right) => {
      const leftParent = parentPath(left.mutation.path);
      const rightParent = parentPath(right.mutation.path);
      if (leftParent !== rightParent) return left.order - right.order;
      return (
        (listIndex(right.mutation.path) ?? Number.NEGATIVE_INFINITY) -
          (listIndex(left.mutation.path) ?? Number.NEGATIVE_INFINITY) ||
        left.order - right.order
      );
    });
  const insertions = indexed
    .filter(
      ({ mutation }) =>
        mutation.type === "TREE_ADD" || isMoveMutation(mutation)
    )
    .sort(
      (left, right) =>
        (listIndex(left.mutation.path) ?? Number.POSITIVE_INFINITY) -
          (listIndex(right.mutation.path) ?? Number.POSITIVE_INFINITY) ||
        left.order - right.order
    );
  const others = indexed.filter(
    ({ mutation }) =>
      mutation.type !== "TREE_DELETE" &&
      mutation.type !== "TREE_ADD" &&
      !isMoveMutation(mutation)
  );

  return [...deletes, ...insertions, ...others].map(({ mutation }) => mutation);
}
