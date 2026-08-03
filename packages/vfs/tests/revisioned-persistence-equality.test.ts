import type {
  CommentNode,
  DataElementNode,
  TextElementNode,
  XnlMutationBatchOptions,
  XnlWord,
} from "xnl-core";
import { describe, expect, it } from "vitest";
import {
  areXnlSnapshotsStructurallyEqual,
  type ApplyRevisionedVfsMutationsInput,
  type ApplyRevisionedVfsMutationsResult,
  type RevisionedVfsCompareAndSwapResult,
  type RevisionedVfsReceipt,
  type VfsRevision,
} from "../src/index";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Assert<Condition extends true> = Condition;
type CoordinatorMutationOptions = NonNullable<
  ApplyRevisionedVfsMutationsInput["mutationOptions"]
>;

type CoordinatorOptionsAreExact = Assert<
  Equal<
    CoordinatorMutationOptions,
    Omit<XnlMutationBatchOptions, "metadataIdMode">
  >
>;
type CoordinatorOmitsMetadataIdMode = Assert<
  Equal<Extract<keyof CoordinatorMutationOptions, "metadataIdMode">, never>
>;
type FlushReceiptOmitsCommitId = Assert<
  Equal<Extract<keyof RevisionedVfsReceipt, "commitId">, never>
>;
type RevisionIsAuthorityQualified = Assert<
  Equal<keyof VfsRevision, "authorityId" | "value">
>;
type CasResultIsClosed = Assert<
  Equal<
    RevisionedVfsCompareAndSwapResult["status"],
    "applied" | "unchanged" | "conflict" | "failed"
  >
>;
type CoordinatorResultIsClosed = Assert<
  Equal<
    ApplyRevisionedVfsMutationsResult["status"],
    "applied" | "unchanged" | "conflict" | "rejected" | "failed"
  >
>;

function word(name: string, namespace: string[] = []): XnlWord {
  return { kind: "Word", namespace, name };
}

function createSnapshot(): DataElementNode {
  return {
    kind: "DataElement",
    tag: "workspace",
    id: word("workspace", ["root"]),
    metadata: {
      state: "draft",
      enabled: true,
      count: 3,
      empty: null,
      owner: word("owner", ["team"]),
      note: { kind: "Comment", value: "metadata comment" },
      nested: {
        zeta: "last",
        alpha: ["first", 1, false, null],
      },
    },
    attributes: {
      role: "project",
      nestedText: {
        kind: "TextElement",
        tag: "caption",
        metadata: { language: "en" },
        text: "nested",
        textMarker: "NESTED",
      },
    },
    body: [
      {
        kind: "DataElement",
        tag: "folder",
        id: word("folder"),
        metadata: { id: "legacy-folder", name: "src" },
        attributes: { mode: "source" },
        body: ["index.ts"],
      },
      {
        kind: "TextElement",
        tag: "description",
        id: word("description"),
        metadata: { format: "plain" },
        attributes: { emphasis: "strong" },
        text: "hello",
        textMarker: "TEXT",
      },
      { kind: "Comment", value: "body comment" },
      word("literal", ["body"]),
      "text",
      17,
      true,
      null,
      ["nested array", { second: 2, first: 1 }],
      { second: "two", first: "one" },
    ],
    extend: {
      order: ["alpha", "beta"],
      children: {
        alpha: {
          kind: "DataElement",
          tag: "alpha",
          id: word("alpha"),
          metadata: { slot: "first" },
        },
        beta: {
          kind: "TextElement",
          tag: "beta",
          id: word("beta"),
          metadata: { slot: "second" },
          text: "extended",
          textMarker: "EXT",
        },
      },
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function reverseObjectKeyInsertionOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeyInsertionOrder) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeyInsertionOrder(child)]),
  ) as T;
}

function textChild(snapshot: DataElementNode): TextElementNode {
  const child = snapshot.body?.[1];
  if (
    !child ||
    typeof child !== "object" ||
    Array.isArray(child) ||
    (child as { kind?: unknown }).kind !== "TextElement"
  ) {
    throw new Error("Expected the text fixture");
  }
  return child as TextElementNode;
}

function commentChild(snapshot: DataElementNode): CommentNode {
  const child = snapshot.body?.[2];
  if (
    !child ||
    typeof child !== "object" ||
    Array.isArray(child) ||
    (child as { kind?: unknown }).kind !== "Comment"
  ) {
    throw new Error("Expected the comment fixture");
  }
  return child as CommentNode;
}

function wordChild(snapshot: DataElementNode): XnlWord {
  const child = snapshot.body?.[3];
  if (
    !child ||
    typeof child !== "object" ||
    Array.isArray(child) ||
    (child as { kind?: unknown }).kind !== "Word"
  ) {
    throw new Error("Expected the word fixture");
  }
  return child as XnlWord;
}

