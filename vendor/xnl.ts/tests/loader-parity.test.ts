import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { batchLoad } from "../src/loader";
import { parseXnl } from "../src/parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resources = path.join(__dirname, "resources");

const isDataElement = (node: any): node is { kind: string } => node && node.kind === "DataElement";

describe("loader parity with typed prefabs and removals", () => {
  it("resolves typed prefabs, scoped lookup, and remove markers", () => {
    const input = fs.readFileSync(path.join(resources, "loader-parity.xnl"), "utf8");
    const { nodes } = parseXnl(input);
    const batches = [nodes.filter(isDataElement)];
    const { resolved } = batchLoad(batches as any);
    const root = resolved[0][0] as any;

    const fieldB = root.attributes.fieldB;
    const resolvedB = fieldB.key1;
    expect(resolvedB.attributes.key1).toBe("value1_override");
    expect(resolvedB.attributes.key2).toBeUndefined();
    expect(resolvedB.attributes.nested.field2).toBeUndefined();
    expect(resolvedB.attributes.nested.field3.deep1).toBe("new_deep1");
    expect(resolvedB.attributes.nested.field3.deep2).toBeUndefined();

    const fieldC = root.attributes.fieldC[0];
    expect(fieldC.attributes.key4).toBe("value4");
    expect(fieldC.attributes.key5).toBe("value5");

    const nodeA = (root.body ?? [])[0];
    const keyM = nodeA.attributes.key_m;
    expect(keyM.attributes.key2).toBe("value2");
    expect(keyM.attributes.key3).toBe("value3");
    const keyN = nodeA.attributes.key_n;
    expect(keyN.attributes.key3).toBe("value3");
  });
});
