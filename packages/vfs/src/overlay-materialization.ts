import type { DataElementNode, XnlMutation, XnlMutationDiagnostic, XnlNode } from "xnl-core";
import { folderChildren, isFile, isFolder, readMetadataId, readName } from "./model";
import {
  applyRevisionedVfsMutations,
  type ApplyRevisionedVfsMutationsInput,
  type RevisionedPersistenceDiagnostic,
  type RevisionedVfsAuthority,
  type RevisionedVfsReceipt,
  type RevisionedVfsSnapshot,
  type VfsRevision,
} from "./revisioned-persistence";
import { VFS_ROOT } from "./path";
import {
  applyVfsSnapshotMutations,
  diffVfsSnapshots,
  isVfsMutation,
  toXnlMutations,
  type VfsMutation,
} from "./vfs-mutations";

export interface VfsDirectoryOverlayIntent {
  id: string;
  order: number;
  kind: "directory";
  snapshot: DataElementNode;
}

export interface VfsMutationOverlayIntent {
  id: string;
  order: number;
  kind: "mutations";
  mutations: VfsMutation[];
}

export type VfsOverlayIntent = VfsDirectoryOverlayIntent | VfsMutationOverlayIntent;

export interface PlanSparseDirectoryOverlayOptions {
  overlayIndex?: number;
}

export type VfsOverlayPlanningDiagnosticCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_OVERLAY"
  | "INVALID_OVERLAY_KIND"
  | "DUPLICATE_OVERLAY_ID"
  | "INVALID_OVERLAY_ORDER"
  | "KIND_CONFLICT"
  | "IDENTITY_CONFLICT"
  | "MUTATION_REJECTED"
  | "PLANNING_FAILED";

export interface VfsOverlayPlanningDiagnostic {
  code: VfsOverlayPlanningDiagnosticCode;
  message: string;
  overlayId: string;
  overlayOrder: number;
  overlayIndex: number;
  path: string;
  mutationIndex?: number;
  cause?: unknown;
}

export interface SparseDirectoryOverlayPlan {
  overlayId: string;
  overlayOrder: number;
  candidate: DataElementNode;
  mutations: VfsMutation[];
}

export type SparseDirectoryOverlayPlanningResult =
  | {
      status: "planned";
      plan: SparseDirectoryOverlayPlan;
    }
  | {
      status: "rejected";
      diagnostics: VfsOverlayPlanningDiagnostic[];
    };

export interface VfsOverlayProvenance {
  overlayId: string;
  overlayOrder: number;
  overlayIndex: number;
  kind: VfsOverlayIntent["kind"];
  mutations: VfsMutation[];
}

export interface VfsOverlayPlan {
  candidate: DataElementNode;
  mutations: VfsMutation[];
  xnlMutations: XnlMutation[];
  overlays: VfsOverlayProvenance[];
}

export type VfsOverlayPlanningResult =
  | {
      status: "planned";
      plan: VfsOverlayPlan;
    }
  | {
      status: "rejected";
      diagnostics: VfsOverlayPlanningDiagnostic[];
    };

type VfsOverlayPlanningRejection = Extract<VfsOverlayPlanningResult, { status: "rejected" }>;

type OverlayLocation = {
  overlayId: string;
  overlayOrder: number;
  overlayIndex: number;
  mutationIndex?: number;
};

class OverlayPlanningFailure extends Error {
  readonly code: VfsOverlayPlanningDiagnosticCode;
  readonly path: string;

