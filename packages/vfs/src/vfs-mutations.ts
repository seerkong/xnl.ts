import { applyMutations, diffNodes, parsePath, type DataElementNode, type ExtendBody, type XnlMutation, type XnlNode } from "xnl-core";
import { VfsError } from "./errors";
import { xnlFileHandler } from "./handlers";
import { createFileNode, createFolderNode, folderChildren, isFile, isFolder, readFileContent, readFileType, readMetadataId, readName } from "./model";
import { VFS_ROOT, basenameVfsPath, dirnameVfsPath, normalizeVfsPath, toSegments } from "./path";
import type { VfsFileType } from "./types";

export type VfsMutationType =
  | "FOLDER_CREATE"
  | "FOLDER_DELETE"
  | "FILE_CREATE"
  | "FILE_DELETE"
  | "MOVE"
  | "RENAME"
  | "META_UPDATE"
  | "CONTENT_UPDATE"
  | "EXTEND_UPDATE";

export interface VfsMutationPayload {
  content?: string;
  contentMutation?: XnlMutation[];
  fileType?: VfsFileType;
  metadataMutation?: XnlMutation[];
  attributeMutation?: XnlMutation[];
  extendMutation?: XnlMutation[];
}

export interface VfsMutation {
  type: VfsMutationType;
  path: string;
  targetPath?: string;
  expectedId?: string;
  payload?: VfsMutationPayload;
}

export interface VfsMutationRuntimeOptions {
  skipSidecarWhenNoExtensionMetadata?: boolean;
}

type NodeLocation = {
  path: string;
  node: DataElementNode;
  parent: DataElementNode | null;
  parentPath: string | null;
  bodyIndex: number;
};

type FlatNode = {
  id: string;
  path: string;
  parentPath: string | null;
  depth: number;
  kind: "folder" | "file";
  metadata: Record<string, XnlNode>;
  attributes: Record<string, XnlNode>;
  extend?: ExtendBody;
  content?: string;
  fileType?: VfsFileType;
};

const SYSTEM_METADATA_KEYS = new Set(["id", "name", "refId"]);

type MutationChannel = "metadata" | "attributes" | "extend";

type PathItemLike = {
  type: string;
  value: string;
};

const VFS_MUTATION_TYPES: Record<VfsMutationType, true> = {
  FOLDER_CREATE: true,
  FOLDER_DELETE: true,
  FILE_CREATE: true,
  FILE_DELETE: true,
  MOVE: true,
  RENAME: true,
  META_UPDATE: true,
  CONTENT_UPDATE: true,
  EXTEND_UPDATE: true,
};

function isDataElement(node: XnlNode | undefined): node is DataElementNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement");
}

function cloneNode<T extends XnlNode>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function escapeSingle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function selectorFor(id: string): string {
  return `<id='${id}'>`;
}

function metadataKeyPath(id: string, key: string): string {
  return `${selectorFor(id)}:metadata::'${escapeSingle(key)}'`;
}

function contentPath(id: string): string {
  return `${selectorFor(id)}:attributes::'content'`;
}

function attributesKeyPath(id: string, key: string): string {
  return `${selectorFor(id)}:attributes::'${escapeSingle(key)}'`;
}

function bodyIndexPath(parentId: string, index: number): string {
  return `${selectorFor(parentId)}:body::${index}`;
}

function ensureFolderNode(node: DataElementNode, path: string): void {
  if (!isFolder(node)) {
    throw new VfsError("ENOTDIR", `Expected folder at ${path}`);
  }
}

function findChildIndexByName(folder: DataElementNode, name: string): number {
  const body = folder.body ?? [];
  for (let index = 0; index < body.length; index += 1) {
    const value = body[index];
    if (!isDataElement(value)) {
      continue;
    }
    if (readName(value) === name) {
      return index;
    }
  }
  return -1;
}

