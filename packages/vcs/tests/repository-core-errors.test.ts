import { describe, expect, it } from "vitest";
import { VcsError } from "../src/errors";
import { Repository } from "../src/repository";

describe("repository core errors", () => {
  it("blocks checkout on dirty working tree without force", () => {
    const repo = new Repository();
    repo.init();
    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/a.txt", "a", { fileType: "text" });
    const first = repo.commit("first");

    repo.vfs.writeFile("vfs:///src/a.txt", "b", { overwrite: true, fileType: "text" });

    expect(() => repo.checkout(first)).toThrowError(VcsError);
    try {
      repo.checkout(first);
    } catch (err) {
      expect((err as VcsError).code).toBe("EDIRTYWORKTREE");
    }
  });
});
