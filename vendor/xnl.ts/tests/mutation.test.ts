import { describe, expect, it } from "vitest";
import { parseXnl } from "../src/parser";
import { applyMutations, diffNodes, XnlMutation } from "../src/mutation";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resources = path.join(__dirname, "resources");

describe("mutation protocol", () => {
  const oldDoc = parseXnl(fs.readFileSync(path.join(resources, "mutation-old.xnl"), "utf8")).nodes[0];
  const newDoc = parseXnl(fs.readFileSync(path.join(resources, "mutation-new.xnl"), "utf8")).nodes[0];

  it("diffs additions and metadata updates", () => {
    const mutations = diffNodes(oldDoc, newDoc, "#flow1");
    const add = mutations.find((m) => m.type === "TREE_ADD") as XnlMutation;
    expect(add?.path).toEqual([
      { type: "UniqueName", value: "flow1" },
      { type: "InstanceProperty", value: "body" },
      { type: "ListIndex", value: "1" },
    ]);
    const statusUpdate = mutations.find((m) => m.type === "OBJECT_UPDATE" && (m.path as any[])[2].value === "status");
    expect(statusUpdate).toBeTruthy();
  });

  it("applies mutations to reach target", () => {
    const mutations = diffNodes(oldDoc, newDoc, "#flow1");
    const clone = JSON.parse(JSON.stringify(oldDoc));
    const applied = applyMutations(clone, mutations);
    expect(applied).toEqual(newDoc);
  });
});
