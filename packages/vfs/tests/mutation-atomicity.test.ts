import { describe, expect, it } from "vitest";
import type { XnlMutation } from "xnl-core";
import { applyVfsMutationsAtomically } from "../src/mutation-bridge";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs mutation atomicity", () => {
  it("does not partially persist when a later mutation fails", () => {
    const vfs = new VirtualFileSystem();
    vfs.mkdir("vfs:///src", { recursive: true });
    vfs.writeFile("vfs:///src/a.txt", "a", { fileType: "text" });
    const base = vfs.getSnapshot();
    const before = JSON.parse(JSON.stringify(base));

    // TREE_MOVE without targetUniqueName/pathBefore triggers an error in applyMutations.
    const mutations: XnlMutation[] = [
      {
        type: "TREE_UPDATE",
        path: ":metadata::'name'",
        valueAfter: "project",
      },
      {
        type: "TREE_MOVE",
        path: "",
      },
    ];

    expect(() => applyVfsMutationsAtomically(base, mutations)).toThrow();
    expect(base).toEqual(before);
  });
});
