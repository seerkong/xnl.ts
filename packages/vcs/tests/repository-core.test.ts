import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("repository core", () => {
  it("supports init -> commit -> checkout lifecycle", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/main.ts", "export const a = 1;", { fileType: "text" });

    const first = repo.commit("initial", { author: "tester" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repo.getHead()).toEqual({ type: "branch", name: "main" });

    repo.vfs.writeFile("vfs:///src/main.ts", "export const a = 2;", { overwrite: true, fileType: "text" });
    const second = repo.commit("update", { author: "tester" });
    expect(second).not.toBe(first);

    repo.checkout(first);
    expect(repo.vfs.readFile("vfs:///src/main.ts")).toBe("export const a = 1;");
    expect(repo.getHead()).toEqual({ type: "detached", commitId: first });
  });

  it("reports status changes accurately", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/a.txt", "A", { fileType: "text" });
    const baseCommit = repo.commit("base");

    repo.vfs.writeFile("vfs:///src/a.txt", "A2", { overwrite: true, fileType: "text" });
    repo.vfs.writeFile("vfs:///src/b.txt", "B", { fileType: "text" });
    repo.vfs.writeFile("vfs:///src/c.txt", "C", { fileType: "text" });
    repo.commit("temp");

    repo.checkout(baseCommit, { force: true });
    repo.vfs.writeFile("vfs:///src/a.txt", "A2", { overwrite: true, fileType: "text" });
    repo.vfs.writeFile("vfs:///src/b.txt", "B", { fileType: "text" });

    const status = repo.status();
    expect(status.modified).toEqual(["vfs:///src/a.txt"]);
    expect(status.added).toEqual(["vfs:///src/b.txt"]);
    expect(status.deleted).toEqual([]);
    expect(status.clean).toBe(false);
  });
});