function locateNode(root: DataElementNode, inputPath: string): NodeLocation {
  const path = normalizeVfsPath(inputPath);
  if (path === VFS_ROOT) {
    return {
      path,
      node: root,
      parent: null,
      parentPath: null,
      bodyIndex: -1,
    };
  }

  const segments = toSegments(path);
  let current = root;
  let currentPath = VFS_ROOT;
  let parent: DataElementNode | null = null;
  let parentPath: string | null = null;
  let bodyIndex = -1;

  for (const segment of segments) {
    ensureFolderNode(current, currentPath);
    const index = findChildIndexByName(current, segment);
    if (index < 0) {
      throw new VfsError("ENOENT", `Path does not exist: ${path}`);
    }
    const next = (current.body ?? [])[index];
    if (!isDataElement(next)) {
      throw new VfsError("EINVAL", `Invalid non-element child in folder body at ${currentPath}`);
    }
    parent = current;
    parentPath = currentPath;
    bodyIndex = index;
    current = next;
    currentPath = normalizeVfsPath(`${currentPath}/${segment}`);
  }

  return {
    path,
    node: current,
    parent,
    parentPath,
    bodyIndex,
  };
}

function hasNodeExtensionMetadata(node: DataElementNode): boolean {
  if (node.extend) {
    return true;
  }
  const businessMetadata = metadataWithoutReserved(node.metadata ?? {}, ["id", "name", "nodeType", "fileType", "refId"]);
  if (Object.keys(businessMetadata).length > 0) {
    return true;
  }
  const businessAttributes = attributesWithoutReserved(node.attributes, ["nodeType", "fileType", "content", "id", "name", "refId"]);
  return Object.keys(businessAttributes).length > 0;
}

function shouldSkipExpectedIdGuardForNode(node: DataElementNode, options: VfsMutationRuntimeOptions | undefined): boolean {
  if (!options?.skipSidecarWhenNoExtensionMetadata) {
    return false;
  }
  return !hasNodeExtensionMetadata(node);
}

function shouldSkipExpectedIdGuardForFlatNode(node: FlatNode, options: VfsMutationRuntimeOptions | undefined): boolean {
  if (!options?.skipSidecarWhenNoExtensionMetadata) {
    return false;
  }
  return !hasNodeExtensionMetadata({
    kind: "DataElement",
    tag: node.kind,
    metadata: node.metadata,
    attributes: node.attributes,
    extend: node.extend,
  });
}

function expectedIdForDiff(node: FlatNode, options: VfsMutationRuntimeOptions | undefined): string | undefined {
  if (shouldSkipExpectedIdGuardForFlatNode(node, options)) {
    return undefined;
  }
  return node.id;
}

function metadataWithoutReserved(metadata: Record<string, XnlNode>, reserved: string[]): Record<string, XnlNode> {
  const out: Record<string, XnlNode> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (reserved.includes(key)) {
      continue;
    }
    out[key] = cloneNode(value);
  }
  return out;
}

function attributesWithoutReserved(attributes: Record<string, XnlNode> | undefined, reserved: string[]): Record<string, XnlNode> {
  const out: Record<string, XnlNode> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (reserved.includes(key)) {
      continue;
    }
    out[key] = cloneNode(value);
  }
  return out;
}

