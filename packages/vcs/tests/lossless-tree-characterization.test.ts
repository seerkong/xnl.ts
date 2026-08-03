import type { DataElementNode, TextElementNode, XnlNode, XnlWord } from "xnl-core";
import {
  areXnlSnapshotsStructurallyEqual,
  VirtualFileSystem,
} from "xnl-vfs";
import { describe, expect, it } from "vitest";
import { MemoryContentStore } from "../src/content-store";
import { VcsError } from "../src/errors";
import type { ObjectId } from "../src/hash";
import * as vcsModule from "../src/index";
import {
  decodeLosslessVfsSnapshot,
  encodeLosslessVfsSnapshot,
} from "../src/lossless-ast-codec";
import { MemoryObjectStore, type ObjectStore } from "../src/object-store";
import { Repository } from "../src/repository";
import {
  buildLosslessTree,
  buildTree,
  checkoutTree,
  readLosslessTreeSnapshot,
  readTreeSnapshot,
} from "../src/tree-converter";
import type { CommitObject, TreeObject } from "../src/types";
import {
  captureRepositorySnapshot,
  deserializeRepositorySnapshot,
  deserializeRepositorySnapshotFromString,
  restoreRepositoryFromSnapshot,
  serializeRepositorySnapshot,
  serializeRepositorySnapshotToString,
} from "../src/xnl-snapshot";

type V2TreeObject = TreeObject & {
  readonly xnlVfsFormat: "xnl-vfs-v2";
  readonly xnlVfsSnapshot: NonNullable<TreeObject["xnlVfsSnapshot"]>;
};

type LosslessTreeCodec = {
  readonly buildLosslessTree: (
    snapshot: DataElementNode,
    store: MemoryObjectStore,
    contentStore: MemoryContentStore,
  ) => ObjectId;
  readonly readLosslessTreeSnapshot: (
    treeId: ObjectId,
    store: MemoryObjectStore,
    contentStore: MemoryContentStore,
  ) => DataElementNode;
};