  constructor(code: VfsOverlayPlanningDiagnosticCode, path: string, message: string) {
    super(message);
    this.name = "OverlayPlanningFailure";
    this.code = code;
    this.path = path;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function childPath(parentPath: string, name: string): string {
  return parentPath === VFS_ROOT ? `${VFS_ROOT}${name}` : `${parentPath}/${name}`;
}

function nodeKind(node: DataElementNode): "folder" | "file" | undefined {
  if (isFolder(node)) return "folder";
  if (isFile(node)) return "file";
  return undefined;
}

function failInvalid(path: string, message: string): never {
  throw new OverlayPlanningFailure("INVALID_SNAPSHOT", path, message);
}

function validateSnapshot(snapshot: DataElementNode, label: "base" | "overlay"): void {
  const ids = new Map<string, string>();

  const visit = (node: DataElementNode, path: string): void => {
    const kind = nodeKind(node);
    if (!kind) {
      failInvalid(path, `${label} snapshot contains unsupported <${node.tag}> node at ${path}`);
    }

    let id: string;
    let name: string;
    try {
      id = readMetadataId(node);
      name = readName(node);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      failInvalid(path, `${label} snapshot has invalid identity at ${path}: ${detail}`);
    }

    const priorPath = ids.get(id);
    if (priorPath !== undefined) {
      throw new OverlayPlanningFailure(
        "IDENTITY_CONFLICT",
        path,
        `${label} snapshot reuses metadata.id ${JSON.stringify(id)} at ${priorPath} and ${path}`,
      );
    }
    ids.set(id, path);

    if (kind !== "folder") return;

    const names = new Set<string>();
    for (const child of folderChildren(node)) {
      const childName = readName(child);
      const nextPath = childPath(path, childName);
      if (names.has(childName)) {
        failInvalid(nextPath, `${label} snapshot contains duplicate child name ${JSON.stringify(childName)} at ${path}`);
      }
      names.add(childName);
      visit(child, nextPath);
    }

    if (path === VFS_ROOT && name.length === 0) {
      failInvalid(path, `${label} snapshot root must have a non-empty metadata.name`);
    }
  };

  visit(snapshot, VFS_ROOT);
  if (!isFolder(snapshot)) {
    failInvalid(VFS_ROOT, `${label} snapshot root must be a folder`);
  }
}

function replacementMetadata(base: DataElementNode, overlay: DataElementNode): Record<string, XnlNode> {
  return {
    ...clone(overlay.metadata ?? {}),
    id: readMetadataId(base),
    name: readName(base),
  };
}

function mergeSamePath(base: DataElementNode, overlay: DataElementNode, path: string): DataElementNode {
  const baseKind = nodeKind(base);
  const overlayKind = nodeKind(overlay);
  if (!baseKind || !overlayKind) {
    failInvalid(path, `Unsupported VFS node kind at ${path}`);
  }
  if (baseKind !== overlayKind) {
    throw new OverlayPlanningFailure(
      "KIND_CONFLICT",
      path,
      `Sparse directory overlay kind conflict at ${path}: base is ${baseKind}, overlay is ${overlayKind}`,
    );
  }

  const merged = clone(overlay);
  merged.metadata = replacementMetadata(base, overlay);

  if (baseKind === "file") {
    return merged;
  }

  const mergedChildren = folderChildren(base).map((child) => clone(child));
  const childIndexes = new Map<string, number>();
  for (let index = 0; index < mergedChildren.length; index += 1) {
    childIndexes.set(readName(mergedChildren[index]), index);
  }

  for (const overlayChild of folderChildren(overlay)) {
    const name = readName(overlayChild);
    const index = childIndexes.get(name);
    if (index === undefined) {
      childIndexes.set(name, mergedChildren.length);
      mergedChildren.push(clone(overlayChild));
      continue;
    }
    mergedChildren[index] = mergeSamePath(mergedChildren[index], overlayChild, childPath(path, name));
  }

  merged.body = mergedChildren;
  return merged;
}

function diagnostic(location: OverlayLocation, failure: OverlayPlanningFailure, cause?: unknown): VfsOverlayPlanningDiagnostic {
  return {
    code: failure.code,
    message: failure.message,
    overlayId: location.overlayId,
    overlayOrder: location.overlayOrder,
    overlayIndex: location.overlayIndex,
    path: failure.path,
    ...(location.mutationIndex === undefined ? {} : { mutationIndex: location.mutationIndex }),
    ...(cause === undefined ? {} : { cause }),
  };
}

/**
 * Plans one directory-shaped overlay as sparse path opinions against an
 * immutable base snapshot. Missing paths never imply deletion. Existing paths
 * retain base identity; newly added subtrees retain overlay identity.
 */
export function planSparseDirectoryOverlay(
  base: DataElementNode,
  overlay: VfsDirectoryOverlayIntent,
  options: PlanSparseDirectoryOverlayOptions = {},
): SparseDirectoryOverlayPlanningResult {
  const location: OverlayLocation = {
    overlayId: overlay.id,
    overlayOrder: overlay.order,
    overlayIndex: options.overlayIndex ?? 0,
  };

  try {
    validateSnapshot(base, "base");
    validateSnapshot(overlay.snapshot, "overlay");
    const candidate = mergeSamePath(base, overlay.snapshot, VFS_ROOT);
    validateSnapshot(candidate, "base");
    const mutations = diffVfsSnapshots(base, candidate);
    return {
      status: "planned",
      plan: {
        overlayId: overlay.id,
        overlayOrder: overlay.order,
        candidate,
        mutations,
      },
    };
  } catch (cause) {
    if (cause instanceof OverlayPlanningFailure) {
      return {
        status: "rejected",
        diagnostics: [diagnostic(location, cause)],
      };
    }

    const message = cause instanceof Error ? cause.message : String(cause);
    const failure = new OverlayPlanningFailure(
      "PLANNING_FAILED",
      VFS_ROOT,
      `Sparse directory overlay planning failed: ${message}`,
    );
    return {
      status: "rejected",
      diagnostics: [diagnostic(location, failure, cause)],
    };
  }
}

type IndexedOverlay = {
  overlay: VfsOverlayIntent;
  inputIndex: number;
};

function overlayLocation(overlay: VfsOverlayIntent, inputIndex: number, mutationIndex?: number): OverlayLocation {
  return {
    overlayId: overlay.id,
    overlayOrder: overlay.order,
    overlayIndex: inputIndex,
    ...(mutationIndex === undefined ? {} : { mutationIndex }),
  };
}

function rejectOverlay(
  location: OverlayLocation,
  code: VfsOverlayPlanningDiagnosticCode,
  path: string,
  message: string,
  cause?: unknown,
): VfsOverlayPlanningRejection {
  return {
    status: "rejected",
    diagnostics: [diagnostic(location, new OverlayPlanningFailure(code, path, message), cause)],
  };
}

function validateAndOrderOverlays(overlays: readonly VfsOverlayIntent[]): IndexedOverlay[] | VfsOverlayPlanningRejection {
  const indexed: IndexedOverlay[] = [];
  const ids = new Map<string, number>();

  for (let inputIndex = 0; inputIndex < overlays.length; inputIndex += 1) {
    const overlay = overlays[inputIndex] as VfsOverlayIntent | undefined;
    const fallbackLocation: OverlayLocation = {
      overlayId: typeof overlay?.id === "string" ? overlay.id : "<invalid>",
      overlayOrder: typeof overlay?.order === "number" ? overlay.order : Number.NaN,
      overlayIndex: inputIndex,
    };

    if (!overlay || typeof overlay.id !== "string" || overlay.id.length === 0 || !Number.isInteger(overlay.order)) {
      return rejectOverlay(
        fallbackLocation,
        "INVALID_OVERLAY",
        VFS_ROOT,
        `Overlay at index ${inputIndex} requires a non-empty id and integer order`,
      );
    }
    if (overlay.kind !== "directory" && overlay.kind !== "mutations") {
      return rejectOverlay(
        fallbackLocation,
        "INVALID_OVERLAY_KIND",
        VFS_ROOT,
        `Overlay ${fallbackLocation.overlayId} at index ${inputIndex} has unsupported kind ${JSON.stringify((overlay as unknown as { kind?: unknown }).kind)}`,
      );
    }
    if (overlay.kind === "directory" && (!overlay.snapshot || typeof overlay.snapshot !== "object")) {
      return rejectOverlay(
        fallbackLocation,
        "INVALID_OVERLAY",
        VFS_ROOT,
        `Directory overlay ${overlay.id} at index ${inputIndex} requires a snapshot`,
      );
    }
    if (overlay.kind === "mutations" && !Array.isArray(overlay.mutations)) {
      return rejectOverlay(
        fallbackLocation,
        "INVALID_OVERLAY",
        VFS_ROOT,
        `Mutation overlay ${overlay.id} at index ${inputIndex} requires a mutations array`,
      );
    }
    if (ids.has(overlay.id)) {
      return rejectOverlay(
        fallbackLocation,
        "DUPLICATE_OVERLAY_ID",
        VFS_ROOT,
        `Overlay id ${JSON.stringify(overlay.id)} is duplicated at indexes ${ids.get(overlay.id)} and ${inputIndex}`,
      );
    }
    ids.set(overlay.id, inputIndex);
    indexed.push({ overlay, inputIndex });
  }

  const ordered = [...indexed].sort((left, right) => left.overlay.order - right.overlay.order);
  const first = ordered[0];
  if (first && first.overlay.order !== 0) {
    return rejectOverlay(
      overlayLocation(first.overlay, first.inputIndex),
      "INVALID_OVERLAY_ORDER",
      VFS_ROOT,
      `Overlay ${first.overlay.id} order ${first.overlay.order} must start the overlay stack at order 0`,
    );
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.overlay.order !== previous.overlay.order + 1) {
      const relation = current.overlay.order === previous.overlay.order ? "duplicates" : "is not contiguous after";
      return rejectOverlay(
        overlayLocation(current.overlay, current.inputIndex),
        "INVALID_OVERLAY_ORDER",
        VFS_ROOT,
        `Overlay ${current.overlay.id} order ${current.overlay.order} ${relation} ${previous.overlay.id} order ${previous.overlay.order}`,
      );
    }
  }
  return ordered;
}

function isRejectedOrdering(value: IndexedOverlay[] | VfsOverlayPlanningRejection): value is VfsOverlayPlanningRejection {
  return !Array.isArray(value);
}

/**
 * Plans a complete overlay stack on an isolated working snapshot. Input order
 * does not affect semantics: declared contiguous `order` is authoritative.
 * Only the final candidate is diffed against the caller base to form the
 * canonical VFS and strict XNL mutation batches.
 */
export function planVfsOverlays(base: DataElementNode, overlays: readonly VfsOverlayIntent[]): VfsOverlayPlanningResult {
  const ordered = validateAndOrderOverlays(overlays);
  if (isRejectedOrdering(ordered)) {
    return ordered;
  }

  let working = clone(base);
  const provenance: VfsOverlayProvenance[] = [];

  for (const { overlay, inputIndex } of ordered) {
    if (overlay.kind === "directory") {
      const result = planSparseDirectoryOverlay(working, overlay, { overlayIndex: inputIndex });
      if (result.status === "rejected") {
        return result;
      }
      working = result.plan.candidate;
      provenance.push({
        overlayId: overlay.id,
        overlayOrder: overlay.order,
        overlayIndex: inputIndex,
        kind: overlay.kind,
        mutations: clone(result.plan.mutations),
      });
      continue;
    }

    const applied: VfsMutation[] = [];
    for (let mutationIndex = 0; mutationIndex < overlay.mutations.length; mutationIndex += 1) {
      const mutationInput: unknown = overlay.mutations[mutationIndex];
      const location = overlayLocation(overlay, inputIndex, mutationIndex);
      if (!isVfsMutation(mutationInput)) {
        const malformedPath =
          mutationInput && typeof mutationInput === "object" && typeof (mutationInput as { path?: unknown }).path === "string"
            ? ((mutationInput as { path: string }).path)
            : VFS_ROOT;
        return rejectOverlay(
          location,
          "MUTATION_REJECTED",
          malformedPath,
          `Explicit mutation ${mutationIndex} in overlay ${overlay.id} is malformed`,
        );
      }
      const mutation = mutationInput;
      try {
        working = applyVfsSnapshotMutations(working, [mutation]);
        applied.push(clone(mutation));
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return rejectOverlay(
          location,
          "MUTATION_REJECTED",
          mutation.path,
          `Explicit mutation ${mutationIndex} in overlay ${overlay.id} rejected: ${detail}`,
          cause,
        );
      }
    }
    provenance.push({
      overlayId: overlay.id,
      overlayOrder: overlay.order,
      overlayIndex: inputIndex,
      kind: overlay.kind,
      mutations: applied,
    });
  }

  try {
    const mutations = diffVfsSnapshots(base, working);
    const xnlMutations = toXnlMutations(base, mutations);
    return {
      status: "planned",
      plan: {
        candidate: working,
        mutations,
        xnlMutations,
        overlays: provenance,
      },
    };
  } catch (cause) {
    const final = ordered.at(-1);
    const location = final
      ? overlayLocation(final.overlay, final.inputIndex)
      : { overlayId: "<overlay-stack>", overlayOrder: 0, overlayIndex: -1 };
    const detail = cause instanceof Error ? cause.message : String(cause);
    return rejectOverlay(
      location,
      "PLANNING_FAILED",
      VFS_ROOT,
      `Final overlay candidate could not be translated: ${detail}`,
      cause,
    );
  }
}

export interface PublishRevisionedVfsOverlayPlanInput {
  readonly base: RevisionedVfsSnapshot;
  readonly plan: VfsOverlayPlan;
  readonly mutationOptions?: ApplyRevisionedVfsMutationsInput["mutationOptions"];
}

export interface MaterializeRevisionedVfsOverlaysInput {
  readonly base: RevisionedVfsSnapshot;
  readonly overlays: readonly VfsOverlayIntent[];
  readonly mutationOptions?: ApplyRevisionedVfsMutationsInput["mutationOptions"];
}

export type RevisionedVfsOverlayMaterializationResult =
  | {
      readonly status: "applied";
      readonly phase: "persistence";
      readonly snapshot: DataElementNode;
      readonly receipt: RevisionedVfsReceipt;
      readonly plan: VfsOverlayPlan;
    }
  | {
      readonly status: "unchanged";
      readonly phase: "persistence";
      readonly snapshot: DataElementNode;
      readonly revision: VfsRevision;
      readonly plan: VfsOverlayPlan;
    }
  | {
      readonly status: "conflict";
      readonly phase: "persistence";
      readonly actualRevision: VfsRevision;
      readonly plan: VfsOverlayPlan;
    }
  | {
      readonly status: "rejected";
      readonly phase: "planning";
      readonly overlays: VfsOverlayIntent[];
      readonly diagnostics: VfsOverlayPlanningDiagnostic[];
    }
  | {
      readonly status: "rejected";
      readonly phase: "mutation";
      readonly base: RevisionedVfsSnapshot;
      readonly diagnostics: readonly XnlMutationDiagnostic[];
      readonly plan: VfsOverlayPlan;
    }
  | {
      readonly status: "failed";
      readonly phase: "persistence";
      readonly actualRevision: VfsRevision;
      readonly diagnostics: readonly RevisionedPersistenceDiagnostic[];
      readonly plan: VfsOverlayPlan;
    };

/**
 * Publishes an already planned complete candidate through the existing strict
 * mutation coordinator. This function creates no second persistence authority:
 * dry-run rejection and CAS semantics remain owned by
 * `applyRevisionedVfsMutations`.
 */
export async function publishRevisionedVfsOverlayPlan(
  authority: RevisionedVfsAuthority,
  input: PublishRevisionedVfsOverlayPlanInput,
): Promise<RevisionedVfsOverlayMaterializationResult> {
  const plan = clone(input.plan);
  const result = await applyRevisionedVfsMutations(authority, {
    base: input.base,
    mutations: plan.xnlMutations,
    ...(input.mutationOptions === undefined ? {} : { mutationOptions: input.mutationOptions }),
  });

  switch (result.status) {
    case "applied":
      return {
        status: result.status,
        phase: "persistence",
        snapshot: result.snapshot,
        receipt: result.receipt,
        plan,
      };
    case "unchanged":
      return {
        status: result.status,
        phase: "persistence",
        snapshot: result.snapshot,
        revision: result.revision,
        plan,
      };
    case "conflict":
      return {
        status: result.status,
        phase: "persistence",
        actualRevision: result.actualRevision,
        plan,
      };
    case "rejected":
      return {
        status: result.status,
        phase: "mutation",
        base: result.base,
        diagnostics: result.diagnostics,
        plan,
      };
    case "failed":
      return {
        status: result.status,
        phase: "persistence",
        actualRevision: result.actualRevision,
        diagnostics: result.diagnostics,
        plan,
      };
  }
}

/**
 * Plans and atomically publishes an overlay stack against the caller-provided
 * revisioned base. Planning is pure and completes before the authority is
 * invoked, so planning rejection performs zero authority reads or writes.
 */
export async function materializeRevisionedVfsOverlays(
  authority: RevisionedVfsAuthority,
  input: MaterializeRevisionedVfsOverlaysInput,
): Promise<RevisionedVfsOverlayMaterializationResult> {
  const planning = planVfsOverlays(input.base.snapshot, input.overlays);
  if (planning.status === "rejected") {
    return {
      status: "rejected",
      phase: "planning",
      overlays: clone([...input.overlays]),
      diagnostics: clone(planning.diagnostics),
    };
  }

  return publishRevisionedVfsOverlayPlan(authority, {
    base: input.base,
    plan: planning.plan,
    ...(input.mutationOptions === undefined ? {} : { mutationOptions: input.mutationOptions }),
  });
}
