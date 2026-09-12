import { describe, expect, it } from "vitest";
import { applyMutations, diffNodes, dryRunMutations, parseXnl, stringifyLiteral, XNL, type DataElementNode } from "../src/index";

const strict = { verifyValueBefore: true, identityPolicy: "require-elements" } as const;
const parse = (source: string) => parseXnl(source).nodes[0] as DataElementNode;
const fixtures = [
  { kind: "DataElement", tag: "Invoice", metadata: {}, business: 1 },
  { kind: "DataElement", tag: "Invoice", id: { kind: "Word", name: "invoice" }, metadata: {}, business: 1 },
  { kind: "TextElement", tag: "Invoice", metadata: {}, text: "hello", business: 1 },
  { kind: "Word", name: "hello", business: 1 },
  { kind: "Word", namespace: [], name: "hello", business: 1 },
  { kind: "Comment", value: "hello", business: 1 },
  { order: ["invoice"], children: {}, business: 1 },
];

describe("literal values retain their grammar role during structural editing", () => {
  for (const [index, literal] of fixtures.entries()) it(`preserves every business field in AST-shaped literal ${index}`, () => {
    const before = parse(`<Record #record { rules = ${stringifyLiteral(literal)} }>`);
    const after = parse(`<Record #record { rules = ${stringifyLiteral({ ...literal, business: 2 })} }>`);
    const mutations = diffNodes(before, after);
    expect(mutations.length).toBeGreaterThan(0);
    expect(dryRunMutations(before, mutations, strict)).toMatchObject({ status: "applied", value: after });
    expect(parse(XNL.stringify(before))).toEqual(before);
  });

  it("constructed and structured-cloned trees use explicit serializable literal boundaries", () => {
    const before = parse(`<Record #record { rules = ${stringifyLiteral(fixtures)} }>`);
    const after = parse(`<Record #record { rules = ${stringifyLiteral(fixtures.map(value => ({ ...value, business: 2 })))} }>`);
    const transportedBefore = structuredClone(before), transportedAfter = structuredClone(after);
    const context = { ...strict, literalValuePaths: ["#record:attributes"] };
    const changes = diffNodes(transportedBefore, transportedAfter, [], context);
    expect(changes.length).toBeGreaterThan(0);
    expect(dryRunMutations(transportedBefore, structuredClone(changes), context)).toMatchObject({ status: "applied", value: transportedAfter });
    expect(applyMutations(structuredClone(transportedBefore), structuredClone(changes), context)).toEqual(transportedAfter);
    expect(transportedBefore).toEqual(before);
  });

  it("exact AST shapes stay data, including identity-shaped edits and incoherent extend-shaped maps", () => {
    const literal = { kind: "DataElement", tag: "Invoice", id: { kind: "Word", namespace: [], name: "old" },
      metadata: { id: "fallback" }, attributes: { kind: "Word", namespace: [], name: "reference" },
      extend: { order: ["missing"], children: {} } };
    const changed = { ...literal, id: { ...literal.id, name: "new" }, tag: "Other", metadata: { id: "changed" } };
    const before = parse(`<Record #record { rules = ${stringifyLiteral(literal)} duplicate = ${stringifyLiteral(literal)} }>`);
    const after = parse(`<Record #record { rules = ${stringifyLiteral(changed)} duplicate = ${stringifyLiteral(literal)} }>`);
    const result = dryRunMutations(before, diffNodes(before, after), strict);
    expect(result).toMatchObject({ status: "applied", value: after });
    expect(parse(XNL.stringify(result.value))).toEqual(after);
  });

  it("literal arrays reorder positionally while real AST children move by identity", () => {
    const first = { kind: "DataElement", tag: "Thing", id: { kind: "Word", namespace: [], name: "same-business-id" }, metadata: {}, value: 1 };
    const second = { ...first, value: 2 };
    const before = parse(`<Record #record { rules = ${stringifyLiteral([first, second])} } [<Item #a { value = 1 }><Item #b { value = 2 }>] >`);
    const after = parse(`<Record #record { rules = ${stringifyLiteral([second, { ...first, value: 3 }])} } [<Item #b { value = 2 }><Item #a { value = 4 }>] >`);
    const changes = diffNodes(before, after);
    expect(changes.some(change => change.type.startsWith("TREE_MOVE"))).toBe(true);
    expect(changes.some(change => change.targetUniqueName === "same-business-id")).toBe(false);
    expect(dryRunMutations(before, changes, strict)).toMatchObject({ status: "applied", value: after });
  });

  it("actual nested element and Word syntax still have AST semantics beside colliding maps", () => {
    const before = parse('<Record #record { actual = <Nested #nested { count = 1 }> reference = app.First data = { kind = "Word" namespace = ["app"] name = "First" extra = 1 } }>');
    const after = parse('<Record #record { actual = <Nested #nested { count = 2 }> reference = app.Second data = { kind = "Word" namespace = ["app"] name = "First" extra = 2 } }>');
    const result = dryRunMutations(before, diffNodes(before, after), strict);
    expect(result).toMatchObject({ status: "applied", value: after });
    expect(parse(XNL.stringify(result.value))).toEqual(after);
    const illegal = [{ type: "OBJECT_UPDATE" as const, path: "#record:attributes::'actual':id", valueAfter: { kind: "Word", namespace: [], name: "other" } }];
    expect(dryRunMutations(before, illegal, strict)).toMatchObject({ status: "rejected", value: before });
  });

  it("stable context selectors tolerate added or removed entities and do not match literal duplicate IDs", () => {
    const fake = { kind: "DataElement", tag: "Entry", id: { kind: "Word", namespace: [], name: "b" }, metadata: {}, value: 1 };
    const before = structuredClone(parse(`<Record #record [<Entry #a { rules = ${stringifyLiteral(fake)} }><Entry #gone { value = 1 }>] >`));
    const after = structuredClone(parse(`<Record #record [<Entry #b { rules = ${stringifyLiteral({ ...fake, value: 2 })} }><Entry #a { rules = ${stringifyLiteral({ ...fake, value: 3 })} }>] >`));
    const options = { ...strict, literalValuePaths: ["#record:attributes", "#a:attributes", "#b:attributes", "#gone:attributes"] };
    const changes = diffNodes(before, after, [], options);
    expect(dryRunMutations(before, structuredClone(changes), options)).toMatchObject({ status: "applied", value: after });
    expect(applyMutations(structuredClone(before), structuredClone(changes), options)).toEqual(after);
  });

  it("AST-shaped metadata and attribute dictionaries remain containers, not nested elements", () => {
    const before = parse('<Record #record kind="DataElement" tag="Meta" metadata={} { kind="Word" namespace=[] name="Attribute" business=1 }>');
    const after = parse('<Record #record kind="DataElement" tag="Meta" metadata={} { kind="Word" namespace=[] name="Attribute" business=2 }>');
    expect(dryRunMutations(before, diffNodes(before, after), strict)).toMatchObject({ status: "applied", value: after });
  });
});
