import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("merge conflicts", () => {
  it("surfaces rename/rename conflict with both candidate paths", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/name.ts", "export const n = 1;", { fileType: "text" });
    const base = repo.commit("base");

    repo.createBranch("feature", base);

    repo.vfs.rename("vfs:///src/name.ts", "vfs:///src/name-main.ts");
    repo.commit("main rename");

    repo.checkout("feature");
    repo.vfs.rename("vfs:///src/name.ts", "vfs:///src/name-feature.ts");
    repo.commit("feature rename");

    repo.checkout("main", { force: true });
    const conflict = repo.merge("feature");
    expect(conflict.kind).toBe("conflict");
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts?.[0]?.type).toBe("RENAME_RENAME");
    expect(conflict.conflicts?.[0]?.oursPath).toBe("vfs:///src/name-main.ts");
    expect(conflict.conflicts?.[0]?.theirsPath).toBe("vfs:///src/name-feature.ts");

    const resolved = repo.merge("feature", {
      resolutions: [
        {
          metadataId: conflict.conflicts?.[0]?.metadataId ?? "",
          choice: "theirs",
        },
      ],
    });

    expect(resolved.kind).toBe("merged");
    expect(repo.vfs.exists("vfs:///src/name-feature.ts")).toBe(true);
    expect(repo.vfs.exists("vfs:///src/name-main.ts")).toBe(false);
    expect(repo.status().clean).toBe(true);
  });

  it("surfaces binary conflict when both sides modify binary payload", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///bin", { recursive: true });
    repo.vfs.writeFile("vfs:///bin/app.bin", "AAA", { fileType: "binary" });
    repo.commit("base");

    repo.createBranch("feature");

    repo.vfs.writeFile("vfs:///bin/app.bin", "BBB", { overwrite: true, fileType: "binary" });
    repo.commit("main bin");

    repo.checkout("feature");
    repo.vfs.writeFile("vfs:///bin/app.bin", "CCC", { overwrite: true, fileType: "binary" });
    repo.commit("feature bin");

    repo.checkout("main", { force: true });
    const outcome = repo.merge("feature");
    expect(outcome.kind).toBe("conflict");
    expect(outcome.conflicts?.[0]?.type).toBe("BINARY_UNMERGEABLE");
  });

  it("surfaces delete/modify conflict and resolves to clean state", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/conflict.txt", "base", { fileType: "text" });
    const base = repo.commit("base");

    repo.createBranch("feature", base);

    repo.vfs.unlink("vfs:///src/conflict.txt");
    repo.commit("main delete");

    repo.checkout("feature", { force: true });
    repo.vfs.writeFile("vfs:///src/conflict.txt", "feature edit", { overwrite: true, fileType: "text" });
    repo.commit("feature modify");

    repo.checkout("main", { force: true });
    const conflict = repo.merge("feature");
    expect(conflict.kind).toBe("conflict");
    expect(conflict.conflicts?.[0]?.type).toBe("DELETE_MODIFY");

    const resolved = repo.merge("feature", {
      resolutions: [
        {
          metadataId: conflict.conflicts?.[0]?.metadataId ?? "",
          choice: "theirs",
        },
      ],
    });

    expect(resolved.kind).toBe("merged");
    expect(repo.vfs.readFile("vfs:///src/conflict.txt")).toBe("feature edit");
    expect(repo.status().clean).toBe(true);
  });
});
