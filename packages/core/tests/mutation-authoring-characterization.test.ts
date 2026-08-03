import { describe, expect, it } from "vitest";
import * as mutationModule from "../src/mutation";
import { applyMutations, diffNodes } from "../src/mutation";
import type {
  XnlDryRunMutations,
  XnlMutation,
  XnlMutationBatch,
  XnlMutationBatchOptions,
  XnlMutationBatchResult,
  XnlMutationDiagnosticCode,
} from "../src/mutation";
import { parseXnl } from "../src/parser";
import type { DataElementNode, XnlNode, XnlWord } from "../src/types";

function parseOne(source: string): XnlNode {
  return parseXnl(source).nodes[0];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function dryRunMutations(
  base: XnlNode,
  mutations: XnlMutationBatch,
  options?: XnlMutationBatchOptions,
): XnlMutationBatchResult {
  const candidate = Reflect.get(mutationModule, "dryRunMutations");
  if (typeof candidate !== "function") {
    throw new Error("Expected mutation module to export strict dryRunMutations");
  }
  return (candidate as XnlDryRunMutations)(base, mutations, options);
}

function expectRejected(
  result: XnlMutationBatchResult,
  code: XnlMutationDiagnosticCode | "RESULT_STRUCTURE_INVALID",
  base: XnlNode,
  baseBefore: XnlNode,
): void {
  expect(result.status).toBe("rejected");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  expect(result.value).toEqual(baseBefore);
  expect(result.value).not.toBe(base);
  expect(base).toEqual(baseBefore);
}

function expectLegacyParity(baseSource: string, targetSource: string): XnlMutation[] {
  const base = parseOne(baseSource);
  const target = parseOne(targetSource);
  const mutations = diffNodes(base, target);
  const applied = applyMutations(clone(base), mutations);
  const preview = dryRunMutations(base, mutations);

  expect(applied).toEqual(target);
  expect(preview.status).toBe("applied");
  expect(preview.value).toEqual(target);
  expect(mutations.some(targetsElementId)).toBe(false);

  return mutations;
}

function word(name: string): XnlWord {
  return { kind: "Word", namespace: [], name };
}

function targetsElementId(mutation: XnlMutation): boolean {
  if (typeof mutation.path === "string") {
    return mutation.path.endsWith(":id");
  }
  const last = mutation.path.at(-1);
  return last?.type === "InstanceProperty" && last.value === "id";
}

function targetsExtendOrder(mutation: XnlMutation): boolean {
  const path = typeof mutation.path === "string" ? mutation.path : "";
  return (
    (mutation.type === "TREE_UPDATE" || mutation.type === "OBJECT_UPDATE") &&
    path.endsWith(":extend:order")
  );
}

function destinationKey(mutation: XnlMutation): string | undefined {
  return (mutation as XnlMutation & { destinationKey?: string }).destinationKey;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [Array.from(items)];
  return items.flatMap((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    return permutations(rest).map((permutation) => [item, ...permutation]);
  });
}

function extendSource(tags: readonly string[], identified: boolean): string {
  const children = tags.map((tag) => (identified ? `<${tag} #${tag}>` : `<${tag}>`)).join(" ");
  return `<root #root ( ${children} )>`;
}

interface ExtendPermutationCase {
  readonly label: string;
  readonly baseSource: string;
  readonly targetSource: string;
  readonly options: XnlMutationBatchOptions | undefined;
}

function makeExtendPermutationCases(): ExtendPermutationCase[] {
  const targetOrders = [
    ...permutations(["a", "b", "c"]),
    ...permutations(["a", "b", "n"]),
    ...permutations(["a", "b", "c", "n"]),
  ];

  return [true, false].flatMap((identified) =>
    targetOrders.map((targetOrder) => ({
      label: `${identified ? "identified" : "missing-id"} ${targetOrder.join(",")}`,
      baseSource: extendSource(["a", "b", "c"], identified),
      targetSource: extendSource(targetOrder, identified),
      options: identified
        ? undefined
        : ({ identityPolicy: "allow-missing" } satisfies XnlMutationBatchOptions),
    })),
  );
}

describe("authoring mutation characterization", () => {
  describe("#id identity-key semantics", () => {
    it("represents identity replacement as delete/add without an ordinary :id update", () => {
      const base = parseOne(`<root #root [ <item #old {value="same"}> ]>`);
      const target = parseOne(`<root #root [ <item #new {value="same"}> ]>`);

      const mutations = diffNodes(base, target);

      expect(mutations.map((mutation) => mutation.type)).toEqual(["TREE_DELETE", "TREE_ADD"]);
      expect(mutations.some(targetsElementId)).toBe(false);
      expect(
        mutations.some(
          (mutation) =>
            (mutation.type === "TREE_UPDATE" || mutation.type === "OBJECT_UPDATE") &&
            targetsElementId(mutation),
        ),
      ).toBe(false);
    });

    it("uses #id to express a cross-parent move without updating identity payload", () => {
      const base = parseOne(
        `<root #root [
          <left #left [ <item #moving> ]>
          <right #right>
        ]>`,
      );
      const target = parseOne(
        `<root #root [
          <left #left>
          <right #right [ <item #moving> ]>
        ]>`,
      );

      const mutations = diffNodes(base, target);
      const applied = applyMutations(clone(base), mutations);
      const preview = dryRunMutations(base, mutations);

      expect(mutations).toEqual([
        expect.objectContaining({
          type: "TREE_MOVE_CROSS_LEVEL",
          targetUniqueName: "moving",
          parentUniqueNameBefore: "left",
          parentUniqueNameAfter: "right",
        }),
        {
          type: "OBJECT_DELETE",
          path: "<id='left'>:body",
        },
      ]);
      expect(mutations.some(targetsElementId)).toBe(false);
      expect(applied).toEqual(target);
      expect(preview.status).toBe("applied");
      expect(preview.value).toEqual(target);
    });

    it("preserves an explicit empty body when its final child moves out", () => {
      expectLegacyParity(
        `<root #root [
          <left #left [ <item #moving> ]>
          <right #right>
        ]>`,
        `<root #root [
          <left #left [ ]>
          <right #right [ <item #moving> ]>
        ]>`,
      );
    });

    it("rejects duplicate effective identities", () => {
      const base = parseOne(
        `<root #root [
          <item #duplicate>
          <item id="duplicate">
        ]>`,
      );
      const baseBefore = clone(base);

      const result = dryRunMutations(base, []);

      expectRejected(result, "DUPLICATE_IDENTITY", base, baseBefore);
    });

    it("validates effective identities throughout non-body AST containers", () => {
      const base = parseOne(`<root #duplicate>`);
      const nested = parseOne(`<item id="duplicate">`);
      if (typeof base !== "object" || base === null || Array.isArray(base)) {
        throw new Error("Expected an element root");
      }
      (base as DataElementNode).attributes = { nested };
      const baseBefore = clone(base);

      const result = dryRunMutations(base, []);

      expectRejected(result, "DUPLICATE_IDENTITY", base, baseBefore);
    });

    it("prefers #id over metadata.id when validating effective identities", () => {
      const base = parseOne(
        `<root #root [
          <item #first id="legacy">
          <item #second id="legacy">
        ]>`,
      );

      const result = dryRunMutations(base, []);

      expect(result.status).toBe("applied");
      expect(result.diagnostics).toEqual([]);
    });

    it("allows missing identities by default", () => {
      const base = parseOne(
        `<root #root [
          <item>
          <note ?>text</?>
        ]>`,
      );
      const baseBefore = clone(base);

      const result = dryRunMutations(base, []);

      expect(result.status).toBe("applied");
      expect(result.diagnostics).toEqual([]);
      expect(result.value).toEqual(baseBefore);
      expect(result.value).not.toBe(base);
      expect(base).toEqual(baseBefore);
    });

    it("rejects missing DataElement and TextElement identities under require-elements", () => {
      const base = parseOne(
        `<root #root [
          <item>
          <note ?>text</?>
        ]>`,
      );
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [], { identityPolicy: "require-elements" });

      expectRejected(result, "MISSING_IDENTITY", base, baseBefore);
    });

    it.each([
      {
        operation: "add",
        baseSource: `<root #root [ <item> ]>`,
        mutation: {
          type: "OBJECT_ADD",
          path: "#root:body::0:id",
          valueAfter: word("assigned"),
        } satisfies XnlMutation,
      },
      {
        operation: "update",
        baseSource: `<root #root [ <item #stable> ]>`,
        mutation: {
          type: "OBJECT_UPDATE",
          path: "#stable:id",
          valueBefore: word("stable"),
          valueAfter: word("renamed"),
        } satisfies XnlMutation,
      },
      {
        operation: "delete",
        baseSource: `<root #root [ <item #stable> ]>`,
        mutation: {
          type: "OBJECT_DELETE",
          path: "#stable:id",
          valueBefore: word("stable"),
        } satisfies XnlMutation,
      },
    ])("rejects a hand-authored element :id $operation and leaves base unchanged", ({ baseSource, mutation }) => {
      const base = parseOne(baseSource);
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it("rejects the former whole-node identity replacement bypass", () => {
      const base = parseOne(`<root #root [ <item #old {state="draft"}> ]>`);
      const baseBefore = clone(base);
      const mutation = {
        type: "TREE_UPDATE",
        path: "#root:body::0",
        valueBefore: parseOne(`<item #old {state="draft"}>`),
        valueAfter: parseOne(`<item #new {state="draft"}>`),
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation], { identityPolicy: "require-elements" });

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it.each([
      {
        label: "DataElement whole node",
        baseSource: `<root #root [ <item #old {state="draft"}> ]>`,
        path: "#root:body::0",
        valueAfter: parseOne(`<item #new {state="draft"}>`),
        options: { identityPolicy: "require-elements" } satisfies XnlMutationBatchOptions,
      },
      {
        label: "TextElement whole node",
        baseSource: `<root #root [ <note #old ?>draft</?> ]>`,
        path: "#root:body::0",
        valueAfter: parseOne(`<note #new ?>draft</?>`),
        options: undefined,
      },
      {
        label: "body container removes an identity",
        baseSource: `<root #root [ <item #old> <item #kept> ]>`,
        path: "#root:body",
        valueAfter: [parseOne(`<item #kept>`)],
        options: undefined,
      },
      {
        label: "body container adds an identified descendant",
        baseSource: `<root #root [ <item #kept> ]>`,
        path: "#root:body",
        valueAfter: [parseOne(`<item #kept>`), parseOne(`<item #new>`)],
        options: undefined,
      },
      {
        label: "body container swaps identities at ordered paths",
        baseSource: `<root #root [ <item #a> <item #b> ]>`,
        path: "#root:body",
        valueAfter: [parseOne(`<item #b>`), parseOne(`<item #a>`)],
        options: undefined,
      },
      {
        label: "extend order container relocates identities",
        baseSource: `<root #root ( <alpha #a> <beta #b> )>`,
        path: "#root:extend:order",
        valueAfter: ["beta", "alpha"],
        options: undefined,
      },
    ])(
      "rejects hidden identity replacement via $label update",
      ({ baseSource, path, valueAfter, options }) => {
        const base = parseOne(baseSource);
        const baseBefore = clone(base);
        const mutation = {
          type: "TREE_UPDATE",
          path,
          valueAfter,
        } satisfies XnlMutation;

        const result = dryRunMutations(base, [mutation], options);

        expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
      },
    );

    it("rejects hidden identity replacement inside an attributes container update", () => {
      const base = parseOne(`<root #root>`);
      (base as DataElementNode).attributes = { slot: parseOne(`<item #old>`) };
      const baseBefore = clone(base);
      const mutation = {
        type: "OBJECT_UPDATE",
        path: "#root:attributes",
        valueAfter: { slot: parseOne(`<item #new>`) },
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it.each([
      {
        label: "changes the fallback identity",
        valueAfter: { id: "new", state: "draft" },
      },
      {
        label: "removes the fallback identity",
        valueAfter: { state: "draft" },
      },
    ])("rejects whole metadata map replacement that $label", ({ valueAfter }) => {
      const base = parseOne(`<item id="old" state="draft">`);
      const baseBefore = clone(base);
      const mutation = {
        type: "OBJECT_UPDATE",
        path: ":metadata",
        valueAfter,
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it.each([
      {
        operation: "update",
        mutation: {
          type: "OBJECT_UPDATE",
          path: ":metadata::'id'",
          valueBefore: "old",
          valueAfter: "new",
        } satisfies XnlMutation,
      },
      {
        operation: "delete",
        mutation: {
          type: "OBJECT_DELETE",
          path: ":metadata::'id'",
          valueBefore: "old",
        } satisfies XnlMutation,
      },
      {
        operation: "add",
        baseSource: `<item>`,
        mutation: {
          type: "OBJECT_ADD",
          path: ":metadata::'id'",
          valueAfter: "new",
        } satisfies XnlMutation,
      },
    ])("rejects direct metadata fallback id $operation when it is the identity authority", ({ baseSource, mutation }) => {
      const base = parseOne(baseSource ?? `<item id="old">`);
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it.each([
      {
        label: "explicit #id to same-value metadata fallback",
        baseSource: `<root #root [ <item #same {state="draft"}> ]>`,
        valueAfter: parseOne(`<item id="same" {state="draft"}>`),
      },
      {
        label: "same-value metadata fallback to explicit #id",
        baseSource: `<root #root [ <item id="same" {state="draft"}> ]>`,
        valueAfter: parseOne(`<item #same {state="draft"}>`),
      },
    ])("rejects raw identity authority transition from $label", ({ baseSource, valueAfter }) => {
      const base = parseOne(baseSource);
      const baseBefore = clone(base);
      const mutation = {
        type: "TREE_UPDATE",
        path: "#root:body::0",
        valueAfter,
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it("keeps explicit #id precedence when direct metadata id changes in identity mode", () => {
      const base = parseOne(`<item #stable id="legacy" {state="draft"}>`);
      const baseBefore = clone(base);
      const mutation = {
        type: "OBJECT_UPDATE",
        path: ":metadata::'id'",
        valueBefore: "legacy",
        valueAfter: "changed",
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);
      const legacy = applyMutations(clone(base), [mutation]);

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(baseBefore);
      expect(legacy).toEqual(baseBefore);
      expect(base).toEqual(baseBefore);
    });

    it("allows same-id whole-node payload updates for DataElement and TextElement", () => {
      const base = parseOne(`<root #root [ <item #item {state="draft"}> <note #note ?>old</?> ]>`);
      const target = parseOne(`<root #root [ <item #item {state="done"}> <note #note ?>new</?> ]>`);
      const mutations: XnlMutation[] = [
        {
          type: "TREE_UPDATE",
          path: "#root:body::0",
          valueAfter: parseOne(`<item #item {state="done"}>`),
        },
        {
          type: "TREE_UPDATE",
          path: "#root:body::1",
          valueAfter: parseOne(`<note #note ?>new</?>`),
        },
      ];

      const result = dryRunMutations(base, mutations, { identityPolicy: "require-elements" });

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("allows ordinary list insertion, empty assignment destination, explicit delete/add replacement, and normal move", () => {
      const base = parseOne(`<root #root [ <old #old> <moving #moving> <lane #lane> ]>`);
      const target = parseOne(
        `<root #root [
          <fresh #fresh>
          <new #new>
          <lane #lane [ <moving #moving> ]>
        ]>`,
      );
      const mutations: XnlMutation[] = [
        {
          type: "TREE_DELETE",
          path: "#root:body::0",
          targetUniqueName: "old",
          valueBefore: parseOne(`<old #old>`),
        },
        {
          type: "TREE_ADD",
          path: "#root:body::0",
          targetUniqueName: "fresh",
          valueAfter: parseOne(`<fresh #fresh>`),
        },
        {
          type: "TREE_ADD",
          path: "#root:body::1",
          targetUniqueName: "new",
          valueAfter: parseOne(`<new #new>`),
        },
        {
          type: "TREE_MOVE_CROSS_LEVEL",
          pathBefore: "#root:body::2",
          path: "#lane:body::0",
          targetUniqueName: "moving",
          parentUniqueNameBefore: "root",
          parentUniqueNameAfter: "lane",
        },
      ];

      const result = dryRunMutations(base, mutations, { verifyValueBefore: true });

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("keeps legacy apply compatible for hidden replacement while strict expectation is red", () => {
      const base = parseOne(`<root #root [ <item #old {state="draft"}> ]>`);
      const mutation = {
        type: "TREE_UPDATE",
        path: "#root:body::0",
        valueAfter: parseOne(`<item #new {state="draft"}>`),
      } satisfies XnlMutation;

      const legacy = applyMutations(clone(base), [mutation]);
      const strict = dryRunMutations(base, [mutation]);

      expect(legacy).toEqual(parseOne(`<root #root [ <item #new {state="draft"}> ]>`));
      expectRejected(strict, "IDENTITY_MUTATION_FORBIDDEN", base, clone(base));
    });

    it.each([
      {
        label: "occupied body property",
        baseFactory: () => parseOne(`<root #root [ <old #old> ]>`),
        mutation: {
          type: "OBJECT_ADD",
          path: "#root:body",
          valueAfter: [parseOne(`<new #new>`)],
        } satisfies XnlMutation,
      },
      {
        label: "occupied attribute map key",
        baseFactory: () => {
          const base = parseOne(`<root #root>`);
          (base as DataElementNode).attributes = { slot: parseOne(`<old #old>`) };
          return base;
        },
        mutation: {
          type: "OBJECT_ADD",
          path: "#root:attributes::'slot'",
          valueAfter: parseOne(`<new #new>`),
        } satisfies XnlMutation,
      },
      {
        label: "occupied Extend child key",
        baseFactory: () => parseOne(`<root #root ( <slot #old> )>`),
        mutation: {
          type: "TREE_ADD",
          path: "#root:extend::'slot'",
          valueAfter: parseOne(`<slot #new>`),
        } satisfies XnlMutation,
      },
      {
        label: "occupied Extend index keyed by value tag",
        baseFactory: () => parseOne(`<root #root ( <slot #old> <other #other> )>`),
        mutation: {
          type: "TREE_ADD",
          path: "#root:extend::1",
          valueAfter: parseOne(`<slot #new>`),
        } satisfies XnlMutation,
      },
    ])("rejects structural add to $label", ({ baseFactory, mutation }) => {
      const base = baseFactory();
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it("rejects cross-parent move into an occupied attribute map key before extracting the source", () => {
      const base = parseOne(`<root #root [ <moving #moving> ]>`);
      (base as DataElementNode).attributes = { slot: parseOne(`<old #old>`) };
      const baseBefore = clone(base);
      const mutation = {
        type: "TREE_MOVE_CROSS_LEVEL",
        pathBefore: "#root:body::0",
        path: "#root:attributes::'slot'",
        targetUniqueName: "moving",
        parentUniqueNameBefore: "root",
        parentUniqueNameAfter: "root",
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });

    it.each([
      {
        label: "keyed destination",
        mutation: {
          type: "TREE_MOVE_CROSS_LEVEL",
          pathBefore: "#source:extend::'slot'",
          path: "#target:extend::'slot'",
          targetUniqueName: "moving",
          parentUniqueNameBefore: "source",
          parentUniqueNameAfter: "target",
        } satisfies XnlMutation,
      },
      {
        label: "index destinationKey collision",
        mutation: {
          type: "TREE_MOVE_CROSS_LEVEL",
          pathBefore: "#source:extend::'moving-old'",
          path: "#target:extend::0",
          destinationKey: "slot",
          targetUniqueName: "moving",
          parentUniqueNameBefore: "source",
          parentUniqueNameAfter: "target",
        } as XnlMutation & { destinationKey: string },
      },
    ])("rejects cross-parent Extend move into an occupied $label and keeps the source", ({ mutation }) => {
      const base = parseOne(
        `<root #root [
          <source #source ( <moving-old #moving> )>
          <target #target ( <slot #occupied> )>
        ]>`,
      );
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation]);

      expectRejected(result, "IDENTITY_MUTATION_FORBIDDEN", base, baseBefore);
    });
  });

  describe("Extend identity structure characterization", () => {
    it.each([
      {
        label: "identified children",
        baseSource: `<root #root ( <alpha #a> <beta #b> )>`,
        targetSource: `<root #root ( <beta #b> <alpha #a> )>`,
        options: undefined,
      },
      {
        label: "missing-id children under allow-missing",
        baseSource: `<root #root ( <alpha> <beta> )>`,
        targetSource: `<root #root ( <beta> <alpha> )>`,
        options: { identityPolicy: "allow-missing" } satisfies XnlMutationBatchOptions,
      },
    ])("expresses Extend reorder for $label as explicit moves, not order updates", ({ baseSource, targetSource, options }) => {
      const base = parseOne(baseSource);
      const target = parseOne(targetSource);
      const mutations = diffNodes(base, target);
      const result = dryRunMutations(base, mutations, options);

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(mutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: expect.any(String),
          }),
        ]),
      );
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("simulates lower-index Extend add before pathBefore moves for missing-id reorder", () => {
      const base = parseOne(`<root #root ( <alpha> <beta> )>`);
      const target = parseOne(`<root #root ( <fresh> <beta> <alpha> )>`);
      const mutations = diffNodes(base, target);
      const result = dryRunMutations(base, mutations, { identityPolicy: "allow-missing" });

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(mutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "TREE_ADD",
            path: "#root:extend::0",
          }),
          expect.objectContaining({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: "#root:extend::2",
            path: "#root:extend::1",
          }),
        ]),
      );
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("simulates delete, lower-index add, and pathBefore Extend reorder together", () => {
      const base = parseOne(`<root #root ( <remove> <alpha> <beta> )>`);
      const target = parseOne(`<root #root ( <fresh> <beta> <alpha> )>`);
      const mutations = diffNodes(base, target);
      const result = dryRunMutations(base, mutations, { identityPolicy: "allow-missing" });

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(mutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "TREE_DELETE",
            path: "#root:extend::'remove'",
          }),
          expect.objectContaining({
            type: "TREE_ADD",
            path: "#root:extend::0",
          }),
          expect.objectContaining({
            type: "TREE_MOVE_SAME_LEVEL",
            pathBefore: "#root:extend::2",
            path: "#root:extend::1",
          }),
        ]),
      );
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    const extendPermutationCases = makeExtendPermutationCases();

    it("covers the full Extend permutation matrix", () => {
      expect(extendPermutationCases).toHaveLength(72);
    });

    it.each(extendPermutationCases)("preserves Extend permutation parity for $label", ({ baseSource, targetSource, options }) => {
      const base = parseOne(baseSource);
      const target = parseOne(targetSource);
      const mutations = diffNodes(base, target);
      const applied = applyMutations(clone(base), mutations);
      const result = dryRunMutations(base, mutations, options);

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(applied).toEqual(target);
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("still rejects missing-id Extend reorder under require-elements through the existing policy", () => {
      const base = parseOne(`<root #root ( <alpha> <beta> )>`);
      const baseBefore = clone(base);
      const target = parseOne(`<root #root ( <beta> <alpha> )>`);
      const mutations = diffNodes(base, target);

      const result = dryRunMutations(base, mutations, { identityPolicy: "require-elements" });

      expectRejected(result, "MISSING_IDENTITY", base, baseBefore);
    });

    it.each([
      {
        label: "later index retagged to earlier index",
        baseSource: `<root #root ( <alpha #a> <old #moving {state="draft"}> )>`,
        targetSource: `<root #root ( <new #moving {state="done"}> <alpha #a> )>`,
        expectedPath: "#root:extend::0",
      },
      {
        label: "earlier index retagged to later index",
        baseSource: `<root #root ( <old #moving {state="draft"}> <beta #b> )>`,
        targetSource: `<root #root ( <beta #b> <new #moving {state="done"}> )>`,
        expectedPath: "#root:extend::1",
      },
    ])("uses destinationKey for $label", ({ baseSource, targetSource, expectedPath }) => {
      const base = parseOne(baseSource);
      const target = parseOne(targetSource);
      const mutations = diffNodes(base, target);
      const move = mutations.find(
        (mutation) => mutation.type === "TREE_MOVE_SAME_LEVEL" && mutation.targetUniqueName === "moving",
      );
      const result = dryRunMutations(base, mutations);

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(move).toEqual(
        expect.objectContaining({
          path: expectedPath,
          destinationKey: "new",
        }),
      );
      expect(destinationKey(move as XnlMutation)).toBe("new");
      expect(
        mutations.filter((mutation) => mutation.type === "TREE_UPDATE" && mutation.path === "#moving:tag"),
      ).toHaveLength(1);
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it.each([
      {
        label: "cross-parent retag move to destination head",
        targetSource: `<root #root [
          <source #source>
          <target #target ( <new #moving {state="done"}> <anchor #anchor> )>
        ]>`,
        expectedPath: "#target:extend::0",
      },
      {
        label: "cross-parent retag move to destination tail",
        targetSource: `<root #root [
          <source #source>
          <target #target ( <anchor #anchor> <new #moving {state="done"}> )>
        ]>`,
        expectedPath: "#target:extend::1",
      },
    ])("propagates destinationKey for $label", ({ targetSource, expectedPath }) => {
      const base = parseOne(
        `<root #root [
          <source #source ( <old #moving {state="draft"}> )>
          <target #target ( <anchor #anchor> )>
        ]>`,
      );
      const target = parseOne(targetSource);
      const mutations = diffNodes(base, target);
      const move = mutations.find(
        (mutation) => mutation.type === "TREE_MOVE_CROSS_LEVEL" && mutation.targetUniqueName === "moving",
      );
      const result = dryRunMutations(base, mutations);

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(move).toEqual(
        expect.objectContaining({
          path: expectedPath,
          destinationKey: "new",
        }),
      );
      expect(destinationKey(move as XnlMutation)).toBe("new");
      expect(
        mutations.filter((mutation) => mutation.type === "TREE_UPDATE" && mutation.path === "#moving:tag"),
      ).toHaveLength(1);
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("uses destinationKey for a same-index same-identity Extend retag", () => {
      const base = parseOne(`<root #root ( <old #moving {state="draft"}> <stay #s> )>`);
      const target = parseOne(`<root #root ( <new #moving {state="done"}> <stay #s> )>`);
      const mutations = diffNodes(base, target);
      const move = mutations.find(
        (mutation) => mutation.type === "TREE_MOVE_SAME_LEVEL" && mutation.targetUniqueName === "moving",
      );
      const result = dryRunMutations(base, mutations);

      expect(mutations.some(targetsExtendOrder)).toBe(false);
      expect(move).toEqual(
        expect.objectContaining({
          path: "#root:extend::0",
          destinationKey: "new",
        }),
      );
      expect(destinationKey(move as XnlMutation)).toBe("new");
      expect(
        mutations.filter((mutation) => mutation.type === "TREE_UPDATE" && mutation.path === "#moving:tag"),
      ).toHaveLength(1);
      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("rejects standalone incoherent Extend retag without key migration", () => {
      const base = parseOne(`<root #root ( <old #moving> )>`);
      const baseBefore = clone(base);
      const mutation = {
        type: "TREE_UPDATE",
        path: "#moving:tag",
        valueBefore: "old",
        valueAfter: "new",
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation], { verifyValueBefore: true });

      expectRejected(result, "RESULT_STRUCTURE_INVALID", base, baseBefore);
    });

    it("allows same-source Extend reorder even when the target index is occupied by a sibling", () => {
      const base = parseOne(`<root #root ( <alpha #a> <beta #b> )>`);
      const target = parseOne(`<root #root ( <beta #b> <alpha #a> )>`);
      const mutations: XnlMutation[] = [
        {
          type: "TREE_MOVE_SAME_LEVEL",
          pathBefore: "#root:extend::1",
          path: "#root:extend::0",
          targetUniqueName: "b",
          parentUniqueNameBefore: "root",
          parentUniqueNameAfter: "root",
        },
      ];

      const result = dryRunMutations(base, mutations);

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("allows an Extend same-tag add when the keyed destination is empty", () => {
      const base = parseOne(`<root #root ( )>`);
      const target = parseOne(`<root #root ( <slot #slot> )>`);
      const mutation = {
        type: "TREE_ADD",
        path: "#root:extend::0",
        targetUniqueName: "slot",
        valueAfter: parseOne(`<slot #slot>`),
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation]);

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
    });

    it("allows delete-then-add replacement at an Extend key but rejects add-only collision", () => {
      const base = parseOne(`<root #root ( <slot #old> )>`);
      const target = parseOne(`<root #root ( <slot #new> )>`);
      const deleteThenAdd: XnlMutation[] = [
        {
          type: "TREE_DELETE",
          path: "#root:extend::'slot'",
          targetUniqueName: "old",
          valueBefore: parseOne(`<slot #old>`),
        },
        {
          type: "TREE_ADD",
          path: "#root:extend::'slot'",
          targetUniqueName: "new",
          valueAfter: parseOne(`<slot #new>`),
        },
      ];
      const collision: XnlMutation[] = [
        {
          type: "TREE_ADD",
          path: "#root:extend::'slot'",
          targetUniqueName: "new",
          valueAfter: parseOne(`<slot #new>`),
        },
      ];

      const accepted = dryRunMutations(base, deleteThenAdd, { verifyValueBefore: true });
      const rejected = dryRunMutations(base, collision);

      expect(accepted.status).toBe("applied");
      expect(accepted.value).toEqual(target);
      expectRejected(rejected, "IDENTITY_MUTATION_FORBIDDEN", base, clone(base));
    });
  });

  describe("atomic strict batch", () => {
    it("returns a fully updated clone without mutating base or input mutations", () => {
      const base = parseOne(`<root #root [ <item #item {state="draft"}> ]>`);
      const target = parseOne(`<root #root [ <item #item {state="published"}> ]>`);
      const baseBefore = clone(base);
      const mutations = diffNodes(base, target);
      const mutationsBefore = clone(mutations);

      const result = dryRunMutations(base, mutations);

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(target);
      expect(result.value).not.toBe(base);
      expect(result.diagnostics).toEqual([]);
      expect(base).toEqual(baseBefore);
      expect(mutations).toEqual(mutationsBefore);
    });

    it("isolates added values from later mutations in the same batch", () => {
      const base = parseOne(`<root #root>`);
      const baseBefore = clone(base);
      const mutations: XnlMutation[] = [
        {
          type: "TREE_ADD",
          path: "#root:body::0",
          valueAfter: parseOne(`<item #item {state="draft"}>`),
        },
        {
          type: "OBJECT_UPDATE",
          path: "#item:attributes::'state'",
          valueAfter: "published",
        },
      ];
      const mutationsBefore = clone(mutations);

      const result = dryRunMutations(base, mutations);

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(
        parseOne(`<root #root [ <item #item {state="published"}> ]>`),
      );
      expect(base).toEqual(baseBefore);
      expect(mutations).toEqual(mutationsBefore);
    });

    it("rejects a later apply failure without exposing the partially updated tree", () => {
      const base = parseOne(`<root #root [ <item #item {state="draft"}> ]>`);
      const baseBefore = clone(base);
      const mutations: XnlMutation[] = [
        {
          type: "OBJECT_UPDATE",
          path: "#item:attributes::'state'",
          valueAfter: "published",
        },
        {
          type: "OBJECT_UPDATE",
          path: "#missing:attributes::'state'",
          valueAfter: "invalid",
        },
      ];

      const result = dryRunMutations(base, mutations);

      expectRejected(result, "APPLY_FAILED", base, baseBefore);
    });

    it.each([
      {
        reason: "duplicate identity",
        options: undefined,
        mutation: {
          type: "TREE_ADD",
          path: "#root:body::1",
          valueAfter: parseOne(`<item #item>`),
        } satisfies XnlMutation,
      },
      {
        reason: "missing required identity",
        options: { identityPolicy: "require-elements" } satisfies XnlMutationBatchOptions,
        mutation: {
          type: "TREE_ADD",
          path: "#root:body::1",
          valueAfter: parseOne(`<item>`),
        } satisfies XnlMutation,
      },
    ])("rejects a result with $reason without exposing it", ({ options, mutation }) => {
      const base = parseOne(`<root #root [ <item #item> ]>`);
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation], options);

      expectRejected(result, "RESULT_IDENTITY_INVALID", base, baseBefore);
    });

    it.each([
      {
        operation: "update",
        baseSource: `<root #root [ <item #item {state="draft"}> ]>`,
        mutation: {
          type: "OBJECT_UPDATE",
          path: "#item:attributes::'state'",
          valueBefore: "stale",
          valueAfter: "published",
        } satisfies XnlMutation,
      },
      {
        operation: "delete",
        baseSource: `<root #root [ <item #item> ]>`,
        mutation: {
          type: "TREE_DELETE",
          path: "#root:body::0",
          valueBefore: parseOne(`<item #other>`),
          targetUniqueName: "item",
        } satisfies XnlMutation,
      },
      {
        operation: "move",
        baseSource: `<root #root [
          <left #left [ <item #item> ]>
          <right #right>
        ]>`,
        mutation: {
          type: "TREE_MOVE_CROSS_LEVEL",
          pathBefore: "#left:body::0",
          path: "#right:body::0",
          valueBefore: parseOne(`<item #other>`),
          targetUniqueName: "item",
          parentUniqueNameBefore: "left",
          parentUniqueNameAfter: "right",
        } satisfies XnlMutation,
      },
    ])("rejects stale valueBefore for $operation before applying it", ({ baseSource, mutation }) => {
      const base = parseOne(baseSource);
      const baseBefore = clone(base);

      const result = dryRunMutations(base, [mutation], { verifyValueBefore: true });

      expectRejected(result, "PRECONDITION_FAILED", base, baseBefore);
    });

    it("checks a move valueBefore against the identity-selected target", () => {
      const base = parseOne(
        `<root #root [
          <left #left [ <item #other> <item #item {state="draft"}> ]>
          <right #right>
        ]>`,
      );
      const baseBefore = clone(base);
      const mutation = {
        type: "TREE_MOVE_CROSS_LEVEL",
        pathBefore: "#left:body::0",
        path: "#right:body::0",
        valueBefore: parseOne(`<item #item {state="draft"}>`),
        targetUniqueName: "item",
        parentUniqueNameBefore: "left",
        parentUniqueNameAfter: "right",
      } satisfies XnlMutation;

      const result = dryRunMutations(base, [mutation], { verifyValueBefore: true });

      expect(result.status).toBe("applied");
      expect(result.value).toEqual(
        parseOne(
          `<root #root [
            <left #left [ <item #other> ]>
            <right #right [ <item #item {state="draft"}> ]>
          ]>`,
        ),
      );
      expect(base).toEqual(baseBefore);
    });
  });

  describe("complete AST diff/apply parity", () => {
    it.each([
      {
        kind: "DataElement",
        transition: "populated attributes to absent",
        baseSource: `<item #item {state="draft"}>`,
        targetSource: `<item #item>`,
      },
      {
        kind: "DataElement",
        transition: "absent attributes to explicit empty",
        baseSource: `<item #item>`,
        targetSource: `<item #item {}>`,
      },
      {
        kind: "DataElement",
        transition: "explicit empty attributes to absent",
        baseSource: `<item #item {}>`,
        targetSource: `<item #item>`,
      },
      {
        kind: "DataElement",
        transition: "absent attributes to populated",
        baseSource: `<item #item>`,
        targetSource: `<item #item {state="draft"}>`,
      },
      {
        kind: "DataElement",
        transition: "populated attributes to explicit empty",
        baseSource: `<item #item {state="draft"}>`,
        targetSource: `<item #item {}>`,
      },
      {
        kind: "DataElement",
        transition: "explicit empty attributes to populated",
        baseSource: `<item #item {}>`,
        targetSource: `<item #item {state="draft"}>`,
      },
      {
        kind: "TextElement",
        transition: "populated attributes to absent",
        baseSource: `<label #item {state="draft"} ?>text</?>`,
        targetSource: `<label #item ?>text</?>`,
      },
      {
        kind: "TextElement",
        transition: "absent attributes to explicit empty",
        baseSource: `<label #item ?>text</?>`,
        targetSource: `<label #item {} ?>text</?>`,
      },
      {
        kind: "TextElement",
        transition: "explicit empty attributes to absent",
        baseSource: `<label #item {} ?>text</?>`,
        targetSource: `<label #item ?>text</?>`,
      },
      {
        kind: "TextElement",
        transition: "absent attributes to populated",
        baseSource: `<label #item ?>text</?>`,
        targetSource: `<label #item {state="draft"} ?>text</?>`,
      },
      {
        kind: "TextElement",
        transition: "populated attributes to explicit empty",
        baseSource: `<label #item {state="draft"} ?>text</?>`,
        targetSource: `<label #item {} ?>text</?>`,
      },
      {
        kind: "TextElement",
        transition: "explicit empty attributes to populated",
        baseSource: `<label #item {} ?>text</?>`,
        targetSource: `<label #item {state="draft"} ?>text</?>`,
      },
    ])("preserves $kind $transition", ({ baseSource, targetSource }) => {
      expectLegacyParity(baseSource, targetSource);
    });

    it.each([
      {
        transition: "populated extend to absent",
        baseSource: `<item #item ( <child #child> )>`,
        targetSource: `<item #item>`,
      },
      {
        transition: "absent extend to explicit empty",
        baseSource: `<item #item>`,
        targetSource: `<item #item ( )>`,
      },
      {
        transition: "explicit empty extend to absent",
        baseSource: `<item #item ( )>`,
        targetSource: `<item #item>`,
      },
      {
        transition: "absent extend to populated",
        baseSource: `<item #item>`,
        targetSource: `<item #item ( <child #child> )>`,
      },
      {
        transition: "populated extend to explicit empty",
        baseSource: `<item #item ( <child #child> )>`,
        targetSource: `<item #item ( )>`,
      },
      {
        transition: "explicit empty extend to populated",
        baseSource: `<item #item ( )>`,
        targetSource: `<item #item ( <child #child> )>`,
      },
    ])("preserves $transition", ({ baseSource, targetSource }) => {
      expectLegacyParity(baseSource, targetSource);
    });

    it("removes an emptied extend after moving its final child and updating payload", () => {
      expectLegacyParity(
        `<root #root [
          <left #left ( <item #moving {state="draft"}> )>
          <right #right>
        ]>`,
        `<root #root [
          <left #left>
          <right #right [ <item #moving {state="published"}> ]>
        ]>`,
      );
    });

    it("rebuilds a same-level four-node reorder", () => {
      expectLegacyParity(
        `<root #root [
          <item #a>
          <item #b>
          <item #c>
          <item #d>
        ]>`,
        `<root #root [
          <item #d>
          <item #c>
          <item #a>
          <item #b>
        ]>`,
      );
    });

    it("rebuilds multiple cross-parent moves with target sibling order", () => {
      expectLegacyParity(
        `<root #root [
          <left #left [ <item #a> <item #b> ]>
          <right #right [ <item #c> <item #d> ]>
        ]>`,
        `<root #root [
          <left #left [ <item #c> ]>
          <right #right [ <item #a> <item #d> <item #b> ]>
        ]>`,
      );
    });

    it("rebuilds cross-parent moves around a sibling whose numeric index is unchanged", () => {
      expectLegacyParity(
        `<root #root [
          <left #left [ <item #a> <item #b> ]>
          <right #right [ <item #c> <item #d> ]>
        ]>`,
        `<root #root [
          <left #left [ ]>
          <right #right [ <item #a> <item #d> <item #b> <item #c> ]>
        ]>`,
      );
    });

    it("rebuilds a three-node rotation", () => {
      expectLegacyParity(
        `<root #root [ <item #a> <item #b> <item #c> ]>`,
        `<root #root [ <item #c> <item #a> <item #b> ]>`,
      );
    });

    it("rebuilds a mixed move/add/delete/attribute/text/tag target", () => {
      const mutations = expectLegacyParity(
        `<root #root [
          <lane #left {mode="draft"} [
            <card #a {score=1}>
            <label #copy ?>old</?>
            <card #remove {score=0}>
          ]>
          <lane #right [
            <card #b {score=2}>
            <legacy #retag {flag=false}>
          ]>
        ]>`,
        `<root #root [
          <lane #left {mode="published"} [
            <card #b {score=3}>
            <label #copy ?>new</?>
            <fresh #add {score=9}>
          ]>
          <lane #right [
            <modern #retag {flag=true}>
            <card #a {score=1}>
          ]>
        ]>`,
      );

      expect(mutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "OBJECT_UPDATE",
            path: "#b:attributes::'score'",
            valueAfter: 3,
          }),
          expect.objectContaining({
            type: "TREE_UPDATE",
            path: "#retag:tag",
            valueBefore: "legacy",
            valueAfter: "modern",
          }),
          expect.objectContaining({
            type: "OBJECT_UPDATE",
            path: "#retag:attributes::'flag'",
            valueAfter: true,
          }),
        ]),
      );
    });
  });

  describe("tag updates stay distinct from identity", () => {
    it.each([
      {
        kind: "DataElement",
        baseSource: `<legacy #stable {state="same"}>`,
        targetSource: `<modern #stable {state="same"}>`,
      },
      {
        kind: "TextElement",
        baseSource: `<legacy #stable ?>same text</?>`,
        targetSource: `<modern #stable ?>same text</?>`,
      },
    ])("emits and applies a $kind tag update without an element :id update", ({ baseSource, targetSource }) => {
      const base = parseOne(baseSource);
      const target = parseOne(targetSource);

      const mutations = diffNodes(base, target);
      const applied = applyMutations(clone(base), mutations);
      const preview = dryRunMutations(base, mutations);

      expect(mutations).toContainEqual(
        expect.objectContaining({
          type: "TREE_UPDATE",
          path: ":tag",
          valueAfter: "modern",
        }),
      );
      expect(mutations.some(targetsElementId)).toBe(false);
      expect(applied).toEqual(target);
      expect(preview.status).toBe("applied");
      expect(preview.value).toEqual(target);
    });
  });
});
