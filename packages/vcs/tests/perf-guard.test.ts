import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("performance guard", () => {
  it("handles 1k file synthetic repo within threshold", () => {
    const repo = new Repository();
    repo.init();
    repo.vfs.mkdir("vfs:///src", { recursive: true });

    const count = 1000;
    const start = Date.now();

    for (let i = 0; i < count; i++) {
      repo.vfs.writeFile(`vfs:///src/f-${String(i).padStart(4, "0")}.ts`, `export const n${i} = ${i};`, {
        fileType: "text",
      });
    }

    repo.status();
    repo.commit("perf baseline");

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
  });
});
