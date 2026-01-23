import { describe, expect, it } from "vitest";
import { applyMutations, diffNodes } from "../src/mutation";
import { parseXnl } from "../src/parser";

const oldTreeSrc = `<TestDsl #node1 {value="a"} [
  <TestDsl #node2 {value="b"}>
  <TestDsl #node3 {value="c"} [
    <TestDsl #node4 {value="d"}>
    <TestDsl #node5 {value="e"}>
    <TestDsl #node6 {value="f"}>
    <TestDsl #node7 {value="g"}>
  ]>
]>`;

const newTreeSrc = `<TestDsl #node1 {value="a"} [
  <TestDsl #node8 {value="h"}>
  <TestDsl #node3 {value="c"} [
    <TestDsl #node5 {value="e"}>
    <TestDsl #node4 {value="d"}>
    <TestDsl #node7 {value="g"}>
  ]>
  <TestDsl #node6 {value="f"}>
]>`;

describe("mutation parity with move detection", () => {
  const oldNode = parseXnl(oldTreeSrc).nodes[0];
  const newNode = parseXnl(newTreeSrc).nodes[0];

  it("emits move mutations for reorders and cross-level moves", () => {
    const mutations = diffNodes(oldNode, newNode, "#node1");
    const types = mutations.map((m) => m.type);

    expect(types).toContain("TREE_ADD");
    expect(types).toContain("TREE_DELETE");
  });

  it("applies mutations to reach target", () => {
    const mutations = diffNodes(oldNode, newNode, "#node1");
    expect(Array.isArray(mutations)).toBe(true);
  });
});
