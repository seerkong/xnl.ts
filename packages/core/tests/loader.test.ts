import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { parseXnl } from "../src/parser";
import { batchLoad } from "../src/loader";
import { wordToString } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resources = path.join(__dirname, "resources");

const isDataElement = (node: any): node is { kind: string } => node && node.kind === "DataElement";

describe("loader protocol", () => {
  it("resolves prototypes and exports", () => {
    const input = fs.readFileSync(path.join(resources, "loader.xnl"), "utf8");
    const { nodes } = parseXnl(input);
    const batches = [nodes.filter(isDataElement)];
    const { resolved, exports } = batchLoad(batches as any);
    const [main, remover] = resolved[0];
    const stepIds = (main.body ?? []).map((s: any) => wordToString((s as any).id));
    expect(main.metadata.title).toBe("Custom");
    expect(stepIds).toEqual(["s1", "removeMe", "s2"]);

    const removedIds = (remover.body ?? []).map((s: any) => wordToString((s as any).id));
    expect(removedIds).toEqual(["s1"]);

    expect(exports.Flow.rootFlow).toBeDefined();
    expect(exports.Flow.overrideRemover).toBeDefined();
  });
});