function effectiveBusinessAttributes(node: FlatNode): Record<string, XnlNode> {
  const fromMetadata = metadataWithoutReserved(node.metadata, ["id", "name", "nodeType", "fileType", "refId"]);
  const fromAttributes = attributesWithoutReserved(node.attributes, ["nodeType", "fileType", "content", "id", "name", "refId"]);
  return {
    ...fromMetadata,
    ...fromAttributes,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function flattenSnapshot(snapshot: DataElementNode): Record<string, FlatNode> {
  const out: Record<string, FlatNode> = {};

  const walk = (node: DataElementNode, path: string, parentPath: string | null) => {
    const id = readMetadataId(node);
    const depth = toSegments(path).length;
    if (node.tag === "folder") {
      out[id] = {
        id,
        path,
        parentPath,
        depth,
        kind: "folder",
        metadata: cloneNode(node.metadata),
        attributes: cloneNode(node.attributes ?? {}),
        extend: node.extend ? cloneNode(node.extend) : undefined,
      };
      for (const child of folderChildren(node)) {
        const childPath = normalizeVfsPath(`${path}/${readName(child)}`);
        walk(child, childPath, path);
      }
      return;
    }

    if (node.tag !== "file") {
      throw new VfsError("EINVAL", `Unsupported node tag while flattening: <${node.tag}>`);
    }

    out[id] = {
      id,
      path,
      parentPath,
      depth,
      kind: "file",
      metadata: cloneNode(node.metadata),
      attributes: cloneNode(node.attributes ?? {}),
      extend: node.extend ? cloneNode(node.extend) : undefined,
      fileType: readFileType(node),
      content: readFileContent(node),
    };
  };

  walk(snapshot, VFS_ROOT, null);
  return out;
}

function applyAndAdvance(current: DataElementNode, mutations: XnlMutation[]): DataElementNode {
  if (mutations.length === 0) {
    return current;
  }
  const next = applyMutations(cloneNode(current), mutations, { metadataIdMode: "identity" });
  if (!isDataElement(next)) {
    throw new VfsError("EINVAL", "Applying translated XNL mutations produced a non-data-element snapshot");
  }
  return next;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("#") || path.startsWith("<");
}

function pathToDsl(path: string | PathItemLike[]): string {
  if (typeof path === "string") {
    return path;
  }
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
      out += `::'${escapeSingle(item.value)}'`;
      continue;
    }
    if (item.type === "ListIndex") {
      out += `::${item.value}`;
      continue;
    }
    throw new VfsError("EINVAL", `Unsupported path item type: ${item.type}`);
  }
  return out;
}

function anchorToNodePath(id: string, path: string | PathItemLike[]): string {
  const dslPath = pathToDsl(path);
  if (isAbsolutePath(dslPath)) {
    return dslPath;
  }
  if (dslPath.startsWith(":")) {
    return `${selectorFor(id)}${dslPath}`;
  }
  return `${selectorFor(id)}:${dslPath}`;
}

function mutationScopeItems(path: string): ReturnType<typeof parsePath> {
  const items = parsePath(path);
  if (items.length > 0 && (items[0].type === "MetadataSelector" || items[0].type === "UniqueName")) {
    return items.slice(1);
  }
  return items;
}

function splitCreateMetadataIdMutation(mutations: XnlMutation[]): { forcedId: string | undefined; rest: XnlMutation[] } {
  let forcedId: string | undefined;
  const rest: XnlMutation[] = [];
  for (const mutation of mutations) {
    const scoped = mutationScopeItems(pathToDsl(mutation.path));
    const root = scoped[0];
    const key = scoped[1];
    const isIdWrite =
      mutation.type === "OBJECT_UPDATE" &&
      root?.type === "InstanceProperty" &&
      root.value === "metadata" &&
      key?.type === "MapKey" &&
      key.value === "id" &&
      typeof mutation.valueAfter === "string";
    if (!isIdWrite) {
      rest.push(mutation);
      continue;
    }
    const idValue = mutation.valueAfter as string;
    if (forcedId && forcedId !== idValue) {
      throw new VfsError("EINVAL", "CREATE metadataMutation contains conflicting metadata.id updates");
    }
    forcedId = idValue;
  }
  return { forcedId, rest };
}

function validateScopedMutationPath(path: string, channel: MutationChannel, context: string): void {
  const scoped = mutationScopeItems(path);
  const root = scoped[0];
  const key = scoped[1];
  if (channel === "extend") {
    if (!root || root.type !== "InstanceProperty" || root.value !== "extend") {
      throw new VfsError("EINVAL", `${context} must target extend field: ${path}`);
    }
    return;
  }

  if (!root || !key || root.type !== "InstanceProperty" || key.type !== "MapKey") {
    throw new VfsError("EINVAL", `${context} mutation path must target ${channel} map key: ${path}`);
  }

  if (channel === "metadata") {
    if (root.value !== "metadata" || !SYSTEM_METADATA_KEYS.has(key.value)) {
      throw new VfsError("EINVAL", `${context} only accepts metadata system keys (id,name,refId): ${path}`);
    }
    return;
  }

  if (root.value !== "attributes") {
    throw new VfsError("EINVAL", `${context} must target attributes map: ${path}`);
  }
  if (SYSTEM_METADATA_KEYS.has(key.value)) {
    throw new VfsError("EINVAL", `${context} cannot include system keys: ${key.value}`);
  }
}

