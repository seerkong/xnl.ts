import type { DataElementNode } from "xnl-core";
import { describe, expect, it, vi } from "vitest";
import { applyVfsMutations } from "../src/mutation-bridge";
import {
  materializeRevisionedVfsOverlays,
  planSparseDirectoryOverlay,
  planVfsOverlays,
  publishRevisionedVfsOverlayPlan,
  type VfsDirectoryOverlayIntent,
  type VfsMutationOverlayIntent,
  type VfsOverlayIntent,
} from "../src/overlay-materialization";
import { folderChildren, readMetadataId, readName } from "../src/model";
import { MemoryRevisionedVfsAuthority } from "../src/revisioned-persistence";
import { VirtualFileSystem } from "../src/vfs";
import { applyVfsSnapshotMutations, type VfsMutation } from "../src/vfs-mutations";

function directoryOverlay(id: string, order: number, snapshot: DataElementNode): VfsDirectoryOverlayIntent {
  return {
    id,
    order,
    kind: "directory",
    snapshot,
  };
}

function mutationOverlay(id: string, order: number, mutations: VfsMutation[]): VfsMutationOverlayIntent {
  return {
    id,
    order,
    kind: "mutations",
    mutations,
  };
}

function childAt(folder: DataElementNode, name: string): DataElementNode {
  const child = folderChildren(folder).find((candidate) => readName(candidate) === name);
  if (!child) {
    throw new Error(`Missing child ${name}`);
  }
  return child;
}

