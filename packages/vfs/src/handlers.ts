import { createHash } from "node:crypto";
import { applyMutations, diffNodes, parseXnl, type XnlDocument, type XnlMutation, XNL } from "xnl-core";
import { mergeDocuments3 } from "xnl-collab-core";
import { diffLines } from "diff";
import { VfsError } from "./errors";
import type { BinaryDiff, BinaryMergeConflict, TextDiffChunk, VfsFileType, XnlDiff } from "./types";

export interface FileTypeHandler<DiffT, MergeT> {
  readonly type: VfsFileType;
  parse(content: string): unknown;
  serialize(value: unknown): string;
  diff(base: string, next: string): DiffT;
  apply(base: string, diff: DiffT): string;
  merge(base: string, ours: string, theirs: string): MergeT;
}

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

function chunksToText(chunks: TextDiffChunk[]): string {
  let out = "";
  for (const chunk of chunks) {
    if (chunk.op === "insert" || chunk.op === "equal") {
      out += chunk.text;
    }
  }
  return out;
}

function mergeTextNonOverlapping(base: string, ours: string, theirs: string): { merged: string; conflict: boolean } {
  if (ours === theirs) {
    return { merged: ours, conflict: false };
  }
  if (ours === base) {
    return { merged: theirs, conflict: false };
  }
  if (theirs === base) {
    return { merged: ours, conflict: false };
  }

  const baseLines = base.split("\n");
  const oursLines = ours.split("\n");
  const theirsLines = theirs.split("\n");
  const max = Math.max(baseLines.length, oursLines.length, theirsLines.length);
  const merged: string[] = [];

  for (let i = 0; i < max; i++) {
    const b = baseLines[i] ?? "";
    const o = oursLines[i] ?? "";
    const t = theirsLines[i] ?? "";

    if (o === t) {
      merged.push(o);
      continue;
    }
    if (o === b) {
      merged.push(t);
      continue;
    }
    if (t === b) {
      merged.push(o);
      continue;
    }

    return { merged: theirs, conflict: true };
  }

  return { merged: merged.join("\n"), conflict: false };
}

export const textFileHandler: FileTypeHandler<TextDiffChunk[], { merged: string; conflict: boolean }> = {
  type: "text",
  parse(content: string): string {
    return content;
  },
  serialize(value: unknown): string {
    return String(value ?? "");
  },
  diff(base: string, next: string): TextDiffChunk[] {
    return diffLines(base, next).map((chunk) => {
      if (chunk.added) {
        return { op: "insert", text: chunk.value };
      }
      if (chunk.removed) {
        return { op: "delete", text: chunk.value };
      }
      return { op: "equal", text: chunk.value };
    });
  },
  apply(base: string, diff: TextDiffChunk[]): string {
    void base;
    return chunksToText(diff);
  },
  merge(base: string, ours: string, theirs: string): { merged: string; conflict: boolean } {
    return mergeTextNonOverlapping(base, ours, theirs);
  },
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const binaryFileHandler: FileTypeHandler<BinaryDiff, { merged?: string; conflict?: BinaryMergeConflict }> = {
  type: "binary",
  parse(content: string): string {
    return content;
  },
  serialize(value: unknown): string {
    return String(value ?? "");
  },
  diff(base: string, next: string): BinaryDiff {
    return {
      oldHash: sha256(base),
      newHash: sha256(next),
      replacement: next,
    };
  },
  apply(base: string, diff: BinaryDiff): string {
    if (sha256(base) === diff.newHash) {
      return base;
    }
    return diff.replacement;
  },
  merge(base: string, ours: string, theirs: string): { merged?: string; conflict?: BinaryMergeConflict } {
    if (ours === theirs) {
      return { merged: ours };
    }
    if (ours === base) {
      return { merged: theirs };
    }
    if (theirs === base) {
      return { merged: ours };
    }
    return {
      conflict: {
        type: "BINARY_UNMERGEABLE",
        base,
        ours,
        theirs,
      },
    };
  },
};

export const defaultHandlers = {
  xnl: xnlFileHandler,
  text: textFileHandler,
  binary: binaryFileHandler,
};

export function resolveHandler(type: VfsFileType): FileTypeHandler<unknown, unknown> {
  if (type === "xnl") {
    return xnlFileHandler;
  }
  if (type === "binary") {
    return binaryFileHandler;
  }
  return textFileHandler;
}
