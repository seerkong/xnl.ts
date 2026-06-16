import { describe, expect, it } from "vitest";
import { parseXnl } from "xnl-core";
import { xnlFileHandler } from "../src/handlers";

describe("xnl file handler", () => {
  it("diff returns standard XnlMutation[] and apply reaches target AST", () => {
    const base = `<root id="flow1" [ <a id="a1"> ]>`;
    const next = `<root id="flow1" [ <a id="a1"> <b id="b1"> ]>`;

    const diff = xnlFileHandler.diff(base, next);
    expect(Array.isArray(diff)).toBe(true);

    const allowed = new Set([
      "TREE_ADD",
      "TREE_DELETE",
      "TREE_MOVE",
      "TREE_UPDATE",
      "OBJECT_ADD",
      "OBJECT_DELETE",
      "OBJECT_UPDATE",
    ]);

    for (const m of diff) {
      expect(allowed.has(m.type)).toBe(true);
    }

    const applied = xnlFileHandler.apply(base, diff);
    const appliedDoc = parseXnl(applied);
    const nextDoc = parseXnl(next);
    expect(appliedDoc.nodes).toEqual(nextDoc.nodes);
  });
});