describe("sparse directory overlay materialization", () => {
  it("adds and replaces present paths, preserves identities, and leaves absent paths unchanged", () => {
    const baseVfs = new VirtualFileSystem();
    baseVfs.mkdir("vfs:///config", { recursive: true });
    baseVfs.writeFile("vfs:///config/runtime.txt", "builtin", { fileType: "text", metadataId: "base-runtime" });
    baseVfs.writeFile("vfs:///config/untouched.txt", "keep", { fileType: "text", metadataId: "base-untouched" });
    const base = baseVfs.getSnapshot();
    const baseConfigId = baseVfs.stat("vfs:///config").metadataId;

    const overlayVfs = new VirtualFileSystem();
    overlayVfs.mkdir("vfs:///config", { recursive: true });
    overlayVfs.writeFile("vfs:///config/runtime.txt", "workspace", { fileType: "text", metadataId: "overlay-runtime" });
    overlayVfs.writeFile("vfs:///config/added.txt", "added", { fileType: "text", metadataId: "overlay-added" });
    const overlaySnapshot = overlayVfs.getSnapshot();
    const overlayConfig = childAt(overlaySnapshot, "config");
    const overlayRuntime = childAt(overlayConfig, "runtime.txt");
    overlayRuntime.metadata.owner = "workspace";
    overlayRuntime.attributes = {
      ...(overlayRuntime.attributes ?? {}),
      executable: true,
    };
    overlayRuntime.extend = {
      order: ["OverlayExt"],
      children: {
        OverlayExt: {
          kind: "DataElement",
          tag: "OverlayExt",
          metadata: { enabled: true },
        },
      },
    };

    const result = planSparseDirectoryOverlay(base, directoryOverlay("workspace", 2, overlaySnapshot));

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    const candidate = new VirtualFileSystem(result.plan.candidate);
    expect(candidate.readFile("vfs:///config/runtime.txt")).toBe("workspace");
    expect(candidate.readFile("vfs:///config/untouched.txt")).toBe("keep");
    expect(candidate.readFile("vfs:///config/added.txt")).toBe("added");
    expect(candidate.stat("vfs:///config").metadataId).toBe(baseConfigId);
    expect(candidate.stat("vfs:///config/runtime.txt").metadataId).toBe("base-runtime");
    expect(candidate.stat("vfs:///config/added.txt").metadataId).toBe("overlay-added");

    const candidateConfig = childAt(result.plan.candidate, "config");
    const candidateRuntime = childAt(candidateConfig, "runtime.txt");
    expect(candidateRuntime.metadata).toMatchObject({
      id: "base-runtime",
      name: "runtime.txt",
      owner: "workspace",
    });
    expect(candidateRuntime.attributes).toMatchObject({
      nodeType: "file",
      fileType: "text",
      content: "workspace",
      executable: true,
    });
    expect(candidateRuntime.extend).toEqual(overlayRuntime.extend);
    expect(result.plan.mutations.length).toBeGreaterThan(0);

    expect(base).toEqual(baseVfs.getSnapshot());
    expect(readMetadataId(childAt(childAt(base, "config"), "runtime.txt"))).toBe("base-runtime");
  });

  it("treats an absent replacement as no opinion so a fresh plan falls back to the same base", () => {
    const baseVfs = new VirtualFileSystem();
    baseVfs.writeFile("vfs:///agent.xnl", "builtin", { fileType: "xnl", metadataId: "builtin-agent" });
    const base = baseVfs.getSnapshot();

    const replacementVfs = new VirtualFileSystem();
    replacementVfs.writeFile("vfs:///agent.xnl", "workspace", { fileType: "xnl", metadataId: "workspace-agent" });
    const replaced = planSparseDirectoryOverlay(base, directoryOverlay("workspace", 1, replacementVfs.getSnapshot()));
    expect(replaced.status).toBe("planned");
    if (replaced.status !== "planned") return;
    expect(new VirtualFileSystem(replaced.plan.candidate).readFile("vfs:///agent.xnl")).toBe("workspace");

    const emptyOverlay = new VirtualFileSystem().getSnapshot();
    const fallback = planSparseDirectoryOverlay(base, directoryOverlay("workspace", 1, emptyOverlay));
    expect(fallback).toEqual({
      status: "planned",
      plan: {
        overlayId: "workspace",
        overlayOrder: 1,
        candidate: base,
        mutations: [],
      },
    });
    if (fallback.status !== "planned") return;
    expect(new VirtualFileSystem(fallback.plan.candidate).readFile("vfs:///agent.xnl")).toBe("builtin");
  });

  it.each([
    {
      label: "file over folder",
      prepareBase: (vfs: VirtualFileSystem) => vfs.mkdir("vfs:///target", { recursive: true }),
      prepareOverlay: (vfs: VirtualFileSystem) => vfs.writeFile("vfs:///target", "file", { fileType: "text" }),
    },
    {
      label: "folder over file",
      prepareBase: (vfs: VirtualFileSystem) => vfs.writeFile("vfs:///target", "file", { fileType: "text" }),
      prepareOverlay: (vfs: VirtualFileSystem) => vfs.mkdir("vfs:///target", { recursive: true }),
    },
  ])("rejects a $label kind conflict with overlay and path diagnostics", ({ prepareBase, prepareOverlay }) => {
    const baseVfs = new VirtualFileSystem();
    prepareBase(baseVfs);
    const base = baseVfs.getSnapshot();

    const overlayVfs = new VirtualFileSystem();
    prepareOverlay(overlayVfs);

    const result = planSparseDirectoryOverlay(base, directoryOverlay("workspace", 7, overlayVfs.getSnapshot()), {
      overlayIndex: 3,
    });

    expect(result).toMatchObject({
      status: "rejected",
      diagnostics: [
        {
          code: "KIND_CONFLICT",
          overlayId: "workspace",
          overlayOrder: 7,
          overlayIndex: 3,
          path: "vfs:///target",
        },
      ],
    });
    expect(result.status === "rejected" ? result.diagnostics[0]?.message : "").toContain("vfs:///target");
    expect(base).toEqual(baseVfs.getSnapshot());
  });
});

