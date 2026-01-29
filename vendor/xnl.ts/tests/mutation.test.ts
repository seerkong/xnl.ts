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

  describe("metadataIdMode", () => {
    it("diffNodes ignores metadata.id in identity mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a id="m2">`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "identity" });
      expect(mutations).toEqual([]);
    });

    it("diffNodes includes metadata.id in metadata mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a id="m2">`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "metadata" });
      expect(mutations).toEqual([
        {
          type: "OBJECT_UPDATE",
          path: [
            { type: "InstanceProperty", value: "metadata" },
            { type: "MapKey", value: "id" },
          ],
          valueAfter: "m2",
        },
      ]);
    });

    it("applyMutations ignores metadata.id updates in identity mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a id="m2">`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "metadata" });
      const oldJson = JSON.parse(JSON.stringify(oldNode));

      const clone = JSON.parse(JSON.stringify(oldNode));
      const applied = applyMutations(clone, mutations, { metadataIdMode: "identity" });

      expect(applied).toEqual(oldJson);
    });

    it("applyMutations applies metadata.id updates in metadata mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a id="m2">`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "metadata" });
      const newJson = JSON.parse(JSON.stringify(newNode));

      const clone = JSON.parse(JSON.stringify(oldNode));
      const applied = applyMutations(clone, mutations, { metadataIdMode: "metadata" });

      expect(applied).toEqual(newJson);
    });

    it("applyMutations ignores metadata.id deletes in identity mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a>`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "metadata" });
      const oldJson = JSON.parse(JSON.stringify(oldNode));

      const clone = JSON.parse(JSON.stringify(oldNode));
      const applied = applyMutations(clone, mutations, { metadataIdMode: "identity" });

      expect(applied).toEqual(oldJson);
    });

    it("applyMutations applies metadata.id deletes in metadata mode", () => {
      const oldNode = parseXnl(`<a id="m1">`).nodes[0];
      const newNode = parseXnl(`<a>`).nodes[0];

      const mutations = diffNodes(oldNode, newNode, [], { metadataIdMode: "metadata" });
      const newJson = JSON.parse(JSON.stringify(newNode));

      const clone = JSON.parse(JSON.stringify(oldNode));
      const applied = applyMutations(clone, mutations, { metadataIdMode: "metadata" });

      expect(applied).toEqual(newJson);
    });
  });
});
