import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("merge three-way", () => {
  it("auto-merges non-overlapping changes and creates merge commit", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/a.txt", "A0", { fileType: "text" });
    repo.vfs.writeFile("vfs:///src/b.txt", "B0", { fileType: "text" });
    repo.commit("base");

    repo.createBranch("feature");

    repo.vfs.writeFile("vfs:///src/a.txt", "A1-main", { overwrite: true, fileType: "text" });
    const mainTip = repo.commit("main change");

    repo.checkout("feature");
    repo.vfs.writeFile("vfs:///src/b.txt", "B1-feature", { overwrite: true, fileType: "text" });
    const featureTip = repo.commit("feature change");

    repo.checkout("main");
    const result = repo.merge("feature");
    expect(result.kind).toBe("merged");
    expect(result.commitId).toBeTruthy();

    const log = repo.log(1, "HEAD");
    expect(log[0]?.parents.sort()).toEqual([mainTip, featureTip].sort());
    expect(repo.vfs.readFile("vfs:///src/a.txt")).toBe("A1-main");
    expect(repo.vfs.readFile("vfs:///src/b.txt")).toBe("B1-feature");
    expect(repo.status().clean).toBe(true);
  });
});