describe("ordered overlay materialization", () => {
  it("plans mixed directory and explicit overlays in contiguous order with deterministic final batches and provenance", () => {
    const baseVfs = new VirtualFileSystem();
    baseVfs.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    baseVfs.writeFile("vfs:///obsolete.txt", "remove", { fileType: "text", metadataId: "base-obsolete" });
    const base = baseVfs.getSnapshot();

    const globalVfs = new VirtualFileSystem();
    globalVfs.writeFile("vfs:///config.txt", "global", { fileType: "text", metadataId: "global-config" });
    globalVfs.writeFile("vfs:///global.txt", "global", { fileType: "text", metadataId: "global-added" });

    const workspaceVfs = new VirtualFileSystem();
    workspaceVfs.writeFile("vfs:///config.txt", "workspace", { fileType: "text", metadataId: "workspace-config" });

    const overlays: VfsOverlayIntent[] = [
      directoryOverlay("workspace", 2, workspaceVfs.getSnapshot()),
      directoryOverlay("global", 0, globalVfs.getSnapshot()),
      mutationOverlay("policy", 1, [
        {
          type: "CONTENT_UPDATE",
          path: "vfs:///config.txt",
          expectedId: "base-config",
          payload: { content: "policy", fileType: "text" },
        },
        {
          type: "FILE_DELETE",
          path: "vfs:///obsolete.txt",
          expectedId: "base-obsolete",
        },
      ]),
    ];

    const first = planVfsOverlays(base, overlays);
    const second = planVfsOverlays(base, overlays);

    expect(first).toEqual(second);
    expect(first.status).toBe("planned");
    if (first.status !== "planned") return;

    const candidate = new VirtualFileSystem(first.plan.candidate);
    expect(candidate.readFile("vfs:///config.txt")).toBe("workspace");
    expect(candidate.stat("vfs:///config.txt").metadataId).toBe("base-config");
    expect(candidate.readFile("vfs:///global.txt")).toBe("global");
    expect(candidate.exists("vfs:///obsolete.txt")).toBe(false);

    expect(first.plan.overlays).toMatchObject([
      {
        overlayId: "global",
        overlayOrder: 0,
        overlayIndex: 1,
        kind: "directory",
      },
      {
        overlayId: "policy",
        overlayOrder: 1,
        overlayIndex: 2,
        kind: "mutations",
      },
      {
        overlayId: "workspace",
        overlayOrder: 2,
        overlayIndex: 0,
        kind: "directory",
      },
    ]);
    expect(first.plan.overlays.map((entry) => entry.mutations.length)).toEqual([2, 2, 1]);
    expect(applyVfsSnapshotMutations(base, first.plan.mutations)).toEqual(first.plan.candidate);
    expect(applyVfsMutations(base, first.plan.xnlMutations)).toEqual(first.plan.candidate);
    expect(first.plan.mutations).toEqual(second.status === "planned" ? second.plan.mutations : []);
    expect(first.plan.xnlMutations).toEqual(second.status === "planned" ? second.plan.xnlMutations : []);
    expect(base).toEqual(baseVfs.getSnapshot());
  });

  it.each([
    {
      label: "non-zero first order",
      overlays: (): VfsOverlayIntent[] => [mutationOverlay("late", 2, [])],
      diagnostic: {
        code: "INVALID_OVERLAY_ORDER",
        overlayId: "late",
        overlayOrder: 2,
        overlayIndex: 0,
      },
    },
    {
      label: "duplicate id",
      overlays: (): VfsOverlayIntent[] => [
        mutationOverlay("same", 0, []),
        mutationOverlay("same", 1, []),
      ],
      diagnostic: {
        code: "DUPLICATE_OVERLAY_ID",
        overlayId: "same",
        overlayOrder: 1,
        overlayIndex: 1,
      },
    },
    {
      label: "duplicate order",
      overlays: (): VfsOverlayIntent[] => [
        mutationOverlay("first", 0, []),
        mutationOverlay("second", 0, []),
      ],
      diagnostic: {
        code: "INVALID_OVERLAY_ORDER",
        overlayId: "second",
        overlayOrder: 0,
        overlayIndex: 1,
      },
    },
    {
      label: "gapped order",
      overlays: (): VfsOverlayIntent[] => [
        mutationOverlay("first", 0, []),
        mutationOverlay("third", 2, []),
      ],
      diagnostic: {
        code: "INVALID_OVERLAY_ORDER",
        overlayId: "third",
        overlayOrder: 2,
        overlayIndex: 1,
      },
    },
  ])("rejects $label before exposing a candidate", ({ overlays, diagnostic }) => {
    const baseVfs = new VirtualFileSystem();
    baseVfs.writeFile("vfs:///base.txt", "base", { fileType: "text", metadataId: "base-file" });
    const base = baseVfs.getSnapshot();

    const result = planVfsOverlays(base, overlays());

    expect(result).toMatchObject({
      status: "rejected",
      diagnostics: [diagnostic],
    });
    expect(result.status === "rejected" ? result.diagnostics[0]?.path : "").toBe("vfs:///");
    expect(base).toEqual(baseVfs.getSnapshot());
    expect("plan" in result).toBe(false);
  });

  it.each([
    {
      label: "missing directory snapshot",
      overlay: { id: "broken-directory", order: 0, kind: "directory" },
    },
    {
      label: "missing mutation array",
      overlay: { id: "broken-mutations", order: 0, kind: "mutations" },
    },
  ])("rejects a $label with a structured diagnostic", ({ overlay }) => {
    const base = new VirtualFileSystem().getSnapshot();
    const result = planVfsOverlays(base, [overlay as unknown as VfsOverlayIntent]);

    expect(result).toMatchObject({
      status: "rejected",
      diagnostics: [
        {
          code: "INVALID_OVERLAY",
          overlayId: overlay.id,
          overlayOrder: 0,
          overlayIndex: 0,
          path: "vfs:///",
        },
      ],
    });
    expect("plan" in result).toBe(false);
  });

  it("locates an explicit mutation failure without exposing earlier candidate changes or mutating the caller base", () => {
    const baseVfs = new VirtualFileSystem();
    baseVfs.writeFile("vfs:///target.txt", "base", { fileType: "text", metadataId: "base-target" });
    const base = baseVfs.getSnapshot();

    const result = planVfsOverlays(base, [
      mutationOverlay("workspace-mutations", 0, [
        {
          type: "CONTENT_UPDATE",
          path: "vfs:///target.txt",
          expectedId: "base-target",
          payload: { content: "intermediate", fileType: "text" },
        },
        {
          type: "CONTENT_UPDATE",
          path: "vfs:///target.txt",
          expectedId: "wrong-target",
          payload: { content: "invalid", fileType: "text" },
        },
      ]),
    ]);

    expect(result).toMatchObject({
      status: "rejected",
      diagnostics: [
        {
          code: "MUTATION_REJECTED",
          overlayId: "workspace-mutations",
          overlayOrder: 0,
          overlayIndex: 0,
          mutationIndex: 1,
          path: "vfs:///target.txt",
        },
      ],
    });
    expect(result.status === "rejected" ? result.diagnostics[0]?.message : "").toContain("Expected node id wrong-target");
    expect("plan" in result).toBe(false);
    expect(new VirtualFileSystem(base).readFile("vfs:///target.txt")).toBe("base");
    expect(base).toEqual(baseVfs.getSnapshot());
  });
});

