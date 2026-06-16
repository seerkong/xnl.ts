import { applyMutations, type DataElementNode, type XnlMutation } from "xnl-core";
import { VfsError } from "./errors";
import {
  applyVfsSnapshotMutations,
  diffVfsSnapshots,
  isVfsMutation,
  toXnlMutations,
  type VfsMutation,
  type VfsMutationRuntimeOptions,
} from "./vfs-mutations";

export function diffVfs(base: DataElementNode, next: DataElementNode, options?: VfsMutationRuntimeOptions): XnlMutation[] {
  const vfsMutations = diffVfsSnapshots(base, next, options);
  return toXnlMutations(base, vfsMutations, options);
}

function isVfsMutationBatch(mutations: Array<XnlMutation | VfsMutation>): mutations is VfsMutation[] {
  return mutations.length > 0 && isVfsMutation(mutations[0]);
}

export function applyVfsMutations(
  base: DataElementNode,
  mutations: XnlMutation[] | VfsMutation[],
  options?: VfsMutationRuntimeOptions,
): DataElementNode {
  const cloned = JSON.parse(JSON.stringify(base)) as DataElementNode;
  try {
    const applied = isVfsMutationBatch(mutations)
      ? applyVfsSnapshotMutations(cloned, mutations, options)
      : (applyMutations(cloned, mutations, { metadataIdMode: "identity" }) as DataElementNode);
    if (!applied || typeof applied !== "object") {
      throw new VfsError("EINVAL", "VFS mutation apply returned non-object result");
    }
    return applied as DataElementNode;
  } catch (error) {
    throw new VfsError("EINVAL", `Failed to apply VFS mutations atomically: ${String(error)}`);
  }
}

export function applyVfsMutationsAtomically(
  base: DataElementNode,
  mutations: XnlMutation[] | VfsMutation[],
  options?: VfsMutationRuntimeOptions,
): { snapshot: DataElementNode } {
  const snapshot = applyVfsMutations(base, mutations, options);
  return { snapshot };
}
