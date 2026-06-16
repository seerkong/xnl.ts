import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("merge fast-forward", () => {
  it("moves head without creating merge commit", () => {
    const repo = new Repository();
    repo.init();
    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/a.ts", "export const a = 1;", { fileType: "text" });
    repo.commit("base");

    repo.createBranch("feature");
    repo.checkout("feature");
    repo.vfs.writeFile("vfs:///src/feature.ts", "export const feature = 1;", { fileType: "text" });
    const featureTip = repo.commit("feature commit");

    repo.checkout("main");
    const before = repo.log(10, "main").length;

    const merged = repo.merge("feature");
    const after = repo.log(10, "main").length;

    expect(merged.kind).toBe("fast_forward");
    expect(merged.commitId).toBe(featureTip);
    expect(after).toBe(before + 1);
    expect(repo.getBranchHead("main")).toBe(featureTip);
    expect(repo.vfs.readFile("vfs:///src/feature.ts")).toBe("export const feature = 1;");
  });
});