function normalizeScopedMutationList(
  id: string,
  mutations: XnlMutation[],
  channel: MutationChannel,
  context: string,
): XnlMutation[] {
  const out: XnlMutation[] = [];
  for (const mutation of mutations) {
    const anchoredPath = anchorToNodePath(id, mutation.path);
    const anchoredBefore = mutation.pathBefore ? anchorToNodePath(id, mutation.pathBefore) : undefined;
    validateScopedMutationPath(anchoredPath, channel, context);
    if (anchoredBefore) {
      validateScopedMutationPath(anchoredBefore, channel, context);
    }
    out.push({
      ...mutation,
      path: anchoredPath,
      pathBefore: anchoredBefore,
    });
  }
  return out;
}

function mapValue(value: XnlNode | undefined): Record<string, XnlNode> {
  if (value === undefined) {
    return {};
  }
  return { refId: cloneNode(value) };
}

function ensureExpectedIdWithRuntime(location: NodeLocation, mutation: VfsMutation, options: VfsMutationRuntimeOptions | undefined): string {
  const id = readMetadataId(location.node);
  if (mutation.expectedId && mutation.expectedId !== id) {
    throw new VfsError("EINVAL", `Expected node id ${mutation.expectedId} but found ${id} at ${location.path}`);
  }
  return id;
}

