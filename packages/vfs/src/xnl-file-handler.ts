import { applyMutations, diffNodes, parseXnl, type XnlDocument, type XnlMutation, XNL } from "xnl-core";
import { mergeDocuments3 } from "xnl-collab-core";
import { VfsError } from "./errors";
import type { FileTypeHandler } from "./handlers";
import type { XnlDiff } from "./types";

function normalizeXnlMoves(mutations: XnlMutation[]): XnlMutation[] {
  return mutations.map((mutation) => {
    if (mutation.type === "TREE_MOVE_SAME_LEVEL" || mutation.type === "TREE_MOVE_CROSS_LEVEL") {
      return {
        ...mutation,
        type: "TREE_MOVE",
      };
    }
    return mutation;
  });
}

function parseDocument(content: string): XnlDocument {
  return parseXnl(content);
}

export const xnlFileHandler: FileTypeHandler<XnlDiff, { merged: string }> = {
  type: "xnl",
  parse(content: string): XnlDocument {
    return parseDocument(content);
  },
  serialize(value: unknown): string {
    const doc = value as XnlDocument;
    return XNL.stringify(doc);
  },
  diff(base: string, next: string): XnlDiff {
    const baseDoc = parseDocument(base);
    const nextDoc = parseDocument(next);
    const mutations = diffNodes(baseDoc.nodes, nextDoc.nodes, [], { metadataIdMode: "identity" });
    return normalizeXnlMoves(mutations);
  },
  apply(base: string, diff: XnlDiff): string {
    const baseDoc = parseDocument(base);
    const cloned = JSON.parse(JSON.stringify(baseDoc.nodes));
    const next = applyMutations(cloned, diff, { metadataIdMode: "identity" });
    if (!Array.isArray(next)) {
      throw new VfsError("EINVAL", "XNL apply result must keep array root");
    }
    return XNL.stringify({ nodes: next });
  },
  merge(base: string, ours: string, theirs: string): { merged: string } {
    const result = mergeDocuments3(base, ours, theirs);
    return { merged: result.text };
  },
};
