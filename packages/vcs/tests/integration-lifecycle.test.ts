import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";

describe("integration lifecycle", () => {
  it("covers init -> file ops -> commit -> branch -> merge -> resolve -> log/diff/status", () => {
    const repo = new Repository();
    repo.init();

    repo.vfs.mkdir("vfs:///src", { recursive: true });
    repo.vfs.writeFile("vfs:///src/main.ts", "export const a = 1;", { fileType: "text" });
    repo.vfs.writeFile("vfs:///src/state.xnl", `<state id="s1" [ <item id="i1"> ]>`, { fileType: "xnl" });
    const base = repo.commit("base");

    repo.createBranch("feature", base);

    repo.vfs.writeFile("vfs:///src/main.ts", "export const a = 2;", { overwrite: true, fileType: "text" });
    const mainTip = repo.commit("main update");

    repo.checkout("feature");
    repo.vfs.writeFile("vfs:///src/feature.ts", "export const feature = true;", { fileType: "text" });
    repo.vfs.writeFile("vfs:///src/state.xnl", `<state id="s1" [ <item id="i1"> <item id="i2"> ]>`, {
      overwrite: true,
      fileType: "xnl",
    });
    const featureTip = repo.commit("feature update");

    repo.checkout("main", { force: true });
    const merge = repo.merge("feature");
    expect(merge.kind).toBe("merged");

    const log = repo.log(10, "HEAD");
    expect(log[0]?.parents.sort()).toEqual([mainTip, featureTip].sort());

    const diffBaseToHead = repo.diff(base, "HEAD");
    expect(diffBaseToHead.length).toBeGreaterThan(0);

    const status = repo.status();
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });
});