function translateOne(current: DataElementNode, mutation: VfsMutation, options: VfsMutationRuntimeOptions | undefined): XnlMutation[] {
  const path = normalizeVfsPath(mutation.path);
  const payload = mutation.payload ?? {};

  if (mutation.type === "FOLDER_CREATE" || mutation.type === "FILE_CREATE") {
    const parentPath = dirnameVfsPath(path);
    const name = basenameVfsPath(path);
    const parent = locateNode(current, parentPath);
    ensureFolderNode(parent.node, parentPath);
    const parentId = readMetadataId(parent.node);
    const insertIndex = (parent.node.body ?? []).length;
    const metadataMutationInput = payload.metadataMutation ?? [];
    const { forcedId: metadataForcedId, rest: metadataMutation } = splitCreateMetadataIdMutation(metadataMutationInput);
    if (mutation.expectedId && metadataForcedId && mutation.expectedId !== metadataForcedId) {
      throw new VfsError("EINVAL", "CREATE expectedId does not match metadataMutation metadata.id");
    }
    const nodeId = mutation.expectedId ?? metadataForcedId;

    let node =
      mutation.type === "FOLDER_CREATE"
        ? createFolderNode(name, { id: nodeId })
        : createFileNode(name, payload.content ?? "", payload.fileType ?? "text", { id: nodeId });

    let addedId = readMetadataId(node);
    const nodeScopedMutations: XnlMutation[] = [];
    nodeScopedMutations.push(
        ...normalizeScopedMutationList(
          addedId,
          metadataMutation,
          "metadata",
          "CREATE metadataMutation",
        ),
    );
    nodeScopedMutations.push(
      ...normalizeScopedMutationList(
        addedId,
        payload.attributeMutation ?? [],
        "attributes",
        "CREATE attributeMutation",
      ),
    );
    nodeScopedMutations.push(
      ...normalizeScopedMutationList(
        addedId,
        payload.extendMutation ?? [],
        "extend",
        "CREATE extendMutation",
      ),
    );

    if (nodeScopedMutations.length > 0) {
      const nextNode = applyMutations(cloneNode(node), nodeScopedMutations, { metadataIdMode: "identity" });
      if (!isDataElement(nextNode)) {
        throw new VfsError("EINVAL", "CREATE payload mutations produced a non-data-element node");
      }
      node = nextNode;
      addedId = readMetadataId(node);
    }

    return [
      {
        type: "TREE_ADD",
        path: bodyIndexPath(parentId, insertIndex),
        valueAfter: node,
        targetUniqueName: addedId,
        parentUniqueNameAfter: parentId,
      },
    ];
  }

  if (mutation.type === "FOLDER_DELETE" || mutation.type === "FILE_DELETE") {
    const location = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(location, mutation, options);
    if (!location.parent) {
      throw new VfsError("EINVAL", "Cannot delete VFS root");
    }
    const parentId = readMetadataId(location.parent);
    return [
      {
        type: "TREE_DELETE",
        path: bodyIndexPath(parentId, location.bodyIndex),
        targetUniqueName: id,
        parentUniqueNameBefore: parentId,
        valueBefore: cloneNode(location.node),
      },
    ];
  }

  if (mutation.type === "RENAME") {
    const targetPath = mutation.targetPath ? normalizeVfsPath(mutation.targetPath) : undefined;
    if (!targetPath) {
      throw new VfsError("EINVAL", "RENAME requires targetPath");
    }
    if (dirnameVfsPath(path) !== dirnameVfsPath(targetPath)) {
      throw new VfsError("EINVAL", "RENAME must stay within the same parent directory");
    }
    const location = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(location, mutation, options);
    return [
      {
        type: "OBJECT_UPDATE",
        path: metadataKeyPath(id, "name"),
        valueAfter: basenameVfsPath(targetPath),
      },
    ];
  }

  if (mutation.type === "MOVE") {
    const targetPath = mutation.targetPath ? normalizeVfsPath(mutation.targetPath) : undefined;
    if (!targetPath) {
      throw new VfsError("EINVAL", "MOVE requires targetPath");
    }

    const source = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(source, mutation, options);
    if (!source.parent) {
      throw new VfsError("EINVAL", "Cannot move VFS root");
    }

    const sourceParentId = readMetadataId(source.parent);
    const targetParentPath = dirnameVfsPath(targetPath);
    const targetParent = locateNode(current, targetParentPath);
    ensureFolderNode(targetParent.node, targetParentPath);
    const targetParentId = readMetadataId(targetParent.node);
    const targetName = basenameVfsPath(targetPath);

    const targetIndex = (targetParent.node.body ?? []).length;
    const moveType = sourceParentId === targetParentId ? "TREE_MOVE_SAME_LEVEL" : "TREE_MOVE_CROSS_LEVEL";

    const out: XnlMutation[] = [
      {
        type: moveType,
        path: bodyIndexPath(targetParentId, targetIndex),
        pathBefore: bodyIndexPath(sourceParentId, source.bodyIndex),
        targetUniqueName: id,
        parentUniqueNameBefore: sourceParentId,
        parentUniqueNameAfter: targetParentId,
      },
    ];

    if (readName(source.node) !== targetName) {
      out.push({
        type: "OBJECT_UPDATE",
        path: metadataKeyPath(id, "name"),
        valueAfter: targetName,
      });
    }

    return out;
  }

  if (mutation.type === "META_UPDATE") {
    const location = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(location, mutation, options);
    const out: XnlMutation[] = [];
    out.push(...normalizeScopedMutationList(id, payload.metadataMutation ?? [], "metadata", "META_UPDATE metadataMutation"));
    out.push(...normalizeScopedMutationList(id, payload.attributeMutation ?? [], "attributes", "META_UPDATE attributeMutation"));
    return out;
  }

  if (mutation.type === "CONTENT_UPDATE") {
    const location = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(location, mutation, options);
    if (!isFile(location.node)) {
      throw new VfsError("EISDIR", `CONTENT_UPDATE requires file path: ${path}`);
    }

    const nextContent = payload.contentMutation
      ? xnlFileHandler.apply(readFileContent(location.node), payload.contentMutation)
      : payload.content ?? "";

    const out: XnlMutation[] = [
      {
        type: "OBJECT_UPDATE",
        path: contentPath(id),
        valueAfter: nextContent,
      },
    ];
    if (payload.fileType) {
      out.push({
        type: "OBJECT_UPDATE",
        path: attributesKeyPath(id, "fileType"),
        valueAfter: payload.fileType,
      });
    }
    return out;
  }

  if (mutation.type === "EXTEND_UPDATE") {
    const location = locateNode(current, path);
    const id = ensureExpectedIdWithRuntime(location, mutation, options);
    const extendMutation = normalizeScopedMutationList(id, payload.extendMutation ?? [], "extend", "EXTEND_UPDATE extendMutation");
    if (extendMutation.length === 0) {
      throw new VfsError("EINVAL", "EXTEND_UPDATE requires payload.extendMutation");
    }
    return extendMutation;
  }

  throw new VfsError("EINVAL", `Unsupported VFS mutation type: ${mutation.type}`);
}