function word(name: string, namespace: string[] = []): XnlWord {
  return { kind: "Word", namespace, name };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defineOwnDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function expectOwnDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  expect(descriptor).toMatchObject({
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function explicitId(value: unknown): XnlWord | undefined {
  if (
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "DataElement"
  ) {
    return (value as DataElementNode).id;
  }
  return undefined;
}

function expectVcsEINVAL(action: () => unknown): void {
  expect(action).toThrowError(VcsError);
  try {
    action();
  } catch (error) {
    expect((error as VcsError).code).toBe("EINVAL");
  }
}

function dataElementChildren(node: DataElementNode): DataElementNode[] {
  return (node.body ?? []).filter((child): child is DataElementNode => {
    return Boolean(
      child &&
        typeof child === "object" &&
        (child as { kind?: unknown }).kind === "DataElement",
    );
  });
}

function requireDataElement(
  node: DataElementNode,
  tag: string,
): DataElementNode {
  const child = dataElementChildren(node).find((item) => item.tag === tag);
  if (!child) {
    throw new Error(`Missing <${tag}> fixture node`);
  }
  return child;
}

function requireNestedDataElement(value: unknown, tag: string): DataElementNode {
  if (
    value &&
    typeof value === "object" &&
    (value as DataElementNode).kind === "DataElement" &&
    (value as DataElementNode).tag === tag
  ) {
    return value as DataElementNode;
  }
  throw new Error(`Missing nested <${tag}> fixture value`);
}

function requireDirectDataElementByName(
  node: DataElementNode,
  name: string,
): DataElementNode {
  const child = dataElementChildren(node).find((item) => {
    return item.metadata?.name === name;
  });
  if (!child) {
    throw new Error(`Missing fixture node named ${name}`);
  }
  return child;
}

function firstTreeId(repository: Repository): ObjectId {
  const commitId = repository.getHeadCommitId();
  if (!commitId) {
    throw new Error("Expected repository HEAD commit");
  }
  const commit = repository.store.get<CommitObject>(commitId);
  if (!commit || commit.type !== "commit") {
    throw new Error("Expected repository HEAD to resolve to a commit object");
  }
  return commit.tree;
}

function losslessCodec(): LosslessTreeCodec {
  const buildLosslessTree = Reflect.get(vcsModule, "buildLosslessTree");
  const readLosslessTreeSnapshot = Reflect.get(
    vcsModule,
    "readLosslessTreeSnapshot",
  );

  if (
    typeof buildLosslessTree !== "function" ||
    typeof readLosslessTreeSnapshot !== "function"
  ) {
    throw new Error(
      "Expected xnl-vcs to export buildLosslessTree and readLosslessTreeSnapshot for xnl-vfs-v2 codec",
    );
  }

  return {
    buildLosslessTree:
      buildLosslessTree as LosslessTreeCodec["buildLosslessTree"],
    readLosslessTreeSnapshot:
      readLosslessTreeSnapshot as LosslessTreeCodec["readLosslessTreeSnapshot"],
  };
}

function legacyVfsWithOverlappingFields(): VirtualFileSystem {
  const root: DataElementNode = {
    kind: "DataElement",
    tag: "folder",
    id: word("root-explicit", ["fixture"]),
    metadata: {
      id: "root-metadata-id",
      name: "project",
      shared: "root metadata value",
      metadataOnly: "root metadata only",
    },
    attributes: {
      nodeType: "folder",
      shared: "root attribute value",
      attributeOnly: "root attribute only",
    },
    body: [
      {
        kind: "DataElement",
        tag: "file",
        id: word("file-explicit", ["fixture"]),
        metadata: {
          id: "file-metadata-id",
          name: "note.txt",
          fileType: "text",
          shared: "file metadata value",
          metadataOnly: "file metadata only",
        },
        attributes: {
          nodeType: "file",
          content: "legacy body",
          shared: "file attribute value",
          attributeOnly: "file attribute only",
        },
      },
    ],
  };
  return new VirtualFileSystem(root);
}

function losslessSnapshot(): DataElementNode {
  const textChild: TextElementNode = {
    kind: "TextElement",
    tag: "TextBlock",
    id: word("text-explicit", ["fixture"]),
    metadata: {
      id: "text-metadata-id",
      shared: "text metadata",
    },
    attributes: {
      shared: "text attributes",
      flavor: "inline",
    },
    text: "hello from a text element",
    textMarker: "doc",
  };
  const undefinedText: TextElementNode = {
    kind: "TextElement",
    tag: "UndefinedText",
    metadata: {
      id: "undefined-text-metadata-id",
    },
    text: undefined,
    textMarker: undefined,
  };

  return {
    kind: "DataElement",
    tag: "folder",
    id: undefined,
    metadata: {
      id: "root-metadata-id",
      name: "project",
      shared: "root metadata",
      wordValue: word("metadata-word", ["fixture"]),
      negativeZero: -0,
      notNumber: NaN,
      positiveInfinity: Infinity,
      negativeInfinity: -Infinity,
      optionalElementAbsent: {
        kind: "DataElement",
        tag: "OptionalAbsent",
        metadata: {},
      },
      optionalElementUndefinedBody: {
        kind: "DataElement",
        tag: "OptionalUndefinedBody",
        metadata: {},
        body: undefined,
      },
      optionalNull: null,
    },
    attributes: {
      nodeType: "folder",
      shared: "root attributes",
      optionalElementPresent: {
        kind: "DataElement",
        tag: "OptionalPresent",
        metadata: {},
        attributes: {},
        body: [],
      },
      optionalFalse: false,
    },
    extend: {
      order: ["SecondExtension", "FirstExtension"],
      children: {
        FirstExtension: {
          kind: "DataElement",
          tag: "FirstExtension",
          id: word("first-extension", ["fixture"]),
          metadata: { id: "first-extension-meta" },
          body: ["first"],
        },
        SecondExtension: {
          kind: "TextElement",
          tag: "SecondExtension",
          id: word("second-extension", ["fixture"]),
          metadata: { id: "second-extension-meta" },
          text: "second extension text",
          textMarker: "ext",
        },
      },
    },
    body: [
      {
        kind: "DataElement",
        tag: "folder",
        id: word("child-folder-explicit", ["fixture"]),
        metadata: {
          id: "child-folder-metadata-id",
          name: "docs",
          shared: "child metadata",
        },
        attributes: {
          nodeType: "folder",
          shared: "child attributes",
        },
        body: [
          textChild,
          undefinedText,
          { kind: "Comment", value: "comment value" },
          word("body-word", ["fixture"]),
          "primitive string",
          42,
          true,
          null,
          ["array item", word("array-word", ["fixture"]), { nested: 1 }],
          { objectValue: { enabled: true } },
        ] satisfies XnlNode[],
      },
      {
        kind: "DataElement",
        tag: "folder",
        id: word("empty-folder-explicit", ["fixture"]),
        metadata: {
          id: "empty-folder-metadata-id",
          name: "empty",
        },
        attributes: {
          nodeType: "folder",
        },
        body: undefined,
      },
      {
        kind: "DataElement",
        tag: "file",
        id: word("file-explicit", ["fixture"]),
        metadata: {
          id: "file-metadata-id",
          name: "readme.txt",
          fileType: "text",
          shared: "file metadata",
        },
        attributes: {
          nodeType: "file",
          content: "readme content",
          shared: "file attributes",
        },
        extend: {
          order: ["FileSecond", "FileFirst"],
          children: {
            FileFirst: {
              kind: "DataElement",
              tag: "FileFirst",
              metadata: { id: "file-first" },
            },
            FileSecond: {
              kind: "DataElement",
              tag: "FileSecond",
              metadata: { id: "file-second" },
            },
          },
        },
      },
      {
        kind: "TextElement",
        tag: "RootText",
        id: word("root-text-explicit", ["fixture"]),
        metadata: { id: "root-text-metadata-id" },
        text: "root text",
        textMarker: "root-marker",
      },
    ],
  };
}

function losslessSnapshotWithReservedOwnKeys(): DataElementNode {
  const source = losslessSnapshot();
  source.metadata = JSON.parse(
    '{"id":"root-metadata-id","name":"project","__proto__":{"marker":"json-proto"}}',
  ) as DataElementNode["metadata"];
  defineOwnDataProperty(source.metadata, "constructor", "ctor-value");
  defineOwnDataProperty(source.metadata, "prototype", {
    marker: "defined-prototype",
  });
  source.attributes = {
    nodeType: "folder",
  };
  defineOwnDataProperty(source.attributes, "__proto__", "attribute-proto");
  defineOwnDataProperty(source.attributes, "constructor", {
    marker: "attribute-constructor",
  });
  defineOwnDataProperty(source.attributes, "prototype", "attribute-prototype");

  const child = requireDataElement(source, "file");
  child.metadata = {
    id: "file-metadata-id",
    name: "readme.txt",
  };
  defineOwnDataProperty(child.metadata, "__proto__", "child-proto");
  defineOwnDataProperty(child.metadata, "constructor", "child-constructor");
  defineOwnDataProperty(child.metadata, "prototype", "child-prototype");

  return source;
}

function expectReservedOwnKeys(snapshot: DataElementNode): void {
  expectOwnDataProperty(snapshot.metadata, "__proto__", {
    marker: "json-proto",
  });
  expectOwnDataProperty(snapshot.metadata, "constructor", "ctor-value");
  expectOwnDataProperty(snapshot.metadata, "prototype", {
    marker: "defined-prototype",
  });
  expectOwnDataProperty(
    snapshot.attributes as Record<string, unknown>,
    "__proto__",
    "attribute-proto",
  );
  expectOwnDataProperty(
    snapshot.attributes as Record<string, unknown>,
    "constructor",
    { marker: "attribute-constructor" },
  );
  expectOwnDataProperty(
    snapshot.attributes as Record<string, unknown>,
    "prototype",
    "attribute-prototype",
  );

  const child = requireDataElement(snapshot, "file");
  expectOwnDataProperty(child.metadata, "__proto__", "child-proto");
  expectOwnDataProperty(child.metadata, "constructor", "child-constructor");
  expectOwnDataProperty(child.metadata, "prototype", "child-prototype");
}

function reorderObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reorderObjectKeys) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
    defineOwnDataProperty(
      out,
      key,
      reorderObjectKeys((value as Record<string, unknown>)[key]),
    );
  }
  return out as T;
}

