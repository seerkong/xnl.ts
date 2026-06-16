import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("log and diff determinism", () => {
  it("returns stable log and diff outputs", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/a.ts", "export const a = 1;", { fileType: "text" });
    const c1 = repo.commit("c1");

    repo.vfs.writeFile("vfs:///src/a.ts", "export const a = 2;", { overwrite: true, fileType: "text" });
    repo.vfs.writeFile("vfs:///src/b.ts", "export const b = true;", { fileType: "text" });
    const c2 = repo.commit("c2");

    const log1 = repo.log(10, c2);
    const log2 = repo.log(10, c2);
    expect(log1).toEqual(log2);
    expect(log1[0]?.id).toBe(c2);

    const limited = repo.log(1, c2);
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe(c2);

    const diff1 = repo.diff(c1, c2);
    const diff2 = repo.diff(c1, c2);
    expect(diff1).toEqual(diff2);
    expect(diff1.map((item) => item.path)).toEqual(["vfs:///src/a.ts", "vfs:///src/b.ts"]);
  });
});
