import { describe, expect, it } from "vitest";
import { XNL, diffNodes, dryRunMutations, parseXnl, stringifyLiteral, type DataElementNode } from "../src/index";

const parse = (source: string) => parseXnl(source).nodes[0] as DataElementNode;
const strict = { verifyValueBefore: true, identityPolicy: "require-elements" } as const;
const before = `<Catalog #catalog [
  <Entry #entry-a { name = "Alpha" rules = [{ allow = true scopes = ["read" "write"] limit = 2 }] }>
  <Entry #entry-b { name = "Beta" rules = [] }>
]>`;

describe("native structured editing public conformance", () => {
  it("roundtrips native objects/arrays and reorders stable identities while editing nested values", () => {
    const base = parse(before);
    const target = parse(`<Catalog #catalog [
      <Entry #entry-b { name = "Beta" rules = [] }>
      <Entry #entry-a { name = "Renamed" rules = [{ allow = false scopes = ["read"] limit = 3 }] }>
    ]>`);
    expect(parse(XNL.stringify({ nodes: [base] }))).toEqual(base);
    const mutations = diffNodes(base, target);
    expect(mutations.some((m) => m.type.startsWith("TREE_MOVE"))).toBe(true);
    expect(mutations.some((m) => String(m.path).endsWith(":id"))).toBe(false);
    const result = dryRunMutations(base, mutations, strict);
    expect(result.status).toBe("applied");
    expect(result.value).toEqual(target);
    expect(base).toEqual(parse(before));
  });

  it("checks diff-generated nested scalar preconditions and rejects the entire batch", () => {
    const base = parse(before);
    const local = parse(before.replace('name = "Alpha"', 'name = "Local"').replace("limit = 2", "limit = 3"));
    const remote = parse(before.replace("limit = 2", "limit = 7"));
    const mutations = diffNodes(base, local);
    const result = dryRunMutations(remote, mutations, strict);
    expect(result.status).toBe("rejected");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
    expect(result.value).toEqual(remote);
    expect(remote).toEqual(parse(before.replace("limit = 2", "limit = 7")));
  });

  it("replays independent scalar edits without treating unrelated remote fields as stale", () => {
    const base = parse(before);
    const local = parse(before.replace('name = "Alpha"', 'name = "Local"'));
    const remote = parse(before.replace("limit = 2", "limit = 7"));
    const result = dryRunMutations(remote, diffNodes(base, local), strict);
    expect(result.status).toBe("applied");
    expect(result.value).toEqual(parse(before.replace('name = "Alpha"', 'name = "Local"').replace("limit = 2", "limit = 7")));
  });

  it("handles native nested kind changes with whole-value preconditions", () => {
    const base = parse(`<Config #config { value = { threshold = 2 } list = [true { enabled = true }] }>`);
    const target = parse(`<Config #config { value = ["a" "b"] list = ["yes" null] }>`);
    const changes = diffNodes(base, target);
    expect(dryRunMutations(base, changes, strict)).toMatchObject({ status: "applied", value: target });
    const remote = parse(`<Config #config { value = { threshold = 9 } list = [true { enabled = true }] }>`);
    expect(dryRunMutations(remote, changes, strict)).toMatchObject({ status: "rejected", value: remote });
  });

  it("updates reserved literal keys without traversing prototypes", () => {
    const base = parse('<Config #config { data = {} }>');
    const target = parse('<Config #config { data = { "__proto__" = { value = 3 } "constructor" = { prototype = { value = 4 } } } }>');
    const result = dryRunMutations(base, diffNodes(base, target), strict);
    expect(result).toMatchObject({ status: "applied", value: target });
    expect(Object.prototype).not.toHaveProperty("value");
    expect(Object.getPrototypeOf((result.value as DataElementNode).attributes!.data)).toBe(Object.prototype);
  });

  it("supports primitive root values with generated expected values", () => {
    const mutations = diffNodes(2, 3);
    expect(dryRunMutations(2, mutations, strict)).toMatchObject({ status: "applied", value: 3 });
    expect(dryRunMutations(7, mutations, strict)).toMatchObject({ status: "rejected", value: 7 });
  });

  it("does not mistake an ordinary kind and tag payload for an AST element", () => {
    const base = parse('<Config #config { rules={kind="DataElement" tag="literal" nested=[null {enabled=false}]} }>');
    const target = parse('<Config #config { rules={kind="DataElement" tag="literal" nested=[null {enabled=true}]} }>');
    expect(dryRunMutations(base, diffNodes(base, target), strict)).toMatchObject({ status: "applied", value: target });
    expect(parse(XNL.stringify({ nodes: [target] }))).toEqual(target);
  });

  it("keeps quote and backslash keys addressable through generated mutations", () => {
    const base = parse(`<Config #config { rules=${stringifyLiteral({ "a'b\\c": 1 })} }>`);
    const target = parse(`<Config #config { rules=${stringifyLiteral({ "a'b\\c": 2 })} }>`);
    expect(dryRunMutations(base, diffNodes(base, target), strict)).toMatchObject({ status: "applied", value: target });
  });
});