function putV2Tree(
  repository: Repository,
  snapshot: DataElementNode,
): { treeId: ObjectId; commitId: ObjectId; tree: V2TreeObject } {
  const treeId = buildLosslessTree(
    snapshot,
    repository.store,
    repository.contentStore,
  );
  const tree = repository.store.get<V2TreeObject>(treeId);
  if (!tree || tree.xnlVfsFormat !== "xnl-vfs-v2") {
    throw new Error("Expected buildLosslessTree to create an xnl-vfs-v2 tree");
  }
  const commit: CommitObject = {
    type: "commit",
    tree: treeId,
    parents: [],
    author: "characterization",
    message: "manual v2 tree fixture",
    timestamp: "2026-07-30T00:00:00.000Z",
  };
  const commitId = repository.store.put(commit);
  return { treeId, commitId, tree };
}

function singleObjectStore(objectId: ObjectId, object: TreeObject): ObjectStore {
  return {
    put() {
      throw new Error("singleObjectStore is read-only");
    },
    get<T>(id: ObjectId): T | null {
      return id === objectId ? (object as T) : null;
    },
    has(id: ObjectId): boolean {
      return id === objectId;
    },
    list(): ObjectId[] {
      return [objectId];
    },
  };
}

function encodedString(value: string): unknown {
  return { type: "string", value };
}

function encodedDataElementRoot(
  tag: string,
  metadataEntries: unknown[] = [
    { key: "id", value: encodedString("root-metadata-id") },
    { key: "name", value: encodedString("project") },
  ],
): unknown {
  return {
    type: "object",
    entries: [
      { key: "kind", value: encodedString("DataElement") },
      { key: "tag", value: encodedString(tag) },
      {
        key: "metadata",
        value: {
          type: "object",
          entries: metadataEntries,
        },
      },
    ],
  };
}