describe("revisioned overlay publication", () => {
  const PERSISTED_AT = "2026-08-31T00:00:00.000Z";

  function authorityFor(snapshot: DataElementNode, authorityId = "overlay-authority") {
    return new MemoryRevisionedVfsAuthority(snapshot, {
      authorityId,
      clock: () => PERSISTED_AT,
      revisionFactory: (sequence) => `revision:${sequence}`,
    });
  }

  function replacement(id: string, order: number, path: string, content: string): VfsDirectoryOverlayIntent {
    const overlay = new VirtualFileSystem();
    overlay.writeFile(path, content, { fileType: "text", metadataId: `${id}-file` });
    return directoryOverlay(id, order, overlay.getSnapshot());
  }

  it("publishes an applied complete candidate with truthful receipt and overlay provenance", async () => {
    const initial = new VirtualFileSystem();
    initial.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    const authority = authorityFor(initial.getSnapshot());
    const base = await authority.read();

    const result = await materializeRevisionedVfsOverlays(authority, {
      base,
      overlays: [replacement("workspace", 0, "vfs:///config.txt", "workspace")],
    });

    expect(result).toMatchObject({
      status: "applied",
      phase: "persistence",
      receipt: {
        previousRevision: base.revision,
        revision: { authorityId: "overlay-authority", value: "revision:1" },
        persistedAt: PERSISTED_AT,
        durability: "memory",
      },
      plan: {
        overlays: [
          {
            overlayId: "workspace",
            overlayOrder: 0,
            overlayIndex: 0,
            kind: "directory",
          },
        ],
      },
    });
    if (result.status !== "applied") return;
    expect(new VirtualFileSystem(result.snapshot).readFile("vfs:///config.txt")).toBe("workspace");
    expect(await authority.read()).toEqual({
      revision: result.receipt.revision,
      snapshot: result.plan.candidate,
    });
  });

  it("returns unchanged at the current truthful revision while retaining the empty plan", async () => {
    const initial = new VirtualFileSystem();
    initial.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    const authority = authorityFor(initial.getSnapshot());
    const base = await authority.read();

    const result = await materializeRevisionedVfsOverlays(authority, {
      base,
      overlays: [],
    });

    expect(result).toEqual({
      status: "unchanged",
      phase: "persistence",
      snapshot: base.snapshot,
      revision: base.revision,
      plan: {
        candidate: base.snapshot,
        mutations: [],
        xnlMutations: [],
        overlays: [],
      },
    });
    expect(await authority.read()).toEqual(base);
  });

  it("returns conflict for a stale base without changing the current winner", async () => {
    const initial = new VirtualFileSystem();
    initial.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    const authority = authorityFor(initial.getSnapshot());
    const staleBase = await authority.read();

    const winner = await materializeRevisionedVfsOverlays(authority, {
      base: staleBase,
      overlays: [replacement("winner", 0, "vfs:///config.txt", "winner")],
    });
    expect(winner.status).toBe("applied");
    const afterWinner = await authority.read();

    const result = await materializeRevisionedVfsOverlays(authority, {
      base: staleBase,
      overlays: [replacement("stale", 0, "vfs:///config.txt", "stale")],
    });

    expect(result).toMatchObject({
      status: "conflict",
      phase: "persistence",
      actualRevision: afterWinner.revision,
      plan: {
        overlays: [{ overlayId: "stale" }],
      },
    });
    expect(await authority.read()).toEqual(afterWinner);
  });

  it("distinguishes planning rejection and performs zero authority calls", async () => {
    const initial = new VirtualFileSystem();
    initial.mkdir("vfs:///target", { recursive: true });
    const authority = authorityFor(initial.getSnapshot());
    const base = await authority.read();
    const overlay = replacement("conflict", 0, "vfs:///target", "file-over-folder");
    const read = vi.spyOn(authority, "read");
    const compareAndSwap = vi.spyOn(authority, "compareAndSwap");

    const result = await materializeRevisionedVfsOverlays(authority, {
      base,
      overlays: [overlay],
    });

    expect(result).toMatchObject({
      status: "rejected",
      phase: "planning",
      diagnostics: [{ code: "KIND_CONFLICT", path: "vfs:///target" }],
      overlays: [{ id: "conflict", order: 0, kind: "directory" }],
    });
    expect("plan" in result).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(compareAndSwap).not.toHaveBeenCalled();
    read.mockRestore();
    compareAndSwap.mockRestore();
    expect(await authority.read()).toEqual(base);
  });

  it("distinguishes strict mutation rejection from planning rejection and skips CAS", async () => {
    const initial = new VirtualFileSystem();
    initial.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    const authority = authorityFor(initial.getSnapshot());
    const base = await authority.read();
    const planned = planVfsOverlays(base.snapshot, [replacement("workspace", 0, "vfs:///config.txt", "workspace")]);
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const invalidPlan = structuredClone(planned.plan);
    invalidPlan.xnlMutations = [
      {
        type: "OBJECT_UPDATE",
        path: "<id='base-config'>:metadata::'id'",
        valueAfter: "replacement-id",
      },
    ];
    const compareAndSwap = vi.spyOn(authority, "compareAndSwap");

    const result = await publishRevisionedVfsOverlayPlan(authority, {
      base,
      plan: invalidPlan,
    });

    expect(result).toMatchObject({
      status: "rejected",
      phase: "mutation",
      diagnostics: [{ code: "IDENTITY_MUTATION_FORBIDDEN" }],
      plan: {
        overlays: [{ overlayId: "workspace" }],
      },
    });
    expect(compareAndSwap).not.toHaveBeenCalled();
    expect(await authority.read()).toEqual(base);
  });

  it("returns persistence failure with the complete plan and exposes no partial candidate", async () => {
    const initial = new VirtualFileSystem();
    initial.writeFile("vfs:///config.txt", "builtin", { fileType: "text", metadataId: "base-config" });
    const authority = authorityFor(initial.getSnapshot());
    const base = await authority.read();
    authority.failNextFlush({
      code: "TEST_OVERLAY_FLUSH_FAILURE",
      message: "injected overlay persistence failure",
    });

    const result = await materializeRevisionedVfsOverlays(authority, {
      base,
      overlays: [replacement("workspace", 0, "vfs:///config.txt", "workspace")],
    });

    expect(result).toMatchObject({
      status: "failed",
      phase: "persistence",
      actualRevision: base.revision,
      diagnostics: [{ code: "TEST_OVERLAY_FLUSH_FAILURE" }],
      plan: {
        overlays: [{ overlayId: "workspace" }],
      },
    });
    expect(await authority.read()).toEqual(base);
  });
});
