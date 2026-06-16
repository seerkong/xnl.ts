import { describe, expect, it } from "vitest";
import { VcsError } from "../src/errors";
import { Repository } from "../src/repository";

describe("branch and history", () => {
  it("supports branch lifecycle and merge-base traversal", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 1;", { fileType: "text" });
    const base = repo.commit("base");

    repo.createBranch("feature");

    repo.vfs.writeFile("vfs:///src/main.ts", "export const v = 2;", { overwrite: true, fileType: "text" });
    const mainTip = repo.commit("main change");

    repo.checkout("feature");
    repo.vfs.writeFile("vfs:///src/feature.ts", "export const f = true;", { fileType: "text" });
    const featureTip = repo.commit("feature change");

    const mergeBase = repo.findMergeBase(mainTip, featureTip);
    expect(mergeBase).toBe(base);

    expect(repo.listBranches()).toEqual(["feature", "main"]);

    expect(() => repo.deleteBranch("feature")).toThrowError(VcsError);
    try {
      repo.deleteBranch("feature");
    } catch (error) {
      expect((error as VcsError).code).toBe("EINVAL");
    }

    repo.checkout("main");
    repo.deleteBranch("feature");
    expect(repo.listBranches()).toEqual(["main"]);
  });
});