function encodedFolderWithBodyItems(items: unknown[]): unknown {
  return {
    type: "object",
    entries: [
      { key: "kind", value: encodedString("DataElement") },
      { key: "tag", value: encodedString("folder") },
      {
        key: "metadata",
        value: {
          type: "object",
          entries: [
            { key: "id", value: encodedString("root-metadata-id") },
            { key: "name", value: encodedString("project") },
          ],
        },
      },
      {
        key: "body",
        value: {
          type: "array",
          items,
        },
      },
    ],
  };
}

function treeWithPayload(payload: unknown): TreeObject {
  return {
    type: "tree",
    name: "project",
    metadataId: "root-metadata-id",
    entries: [],
    xnlVfsFormat: "xnl-vfs-v2",
    xnlVfsSnapshot: payload as NonNullable<TreeObject["xnlVfsSnapshot"]>,
  };
}

function expectPayloadRejectedThroughDirectDecodeAndTreeRead(payload: unknown): void {
  expectVcsEINVAL(() => decodeLosslessVfsSnapshot(payload));

  const treeId = "crafted-v2-payload-tree";
  expectVcsEINVAL(() =>
    readTreeSnapshot(
      treeId,
      singleObjectStore(treeId, treeWithPayload(payload)),
      new MemoryContentStore(),
    ),
  );
}

function sparseEncodedItems(): unknown[] {
  const items = [encodedString("first")];
  items.length = 2;
  return items;
}