describe("identity-sensitive XNL snapshot equality", () => {
  it("ignores object key insertion order throughout the complete AST", () => {
    const snapshot = createSnapshot();
    const reordered = reverseObjectKeyInsertionOrder(snapshot);

    expect(areXnlSnapshotsStructurallyEqual(snapshot, reordered)).toBe(true);
    expect(areXnlSnapshotsStructurallyEqual(reordered, snapshot)).toBe(true);
  });

  it("preserves array, body, and Extend order", () => {
    const snapshot = createSnapshot();

    const reorderedBody = clone(snapshot);
    reorderedBody.body = [
      reorderedBody.body?.[1] ?? null,
      reorderedBody.body?.[0] ?? null,
      ...(reorderedBody.body?.slice(2) ?? []),
    ];

    const reorderedArray = clone(snapshot);
    const nested = reorderedArray.metadata.nested as { alpha: unknown[] };
    nested.alpha.reverse();

    const reorderedExtend = clone(snapshot);
    reorderedExtend.extend?.order.reverse();

    expect(areXnlSnapshotsStructurallyEqual(snapshot, reorderedBody)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(snapshot, reorderedArray)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(snapshot, reorderedExtend)).toBe(false);
  });

  it.each<{
    field: string;
    mutate: (snapshot: DataElementNode) => void;
  }>([
    {
      field: "kind",
      mutate(snapshot) {
        (textChild(snapshot) as { kind: string }).kind = "Comment";
      },
    },
    {
      field: "tag",
      mutate(snapshot) {
        textChild(snapshot).tag = "renamed";
      },
    },
    {
      field: "id namespace",
      mutate(snapshot) {
        snapshot.id?.namespace.push("other");
      },
    },
    {
      field: "id name",
      mutate(snapshot) {
        if (snapshot.id) snapshot.id.name = "replacement";
      },
    },
    {
      field: "metadata",
      mutate(snapshot) {
        snapshot.metadata.state = "saved";
      },
    },
    {
      field: "attributes",
      mutate(snapshot) {
        if (snapshot.attributes) snapshot.attributes.role = "library";
      },
    },
    {
      field: "text",
      mutate(snapshot) {
        textChild(snapshot).text = "changed";
      },
    },
    {
      field: "textMarker",
      mutate(snapshot) {
        textChild(snapshot).textMarker = "OTHER";
      },
    },
    {
      field: "comment value",
      mutate(snapshot) {
        commentChild(snapshot).value = "changed";
      },
    },
    {
      field: "word namespace",
      mutate(snapshot) {
        wordChild(snapshot).namespace.push("changed");
      },
    },
    {
      field: "word name",
      mutate(snapshot) {
        wordChild(snapshot).name = "changed";
      },
    },
  ])("compares the $field field", ({ mutate }) => {
    const snapshot = createSnapshot();
    const changed = clone(snapshot);
    mutate(changed);

    expect(areXnlSnapshotsStructurallyEqual(snapshot, changed)).toBe(false);
  });

  it("distinguishes optional field presence from empty or explicit undefined fields", () => {
    const minimal: DataElementNode = {
      kind: "DataElement",
      tag: "root",
      metadata: {},
    };

    const emptyAttributes = clone(minimal);
    emptyAttributes.attributes = {};
    const emptyBody = clone(minimal);
    emptyBody.body = [];
    const emptyExtend = clone(minimal);
    emptyExtend.extend = { order: [], children: {} };
    const undefinedId = clone(minimal);
    undefinedId.id = undefined;
    const undefinedBody = clone(minimal);
    undefinedBody.body = undefined;
    const textWithoutContent: DataElementNode = {
      ...clone(minimal),
      body: [
        {
          kind: "TextElement",
          tag: "text",
          metadata: {},
        },
      ],
    };
    const textWithUndefinedContent = clone(textWithoutContent);
    const optionalText = textWithUndefinedContent.body?.[0] as TextElementNode;
    optionalText.text = undefined;
    optionalText.textMarker = undefined;

    expect(areXnlSnapshotsStructurallyEqual(minimal, emptyAttributes)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(minimal, emptyBody)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(minimal, emptyExtend)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(minimal, undefinedId)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(minimal, undefinedBody)).toBe(false);
    expect(
      areXnlSnapshotsStructurallyEqual(
        textWithoutContent,
        textWithUndefinedContent,
      ),
    ).toBe(false);
  });

  it.each<{
    transition: string;
    createChanged: (snapshot: DataElementNode) => DataElementNode;
  }>([
    {
      transition: "root explicit #id value",
      createChanged(snapshot) {
        if (snapshot.id) snapshot.id.name = "replacement";
        return snapshot;
      },
    },
    {
      transition: "descendant explicit #id value",
      createChanged(snapshot) {
        const child = snapshot.body?.[0] as DataElementNode;
        if (child.id) child.id.name = "replacement";
        return snapshot;
      },
    },
    {
      transition: "same-value explicit-to-fallback authority",
      createChanged(snapshot) {
        delete snapshot.id;
        snapshot.metadata.id = word("workspace", ["root"]);
        return snapshot;
      },
    },
  ])("detects the $transition transition", ({ createChanged }) => {
    const snapshot = createSnapshot();
    const changed = createChanged(clone(snapshot));

    expect(areXnlSnapshotsStructurallyEqual(snapshot, changed)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(changed, snapshot)).toBe(false);
  });

  it("compares effective metadata fallback identity values", () => {
    const snapshot = createSnapshot();
    delete snapshot.id;
    snapshot.metadata.id = word("workspace", ["root"]);
    const changed = clone(snapshot);
    changed.metadata.id = word("replacement", ["root"]);

    expect(areXnlSnapshotsStructurallyEqual(snapshot, changed)).toBe(false);
    expect(areXnlSnapshotsStructurallyEqual(changed, snapshot)).toBe(false);
  });
});
