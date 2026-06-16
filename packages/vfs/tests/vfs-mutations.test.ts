import { describe, expect, it } from "vitest";
import { VfsError } from "../src/errors";
import { applyVfsMutations, diffVfs } from "../src/mutation-bridge";
import { applyVfsSnapshotMutations, diffVfsSnapshots, toXnlMutations, type VfsMutation } from "../src/vfs-mutations";
import { VirtualFileSystem } from "../src/vfs";

describe("vfs mutations", () => {
  it("diff/apply roundtrip preserves rename, move, and content updates", () => {
    const vfsA = new VirtualFileSystem();
    vfsA.mkdir("vfs:///src", { recursive: true });
    vfsA.mkdir("vfs:///dst", { recursive: true });
    vfsA.writeFile("vfs:///src/a.txt", "a", { fileType: "text" });
    vfsA.writeFile("vfs:///src/b.txt", "b", { fileType: "text" });
    const aId = vfsA.stat("vfs:///src/a.txt").metadataId;
    const bId = vfsA.stat("vfs:///src/b.txt").metadataId;

    const vfsB = new VirtualFileSystem(vfsA.getSnapshot());
    vfsB.rename("vfs:///src/a.txt", "vfs:///src/a-renamed.txt");
    vfsB.rename("vfs:///src/b.txt", "vfs:///dst/b.txt");
    vfsB.writeFile("vfs:///dst/b.txt", "B", { overwrite: true, fileType: "text" });

    const from = vfsA.getSnapshot();
    const to = vfsB.getSnapshot();
    const mutations = diffVfsSnapshots(from, to);

    expect(mutations.some((mutation) => mutation.type === "RENAME" && mutation.expectedId === aId)).toBe(true);
    expect(mutations.some((mutation) => mutation.type === "MOVE" && mutation.expectedId === bId)).toBe(true);
    expect(mutations.some((mutation) => mutation.type === "CONTENT_UPDATE" && mutation.expectedId === bId)).toBe(true);

    const applied = applyVfsSnapshotMutations(from, mutations);
    expect(applied).toEqual(to);
  });

  it("translates VFS mutation batches to equivalent XNL mutation batches", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.mkdir("vfs:///docs", { recursive: true });
    source.writeFile("vfs:///src/main.ts", "export const v = 1;", { fileType: "text" });
    const fileId = source.stat("vfs:///src/main.ts").metadataId;

    const base = source.getSnapshot();
    const mutations: VfsMutation[] = [
      {
        type: "CONTENT_UPDATE",
        path: "vfs:///src/main.ts",
        expectedId: fileId,
        payload: {
          content: "<Main [ <Version { value = 2 }> ]>",
          fileType: "xnl",
        },
      },
      {
        type: "META_UPDATE",
        path: "vfs:///src/main.ts",
        expectedId: fileId,
        payload: {
          attributeMutation: [
            {
              type: "OBJECT_UPDATE",
              path: ":attributes::'language'",
              valueAfter: "xnl",
            },
          ],
        },
      },
      {
        type: "EXTEND_UPDATE",
        path: "vfs:///src/main.ts",
        expectedId: fileId,
        payload: {
          extendMutation: [
            {
              type: "OBJECT_UPDATE",
              path: ":extend",
              valueAfter: {
                order: ["RuntimeExt"],
                children: {
                  RuntimeExt: {
                    kind: "DataElement",
                    tag: "RuntimeExt",
                    metadata: {
                      enabled: true,
                    },
                  },
                },
              },
            },
          ],
        },
      },
      {
        type: "MOVE",
        path: "vfs:///src/main.ts",
        targetPath: "vfs:///docs/main.ts",
        expectedId: fileId,
      },
    ];

    const translated = toXnlMutations(base, mutations);
    expect(translated.length).toBeGreaterThan(0);
    expect(translated.some((mutation) => String(mutation.type).startsWith("TREE_MOVE"))).toBe(true);
    expect(translated.some((mutation) => mutation.type === "OBJECT_UPDATE")).toBe(true);

    const fromVfsMutations = applyVfsSnapshotMutations(base, mutations);
    const fromXnlMutations = applyVfsMutations(base, translated);
    expect(fromXnlMutations).toEqual(fromVfsMutations);
  });

  it("keeps mutation bridge behavior aligned with VFS mutation translation", () => {
    const vfsA = new VirtualFileSystem();
    vfsA.mkdir("vfs:///src", { recursive: true });
    vfsA.mkdir("vfs:///lib", { recursive: true });
    vfsA.writeFile("vfs:///src/a.ts", "export const a = 1;", { fileType: "text" });

    const vfsB = new VirtualFileSystem(vfsA.getSnapshot());
    vfsB.rename("vfs:///src/a.ts", "vfs:///lib/a.ts");
    vfsB.writeFile("vfs:///lib/a.ts", "export const a = 2;", { overwrite: true, fileType: "text" });

    const from = vfsA.getSnapshot();
    const to = vfsB.getSnapshot();
    const vfsMutations = diffVfsSnapshots(from, to);
    const translated = toXnlMutations(from, vfsMutations);

    expect(diffVfs(from, to)).toEqual(translated);
    expect(applyVfsMutations(from, vfsMutations)).toEqual(to);
    expect(applyVfsMutations(from, translated)).toEqual(to);
  });

  it("emits contentMutation payload for xnl content updates", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/doc.xnl", `<Root [ <Item id="item-1" { value = 1 }> ]>`, { fileType: "xnl" });

    const target = new VirtualFileSystem(source.getSnapshot());
    target.writeFile("vfs:///src/doc.xnl", `<Root [ <Item id="item-1" { value = 2 }> ]>`, {
      overwrite: true,
      fileType: "xnl",
    });

    const from = source.getSnapshot();
    const to = target.getSnapshot();
    const mutations = diffVfsSnapshots(from, to);
    const contentUpdates = mutations.filter(
      (mutation) => mutation.type === "CONTENT_UPDATE" && mutation.path === "vfs:///src/doc.xnl",
    );

    expect(contentUpdates).toHaveLength(1);
    const [update] = contentUpdates;
    expect(update.payload?.fileType).toBe("xnl");
    expect(Array.isArray(update.payload?.contentMutation)).toBe(true);
    expect(update.payload?.contentMutation?.length ?? 0).toBeGreaterThan(0);
    expect(update.payload?.content).toBeUndefined();

    const applied = applyVfsSnapshotMutations(from, mutations);
    expect(applied).toEqual(to);
  });

  it("keeps contentMutation payload when fileType changes from text to xnl", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/model.xnl", `<Root [ <Node id="n1"> ]>`, { fileType: "text" });

    const target = new VirtualFileSystem(source.getSnapshot());
    target.writeFile("vfs:///src/model.xnl", `<Root [ <Node id="n1"> ]>`, {
      overwrite: true,
      fileType: "xnl",
    });

    const from = source.getSnapshot();
    const to = target.getSnapshot();
    const mutations = diffVfsSnapshots(from, to);
    const contentUpdate = mutations.find(
      (mutation) => mutation.type === "CONTENT_UPDATE" && mutation.path === "vfs:///src/model.xnl",
    );

    expect(contentUpdate?.payload?.fileType).toBe("xnl");
    expect(Array.isArray(contentUpdate?.payload?.contentMutation)).toBe(true);

    const applied = applyVfsSnapshotMutations(from, mutations);
    expect(applied).toEqual(to);
  });

  it("applies CONTENT_UPDATE with manual contentMutation payload", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/manual.xnl", `<Root [ <Item id="item-1" { value = 1 }> ]>`, { fileType: "xnl" });
    const fileId = source.stat("vfs:///src/manual.xnl").metadataId;

    const mutations: VfsMutation[] = [
      {
        type: "CONTENT_UPDATE",
        path: "vfs:///src/manual.xnl",
        expectedId: fileId,
        payload: {
          fileType: "xnl",
          contentMutation: [
            {
              type: "OBJECT_UPDATE",
              path: "<id='item-1'>:attributes::'value'",
              valueAfter: 2,
            },
          ],
        },
      },
    ];

    const applied = applyVfsSnapshotMutations(source.getSnapshot(), mutations);
    const expected = new VirtualFileSystem(source.getSnapshot());
    expected.writeFile("vfs:///src/manual.xnl", `<Root [ <Item id="item-1" { value = 2 }> ]>`, {
      overwrite: true,
      fileType: "xnl",
    });

    expect(applied).toEqual(expected.getSnapshot());
  });

  it("keeps expectedId in default mode", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/plain.txt", "a", { fileType: "text" });

    const target = new VirtualFileSystem(source.getSnapshot());
    target.writeFile("vfs:///src/plain.txt", "b", { overwrite: true, fileType: "text" });

    const mutations = diffVfsSnapshots(source.getSnapshot(), target.getSnapshot());
    const contentUpdate = mutations.find((mutation) => mutation.type === "CONTENT_UPDATE" && mutation.path === "vfs:///src/plain.txt");

    expect(contentUpdate).toBeDefined();
    expect(contentUpdate?.expectedId).toBeTypeOf("string");
  });

  it("omits expectedId for plain nodes when sparse-sidecar mode is enabled", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/plain.txt", "a", { fileType: "text" });

    const target = new VirtualFileSystem(source.getSnapshot());
    target.writeFile("vfs:///src/plain.txt", "b", { overwrite: true, fileType: "text" });
    target.writeFile("vfs:///src/new.txt", "new", { fileType: "text" });

    const options = { skipSidecarWhenNoExtensionMetadata: true };
    const mutations = diffVfsSnapshots(source.getSnapshot(), target.getSnapshot(), options);
    const contentUpdate = mutations.find((mutation) => mutation.type === "CONTENT_UPDATE" && mutation.path === "vfs:///src/plain.txt");
    const fileCreate = mutations.find((mutation) => mutation.type === "FILE_CREATE" && mutation.path === "vfs:///src/new.txt");

    expect(contentUpdate).toBeDefined();
    expect(contentUpdate?.expectedId).toBeUndefined();
    expect(fileCreate).toBeDefined();
    expect(fileCreate?.expectedId).toBeUndefined();
    expect(fileCreate?.payload?.metadataMutation?.some((mutation) => mutation.path === ":metadata::'id'" && typeof mutation.valueAfter === "string")).toBe(true);

    const applied = applyVfsSnapshotMutations(source.getSnapshot(), mutations, options);
    expect(applied).toEqual(target.getSnapshot());
  });

  it("throws EINVAL for explicit expectedId mismatch in sparse-sidecar mode", () => {
    const source = new VirtualFileSystem();
    source.mkdir("vfs:///src", { recursive: true });
    source.writeFile("vfs:///src/plain.txt", "a", { fileType: "text" });
    const stat = source.stat("vfs:///src/plain.txt");

    const mismatchMutation: VfsMutation = {
      type: "CONTENT_UPDATE",
      path: "vfs:///src/plain.txt",
      expectedId: `${stat.metadataId}-mismatch`,
      payload: {
        content: "b",
        fileType: "text",
      },
    };

    const options = { skipSidecarWhenNoExtensionMetadata: true };
    expect(() => applyVfsSnapshotMutations(source.getSnapshot(), [mismatchMutation], options)).toThrowError(VfsError);
    try {
      applyVfsSnapshotMutations(source.getSnapshot(), [mismatchMutation], options);
    } catch (err) {
      expect((err as VfsError).code).toBe("EINVAL");
    }
  });
});