function customStringPropEncodedItems(): unknown[] {
  const items = [encodedString("first")];
  Object.defineProperty(items, "custom", {
    value: encodedString("custom"),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return items;
}

function symbolPropEncodedItems(): unknown[] {
  const items = [encodedString("first")];
  Object.defineProperty(items, Symbol("encoded-array-symbol"), {
    value: encodedString("symbol"),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return items;
}

function encodedEntry(key: string, value: unknown = encodedString("value")): unknown {
  return { key, value };
}

function sparseEncodedEntries(): unknown[] {
  const entries = [encodedEntry("first")];
  entries.length = 2;
  return entries;
}

function customStringPropEncodedEntries(): unknown[] {
  const entries = [encodedEntry("first")];
  Object.defineProperty(entries, "custom", {
    value: encodedEntry("custom"),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return entries;
}

function symbolPropEncodedEntries(): unknown[] {
  const entries = [encodedEntry("first")];
  Object.defineProperty(entries, Symbol("encoded-entries-symbol"), {
    value: encodedEntry("symbol"),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return entries;
}

function withInheritedObjectPrototypeField(
  key: string,
  value: unknown,
  action: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  try {
    action();
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, key, original);
    } else {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  }
}

function transportRecordWithAccessorType(): unknown {
  const record = {};
  Object.defineProperty(record, "type", {
    get() {
      throw new Error("transport getter must not be read");
    },
    enumerable: true,
    configurable: true,
  });
  return record;
}

function transportRecordWithNonEnumerableType(): unknown {
  const record = {};
  Object.defineProperty(record, "type", {
    value: "null",
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return record;
}

function transportRecordWithSymbolKey(): unknown {
  const record = { type: "null" };
  Object.defineProperty(record, Symbol("transport-symbol"), {
    value: true,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return record;
}

function objectPayloadWithEntry(entry: unknown): unknown {
  return {
    type: "object",
    entries: [entry],
  };
}

describe("legacy tree codec characterization", () => {
  it("documents that the unversioned tree projection drops explicit #id", () => {
    const source = legacyVfsWithOverlappingFields();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();

    const treeId = buildTree(source, store, contentStore);
    const restored = readTreeSnapshot(treeId, store, contentStore);
    const restoredFile = requireDataElement(restored, "file");

    expect(explicitId(source.getSnapshot())).toEqual(
      word("root-explicit", ["fixture"]),
    );
    expect(explicitId(restored)).toBeUndefined();
    expect(explicitId(restoredFile)).toBeUndefined();
    expect(restored.metadata.id).toBe("root-metadata-id");
    expect(restoredFile.metadata.id).toBe("file-metadata-id");
  });

  it("documents that legacy metadata and attributes business keys are merged into attributes", () => {
    const source = legacyVfsWithOverlappingFields();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();

    const treeId = buildTree(source, store, contentStore);
    const restored = readTreeSnapshot(treeId, store, contentStore);
    const restoredFile = requireDataElement(restored, "file");

    expect(restored.metadata.shared).toBeUndefined();
    expect(restored.metadata.metadataOnly).toBeUndefined();
    expect(restored.attributes?.shared).toBe("root attribute value");
    expect(restored.attributes?.metadataOnly).toBe("root metadata only");
    expect(restored.attributes?.attributeOnly).toBe("root attribute only");

    expect(restoredFile.metadata.shared).toBeUndefined();
    expect(restoredFile.metadata.metadataOnly).toBeUndefined();
    expect(restoredFile.attributes?.shared).toBe("file attribute value");
    expect(restoredFile.attributes?.metadataOnly).toBe("file metadata only");
    expect(restoredFile.attributes?.attributeOnly).toBe("file attribute only");
  });

  it("keeps unversioned legacy tree objects readable through fallback decoding", () => {
    const source = legacyVfsWithOverlappingFields();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();

    const treeId = buildTree(source, store, contentStore);
    const tree = store.get<TreeObject>(treeId);
    const restored = readTreeSnapshot(treeId, store, contentStore);

    expect(tree).toMatchObject({ type: "tree", entries: expect.any(Array) });
    expect(tree).not.toHaveProperty("xnlVfsFormat");
    expect(restored.tag).toBe("folder");
    expect(restored.metadata.name).toBe("project");
    expect(requireDataElement(restored, "file").attributes?.content).toBe(
      "legacy body",
    );
  });

  it("keeps legacy fallback on the general reader but rejects it on the lossless reader", () => {
    const source = legacyVfsWithOverlappingFields();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();

    const treeId = buildTree(source, store, contentStore);
    const restored = readTreeSnapshot(treeId, store, contentStore);

    expect(restored.tag).toBe("folder");
    expect(restored.metadata.name).toBe("project");
    expectVcsEINVAL(() =>
      readLosslessTreeSnapshot(treeId, store, contentStore),
    );
  });
});

describe("xnl-vfs-v2 lossless tree characterization", () => {
  it("requires a supported marker and well-formed payload on the lossless reader", () => {
    const cases: TreeObject[] = [
      {
        type: "tree",
        name: "project",
        metadataId: "root-metadata-id",
        entries: [],
        xnlVfsFormat: "xnl-vfs-v3",
        xnlVfsSnapshot: encodedDataElementRoot("folder"),
      } as unknown as TreeObject,
      {
        type: "tree",
        name: "project",
        metadataId: "root-metadata-id",
        entries: [],
        xnlVfsFormat: "xnl-vfs-v2",
      },
      treeWithPayload({ type: "number", value: "not-a-number" }),
    ];

    for (const [index, tree] of cases.entries()) {
      const treeId = `strict-invalid-v2-tree-${index}`;
      expectVcsEINVAL(() =>
        readLosslessTreeSnapshot(
          treeId,
          singleObjectStore(treeId, tree),
          new MemoryContentStore(),
        ),
      );
    }
  });

  it("reads a valid v2 payload exactly through the lossless reader", () => {
    const source = losslessSnapshot();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const treeId = buildLosslessTree(source, store, contentStore);

    const restored = readLosslessTreeSnapshot(
      treeId,
      store,
      contentStore,
    );

    expect(areXnlSnapshotsStructurallyEqual(restored, source)).toBe(true);
    expect(restored).toEqual(source);
  });

  it("round-trips the complete AST through a future v2 tree codec", () => {
    const source = losslessSnapshot();
    const present = requireNestedDataElement(
      source.attributes?.optionalElementPresent,
      "OptionalPresent",
    );
    const absent = requireNestedDataElement(
      source.metadata.optionalElementAbsent,
      "OptionalAbsent",
    );
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const codec = losslessCodec();

    expect(Object.prototype.hasOwnProperty.call(present, "attributes")).toBe(
      true,
    );
    expect(Object.prototype.hasOwnProperty.call(present, "body")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(absent, "attributes")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(absent, "body")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(source, "id")).toBe(true);
    expect(source.id).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        source.metadata.optionalElementUndefinedBody as DataElementNode,
        "body",
      ),
    ).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(
        requireDirectDataElementByName(source, "empty"),
        "body",
      ),
    ).toBe(true);
    expect(Object.is(source.metadata.negativeZero, -0)).toBe(true);
    expect(Number.isNaN(source.metadata.notNumber)).toBe(true);
    expect(source.extend?.order).toEqual(["SecondExtension", "FirstExtension"]);

    const directlyDecoded = decodeLosslessVfsSnapshot(
      encodeLosslessVfsSnapshot(source),
    );
    expect(areXnlSnapshotsStructurallyEqual(directlyDecoded, source)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(directlyDecoded, "id")).toBe(true);
    expect(directlyDecoded.id).toBeUndefined();

    const treeId = codec.buildLosslessTree(source, store, contentStore);
    const restored = codec.readLosslessTreeSnapshot(
      treeId,
      store,
      contentStore,
    );

    expect(areXnlSnapshotsStructurallyEqual(restored, source)).toBe(true);
    expect(restored).toEqual(source);
    expect(Object.prototype.hasOwnProperty.call(restored, "id")).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(
        requireDirectDataElementByName(restored, "empty"),
        "body",
      ),
    ).toBe(true);
    const restoredChildFolder = requireDataElement(restored, "folder");
    const restoredUndefinedText = (restoredChildFolder.body ?? []).find(
      (child): child is TextElementNode =>
        Boolean(
          child &&
            typeof child === "object" &&
            (child as TextElementNode).kind === "TextElement" &&
            (child as TextElementNode).tag === "UndefinedText",
        ),
    );
    expect(restoredUndefinedText).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(restoredUndefinedText as TextElementNode, "text")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(restoredUndefinedText as TextElementNode, "textMarker")).toBe(true);
  });

  it("preserves reserved own data keys through build, read, checkout, and snapshot restore", () => {
    const source = losslessSnapshotWithReservedOwnKeys();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const target = new VirtualFileSystem();

    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).marker).toBeUndefined();

    const treeId = buildLosslessTree(source, store, contentStore);
    const restored = readTreeSnapshot(treeId, store, contentStore);
    const checkedOut = checkoutTree(treeId, target, store, contentStore);

    expect(areXnlSnapshotsStructurallyEqual(restored, source)).toBe(true);
    expect(areXnlSnapshotsStructurallyEqual(checkedOut, source)).toBe(true);
    expect(areXnlSnapshotsStructurallyEqual(target.getSnapshot(), source)).toBe(
      true,
    );
    expectReservedOwnKeys(restored);
    expectReservedOwnKeys(checkedOut);
    expectReservedOwnKeys(target.getSnapshot());
    expect(({} as Record<string, unknown>).marker).toBeUndefined();

    const repository = new Repository();
    repository.init();
    const { commitId } = putV2Tree(repository, source);
    repository.checkout(commitId, { force: true });
    const captured = captureRepositorySnapshot(repository);
    const nodeRestoredRepository = restoreRepositoryFromSnapshot(
      deserializeRepositorySnapshot(serializeRepositorySnapshot(captured)),
    );
    const stringRestoredRepository = restoreRepositoryFromSnapshot(
      deserializeRepositorySnapshotFromString(
        serializeRepositorySnapshotToString(captured),
      ),
    );

    for (const restoredRepository of [
      nodeRestoredRepository,
      stringRestoredRepository,
    ]) {
      const restoredSnapshot = restoredRepository.vfs.getSnapshot();
      expect(areXnlSnapshotsStructurallyEqual(restoredSnapshot, source)).toBe(
        true,
      );
      expectReservedOwnKeys(restoredSnapshot);
      expect(
        areXnlSnapshotsStructurallyEqual(
          readTreeSnapshot(
            firstTreeId(restoredRepository),
            restoredRepository.store,
            restoredRepository.contentStore,
          ),
          source,
        ),
      ).toBe(true);
    }
  });

  it("uses locale-independent canonical key order for equivalent snapshots", () => {
    const source = losslessSnapshotWithReservedOwnKeys();
    source.metadata.z = "z-value";
    source.metadata.a = "a-value";
    source.metadata.A = "A-value";
    source.metadata["\u00e4"] = "a-umlaut-value";

    const reordered = reorderObjectKeys(source);
    const encoded = encodeLosslessVfsSnapshot(source);
    const reorderedEncoded = encodeLosslessVfsSnapshot(reordered);
    const metadataEntry = encoded.type === "object"
      ? encoded.entries.find((entry) => entry.key === "metadata")
      : undefined;
    if (!metadataEntry || metadataEntry.value.type !== "object") {
      throw new Error("Expected encoded metadata object entry");
    }

    expect(metadataEntry.value.entries.map((entry) => entry.key)).toEqual([
      "A",
      "__proto__",
      "a",
      "constructor",
      "id",
      "name",
      "prototype",
      "z",
      "\u00e4",
    ]);
    expect(reorderedEncoded).toEqual(encoded);

    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const reorderedStore = new MemoryObjectStore();
    const reorderedContentStore = new MemoryContentStore();

    expect(buildLosslessTree(source, store, contentStore)).toBe(
      buildLosslessTree(reordered, reorderedStore, reorderedContentStore),
    );
  });

  it("rejects duplicate v2 object entries while retaining malformed payload guards", () => {
    expectVcsEINVAL(() =>
      decodeLosslessVfsSnapshot({
        type: "object",
        entries: [
          { key: "__proto__", value: { type: "string", value: "first" } },
          { key: "__proto__", value: { type: "string", value: "second" } },
        ],
      }),
    );
    expectVcsEINVAL(() =>
      decodeLosslessVfsSnapshot({ type: "number", value: "not-a-number" }),
    );
    expectVcsEINVAL(() =>
      decodeLosslessVfsSnapshot({
        type: "object",
        entries: [{ key: "missing-value" }],
      }),
    );
  });

  it("rejects inherited transport fields instead of reading them", () => {
    withInheritedObjectPrototypeField("type", "null", () => {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead({});
    });
    withInheritedObjectPrototypeField("entries", [], () => {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead({
        type: "object",
      });
    });
    withInheritedObjectPrototypeField("value", encodedString("DataElement"), () => {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead(
        objectPayloadWithEntry({ key: "kind" }),
      );
    });
  });

  it("rejects accessor, non-enumerable, and symbol transport record properties", () => {
    for (const payload of [
      transportRecordWithAccessorType(),
      transportRecordWithNonEnumerableType(),
      transportRecordWithSymbolKey(),
      objectPayloadWithEntry({
        get key() {
          throw new Error("entry getter must not be read");
        },
        value: encodedString("DataElement"),
      }),
      objectPayloadWithEntry(
        Object.defineProperty({ value: encodedString("DataElement") }, "key", {
          value: "kind",
          enumerable: false,
          writable: true,
          configurable: true,
        }),
      ),
      objectPayloadWithEntry(
        Object.defineProperty(
          { key: "kind", value: encodedString("DataElement") },
          Symbol("entry-symbol"),
          {
            value: true,
            enumerable: true,
            writable: true,
            configurable: true,
          },
        ),
      ),
    ]) {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead(payload);
    }
  });

  it("rejects extra transport tag and object entry fields", () => {
    for (const payload of [
      { type: "undefined", value: "extra" },
      { type: "null", extra: true },
      { type: "boolean", value: true, extra: true },
      { type: "string", value: "root", extra: true },
      { type: "number", value: "1", extra: true },
      { type: "array", items: [], extra: true },
      { type: "object", entries: [], extra: true },
      objectPayloadWithEntry({
        key: "kind",
        value: encodedString("DataElement"),
        extra: true,
      }),
    ]) {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead(payload);
    }
  });

  it("rejects missing own required transport fields", () => {
    for (const payload of [
      {},
      { type: "boolean" },
      { type: "string" },
      { type: "number" },
      { type: "array" },
      { type: "object" },
      objectPayloadWithEntry({ value: encodedString("DataElement") }),
      objectPayloadWithEntry({ key: "kind" }),
    ]) {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead(payload);
    }
  });

  it("rejects direct non-root payloads and crafted v2 tree non-roots", () => {
    for (const payload of [
      { type: "undefined" },
      { type: "null" },
      { type: "boolean", value: true },
      encodedString("not-a-root"),
      { type: "number", value: "1" },
      { type: "array", items: [] },
      { type: "object", entries: [] },
      encodedDataElementRoot("file"),
      encodedDataElementRoot("folder", [
        { key: "id", value: encodedString("") },
        { key: "name", value: encodedString("project") },
      ]),
      encodedDataElementRoot("folder", [
        { key: "id", value: encodedString("root-metadata-id") },
      ]),
      encodedDataElementRoot("folder", [
        { key: "id", value: encodedString("root-metadata-id") },
        { key: "name", value: encodedString("") },
      ]),
    ]) {
      expectPayloadRejectedThroughDirectDecodeAndTreeRead(payload);
    }
  });

  it.each([
    ["sparse", sparseEncodedItems],
    ["custom string property", customStringPropEncodedItems],
    ["symbol property", symbolPropEncodedItems],
  ] as const)(
    "rejects malformed encoded array items with %s through direct decode and v2 tree read",
    (_label, createItems) => {
      expectVcsEINVAL(() =>
        decodeLosslessVfsSnapshot({
          type: "array",
          items: createItems(),
        }),
      );

      const treeId = "malformed-encoded-array-tree";
      const tree = treeWithPayload(encodedFolderWithBodyItems(createItems()));

      expectVcsEINVAL(() =>
        readTreeSnapshot(
          treeId,
          singleObjectStore(treeId, tree),
          new MemoryContentStore(),
        ),
      );
    },
  );

  it.each([
    ["sparse", sparseEncodedEntries],
    ["custom string property", customStringPropEncodedEntries],
    ["symbol property", symbolPropEncodedEntries],
  ] as const)(
    "rejects malformed encoded object entries with %s",
    (_label, createEntries) => {
      expectVcsEINVAL(() =>
        decodeLosslessVfsSnapshot({
          type: "object",
          entries: createEntries(),
        }),
      );
    },
  );

  it.each(["node", "string"] as const)(
    "keeps v2 tree object ids stable after RepositorySnapshot %s serialization",
    (mode) => {
      const source = losslessSnapshot();
      const repository = new Repository();
      repository.init();
      const { treeId, commitId, tree } = putV2Tree(repository, source);
      repository.checkout(commitId, { force: true });

      expect(
        areXnlSnapshotsStructurallyEqual(repository.vfs.getSnapshot(), source),
      ).toBe(true);
      expect(repository.status().clean).toBe(true);

      const captured = captureRepositorySnapshot(repository);
      const serialized =
        mode === "node"
          ? deserializeRepositorySnapshot(serializeRepositorySnapshot(captured))
          : deserializeRepositorySnapshotFromString(
              serializeRepositorySnapshotToString(captured),
            );

      expect(serialized.objects[treeId]).toEqual(tree);
      const restoredRepository = restoreRepositoryFromSnapshot(serialized);
      expect(restoredRepository.store.get(treeId)).toEqual(tree);
      expect(firstTreeId(restoredRepository)).toBe(treeId);
      expect(
        areXnlSnapshotsStructurallyEqual(
          restoredRepository.vfs.getSnapshot(),
          source,
        ),
      ).toBe(true);
      expect(restoredRepository.status().clean).toBe(true);

      const restoredSnapshot = readTreeSnapshot(
        treeId,
        restoredRepository.store,
        restoredRepository.contentStore,
      );
      expect(areXnlSnapshotsStructurallyEqual(restoredSnapshot, source)).toBe(
        true,
      );
    },
  );

  it("rejects malformed v2 tree objects instead of falling back to legacy entries", () => {
    const source = losslessSnapshot();
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();
    const target = new VirtualFileSystem();

    const unsupportedFormatId = store.put({
      type: "tree",
      name: "project",
      metadataId: "root-metadata-id",
      entries: [],
      xnlVfsFormat: "xnl-vfs-v3",
      xnlVfsSnapshot: clone(source),
    } as unknown as TreeObject);
    const missingPayloadId = store.put({
      type: "tree",
      name: "project",
      metadataId: "root-metadata-id",
      entries: [],
      xnlVfsFormat: "xnl-vfs-v2",
    } as unknown as TreeObject);
    const rawPayloadId = store.put({
      type: "tree",
      name: "project",
      metadataId: "root-metadata-id",
      entries: [],
      xnlVfsFormat: "xnl-vfs-v2",
      xnlVfsSnapshot: clone(source),
    } as unknown as TreeObject);

    expectVcsEINVAL(() =>
      readTreeSnapshot(unsupportedFormatId, store, contentStore),
    );
    expectVcsEINVAL(() =>
      checkoutTree(unsupportedFormatId, target, store, contentStore),
    );
    expectVcsEINVAL(() => readTreeSnapshot(missingPayloadId, store, contentStore));
    expectVcsEINVAL(() => checkoutTree(missingPayloadId, target, store, contentStore));
    expectVcsEINVAL(() => readTreeSnapshot(rawPayloadId, store, contentStore));
    expectVcsEINVAL(() => checkoutTree(rawPayloadId, target, store, contentStore));
  });

  it("rejects non-XNL runtime values before storing v2 payloads", () => {
    const store = new MemoryObjectStore();
    const contentStore = new MemoryContentStore();

    const cases: unknown[] = [
      () => undefined,
      Symbol("not-xnl"),
      BigInt(1),
      new Date(0),
      Object.assign(["valid-index"], { custom: "not-xnl" }),
    ];

    for (const value of cases) {
      const source = losslessSnapshot();
      (source.metadata as Record<string, unknown>).invalid = value;
      expectVcsEINVAL(() => buildLosslessTree(source, store, contentStore));
    }

    const cyclic = losslessSnapshot();
    (cyclic.metadata as Record<string, unknown>).invalid = cyclic;
    expectVcsEINVAL(() => buildLosslessTree(cyclic, store, contentStore));
  });

  it("rejects malformed serialized v2 tree objects instead of falling back to legacy entries", () => {
    const repositorySnapshot = (treeAttributes: DataElementNode["attributes"]) =>
      ({
        kind: "DataElement",
        tag: "RepositorySnapshot",
        metadata: {
          id: "repository-snapshot",
          name: "RepositorySnapshot",
          version: "2",
        },
        attributes: {
          headType: "branch",
          headValue: "main",
        },
        body: [
          {
            kind: "DataElement",
            tag: "Refs",
            metadata: {},
            body: [],
          },
          {
            kind: "DataElement",
            tag: "Objects",
            metadata: {},
            body: [
              {
                kind: "DataElement",
                tag: "Tree",
                metadata: {
                  id: "tree-object",
                  name: "project",
                },
                attributes: treeAttributes,
                body: [
                  {
                    kind: "DataElement",
                    tag: "Entries",
                    metadata: {},
                    body: [],
                  },
                ],
              },
            ],
          },
        ],
      }) satisfies DataElementNode;

    expectVcsEINVAL(() =>
      deserializeRepositorySnapshot(
        repositorySnapshot({
          metadataId: "root-metadata-id",
          xnlVfsFormat: "xnl-vfs-v3",
        }),
      ),
    );
    expectVcsEINVAL(() =>
      deserializeRepositorySnapshot(
        repositorySnapshot({
          metadataId: "root-metadata-id",
          xnlVfsFormat: "xnl-vfs-v2",
        }),
      ),
    );
    expectVcsEINVAL(() =>
      deserializeRepositorySnapshot(
        repositorySnapshot({
          metadataId: "root-metadata-id",
          xnlVfsFormat: "xnl-vfs-v2",
          xnlVfsSnapshotJson: JSON.stringify({ type: "number", value: "not-a-number" }),
        }),
      ),
    );
  });
});