export function isVfsMutation(value: unknown): value is VfsMutation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mutation = value as { type?: string; path?: string };
  if (typeof mutation.type !== "string" || typeof mutation.path !== "string") {
    return false;
  }
  return mutation.type in VFS_MUTATION_TYPES;
}

export function toXnlMutations(base: DataElementNode, mutations: VfsMutation[], options?: VfsMutationRuntimeOptions): XnlMutation[] {
  let working = cloneNode(base);
  const out: XnlMutation[] = [];

  for (const mutation of mutations) {
    const translated = translateOne(working, mutation, options);
    out.push(...translated);
    working = applyAndAdvance(working, translated);
  }

  return out;
}

export function applyVfsSnapshotMutations(base: DataElementNode, mutations: VfsMutation[], options?: VfsMutationRuntimeOptions): DataElementNode {
  const translated = toXnlMutations(base, mutations, options);
  const next = applyMutations(cloneNode(base), translated, { metadataIdMode: "identity" });
  if (!isDataElement(next)) {
    throw new VfsError("EINVAL", "Applying VFS mutations produced invalid snapshot");
  }
  return next;
}

export function diffVfsSnapshots(from: DataElementNode, to: DataElementNode, options?: VfsMutationRuntimeOptions): VfsMutation[] {
  const fromMap = flattenSnapshot(from);
  const toMap = flattenSnapshot(to);

  const fromPathToId = new Map<string, string>();
  for (const [id, node] of Object.entries(fromMap)) {
    fromPathToId.set(node.path, id);
  }

  const fromIds = Object.keys(fromMap);
  const toIds = Object.keys(toMap);

  const removedIds = fromIds.filter((id) => !(id in toMap));
  const addedIds = toIds.filter((id) => !(id in fromMap));
  const sharedIds = fromIds.filter((id) => id in toMap);

  const movedFolderIds = new Set<string>();
  for (const id of sharedIds) {
    const prev = fromMap[id];
    const next = toMap[id];
    if (prev.kind === "folder" && prev.path !== next.path) {
      movedFolderIds.add(id);
    }
  }

  const hasMovedAncestor = (id: string): boolean => {
    let parentPath = fromMap[id]?.parentPath;
    while (parentPath) {
      const parentId = fromPathToId.get(parentPath);
      if (!parentId) {
        return false;
      }
      if (movedFolderIds.has(parentId)) {
        return true;
      }
      parentPath = fromMap[parentId]?.parentPath ?? null;
    }
    return false;
  };

  const mutations: VfsMutation[] = [];

  for (const id of removedIds.sort((a, b) => fromMap[b].depth - fromMap[a].depth)) {
    const node = fromMap[id];
      mutations.push({
        type: node.kind === "folder" ? "FOLDER_DELETE" : "FILE_DELETE",
        path: node.path,
        expectedId: expectedIdForDiff(node, options),
      });
  }

  for (const id of sharedIds.sort((a, b) => fromMap[a].depth - fromMap[b].depth)) {
    const prev = fromMap[id];
    const next = toMap[id];
    if (prev.path !== next.path) {
      if (!hasMovedAncestor(id)) {
        const prevParent = dirnameVfsPath(prev.path);
        const nextParent = dirnameVfsPath(next.path);
        if (prevParent !== nextParent) {
          mutations.push({
            type: "MOVE",
            path: prev.path,
            targetPath: next.path,
            expectedId: expectedIdForDiff(next, options),
          });
        } else {
          mutations.push({
            type: "RENAME",
            path: prev.path,
            targetPath: next.path,
            expectedId: expectedIdForDiff(next, options),
          });
        }
      }
    }

    const prevRefId = prev.metadata.refId;
    const nextRefId = next.metadata.refId;
    const prevBusiness = effectiveBusinessAttributes(prev);
    const nextBusiness = effectiveBusinessAttributes(next);
    if (!shallowEqual(prevBusiness, nextBusiness) || !shallowEqual(prevRefId ?? null, nextRefId ?? null)) {
      const payload: VfsMutationPayload = {};
      const metadataMutation = diffNodes(mapValue(prevRefId as XnlNode | undefined), mapValue(nextRefId as XnlNode | undefined), ":metadata", {
        metadataIdMode: "identity",
      });
      if (metadataMutation.length > 0) {
        payload.metadataMutation = metadataMutation;
      }
      const attributeMutation = diffNodes(prevBusiness, nextBusiness, ":attributes", {
        metadataIdMode: "identity",
      });
      if (attributeMutation.length > 0) {
        payload.attributeMutation = attributeMutation;
      }
      mutations.push({
        type: "META_UPDATE",
        path: next.path,
        expectedId: expectedIdForDiff(next, options),
        payload,
      });
    }

    if (!shallowEqual(prev.extend ?? null, next.extend ?? null)) {
      let extendMutation: XnlMutation[];
      if (prev.extend && !next.extend) {
        extendMutation = [{ type: "OBJECT_DELETE", path: ":extend" }];
      } else {
        extendMutation = diffNodes(prev.extend ?? {}, next.extend ?? {}, ":extend", {
          metadataIdMode: "identity",
        });
      }
      mutations.push({
        type: "EXTEND_UPDATE",
        path: next.path,
        expectedId: expectedIdForDiff(next, options),
        payload: { extendMutation },
      });
    }

    if (prev.kind === "file" && next.kind === "file") {
      if (prev.content !== next.content || prev.fileType !== next.fileType) {
        let payload: VfsMutationPayload;
        if (next.fileType === "xnl") {
          try {
            payload = {
              contentMutation: xnlFileHandler.diff(prev.content ?? "", next.content ?? ""),
              fileType: next.fileType,
            };
          } catch {
            payload = {
              content: next.content ?? "",
              fileType: next.fileType,
            };
          }
        } else {
          payload = {
            content: next.content ?? "",
            fileType: next.fileType,
          };
        }

        mutations.push({
          type: "CONTENT_UPDATE",
          path: next.path,
          expectedId: expectedIdForDiff(next, options),
          payload,
        });
      }
    }
  }

  for (const id of addedIds.sort((a, b) => toMap[a].depth - toMap[b].depth)) {
    const node = toMap[id];
    const metadataMutation = diffNodes({}, mapValue(node.metadata.refId as XnlNode | undefined), ":metadata", {
      metadataIdMode: "identity",
    });
    const attributeMutation = diffNodes({}, effectiveBusinessAttributes(node), ":attributes", {
      metadataIdMode: "identity",
    });
    const extendMutation = node.extend
      ? diffNodes({}, node.extend, ":extend", {
          metadataIdMode: "identity",
        })
      : [];
    const expectedId = expectedIdForDiff(node, options);
    const createMetadataMutation = [...metadataMutation];
    if (!expectedId) {
      createMetadataMutation.push({
        type: "OBJECT_UPDATE",
        path: ":metadata::'id'",
        valueAfter: id,
      });
    }

    if (node.kind === "folder") {
      const payload: VfsMutationPayload = {};
      if (createMetadataMutation.length > 0) {
        payload.metadataMutation = createMetadataMutation;
      }
      if (attributeMutation.length > 0) {
        payload.attributeMutation = attributeMutation;
      }
      if (extendMutation.length > 0) {
        payload.extendMutation = extendMutation;
      }
      mutations.push({
        type: "FOLDER_CREATE",
        path: node.path,
        expectedId,
        payload,
      });
      continue;
    }

    const payload: VfsMutationPayload = {
      content: node.content ?? "",
      fileType: node.fileType,
    };
    if (createMetadataMutation.length > 0) {
      payload.metadataMutation = createMetadataMutation;
    }
    if (attributeMutation.length > 0) {
      payload.attributeMutation = attributeMutation;
    }
    if (extendMutation.length > 0) {
      payload.extendMutation = extendMutation;
    }
    mutations.push({
      type: "FILE_CREATE",
      path: node.path,
      expectedId,
      payload,
    });
  }

  return mutations;
}
