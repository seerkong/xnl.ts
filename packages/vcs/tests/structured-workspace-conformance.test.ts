import { describe, expect, it } from "vitest";
import { diffNodes, parseXnl, type DataElementNode } from "xnl-core";
import { applyRevisionedVfsMutations, MemoryRevisionedVfsAuthority, VirtualFileSystem } from "xnl-vfs";
import { Repository, RevisionedRepositoryAdapter } from "../src/index";

function workspace() {
  const vfs = new VirtualFileSystem();
  vfs.mkdir("vfs:///documents", { recursive: true });
  vfs.writeFile("vfs:///documents/catalog.xnl", '<Catalog #catalog { name="Base" }>', { fileType: "xnl", metadataId: "catalog-file" });
  vfs.writeFile("vfs:///documents/rules.xnl", '<Rules #rules { values=[{allow=true scopes=["read"]}] }>', { fileType: "xnl", metadataId: "rules-file" });
  return vfs;
}

function edit(base: DataElementNode, name: string) {
  const vfs = new VirtualFileSystem(base);
  vfs.writeFile("vfs:///documents/catalog.xnl", `<Catalog #catalog { name="${name}" }>`, { fileType: "xnl" });
  vfs.writeFile("vfs:///documents/rules.xnl", '<Rules #rules { values=[{allow=false scopes=["read" "write"]}] }>', { fileType: "xnl" });
  return vfs.getSnapshot();
}

describe("multi-file structured workspace conformance", () => {
  it("publishes both native documents in one CAS and rejects a stale whole-workspace writer", async () => {
    const authority = new MemoryRevisionedVfsAuthority(workspace().getSnapshot(), { authorityId: "editor" });
    const base = await authority.read();
    const winner = edit(base.snapshot, "Accepted");
    const loser = edit(base.snapshot, "Stale");
    const results = await Promise.all([winner, loser].map((target) => applyRevisionedVfsMutations(authority, {
      base, mutations: diffNodes(base.snapshot, target), mutationOptions: { verifyValueBefore: true },
    })));
    expect(results.map((result) => result.status)).toEqual(["applied", "conflict"]);
    const current = await authority.read();
    expect(current.snapshot).toEqual(winner);
    expect(current.revision.value).toBe("revision:1");
    const read = new VirtualFileSystem(current.snapshot);
    const rules = parseXnl(read.readFile("vfs:///documents/rules.xnl")).nodes[0] as DataElementNode;
    expect(rules.attributes!.values).toEqual([{ allow: false, scopes: ["read", "write"] }]);
    expect(await applyRevisionedVfsMutations(authority, { base, mutations: [] })).toMatchObject({ status: "conflict" });
  });

  it("rejects a late invalid mutation without leaking the first file update", async () => {
    const authority = new MemoryRevisionedVfsAuthority(workspace().getSnapshot(), { authorityId: "editor" });
    const base = await authority.read();
    const changes = diffNodes(base.snapshot, edit(base.snapshot, "Draft"));
    changes.push({ type: "OBJECT_UPDATE", path: "#missing:attributes::'content'", valueAfter: "invalid" });
    expect(await applyRevisionedVfsMutations(authority, { base, mutations: changes, mutationOptions: { verifyValueBefore: true } })).toMatchObject({ status: "rejected" });
    expect(await authority.read()).toEqual(base);
  });

  it("keeps checkpoint and checkout separate from live authority and file identity", async () => {
    const authority = new MemoryRevisionedVfsAuthority(workspace().getSnapshot(), { authorityId: "editor" });
    const repository = new Repository(); repository.init();
    const adapter = new RevisionedRepositoryAdapter({ authority, repository });
    const base = await adapter.open();
    const first = await adapter.checkpoint(base.revision, "base");
    expect(first.status).toBe("checkpointed");
    if (first.status !== "checkpointed") throw new Error("missing first checkpoint");
    const target = edit(base.snapshot, "Changed");
    const applied = await adapter.apply({ base, mutations: diffNodes(base.snapshot, target), mutationOptions: { verifyValueBefore: true } });
    expect(applied.status).toBe("applied");
    const current = await authority.read();
    const second = await adapter.checkpoint(current.revision, "changed");
    expect(second).toMatchObject({ status: "checkpointed", receipt: { liveRevision: current.revision } });
    expect(await adapter.checkpoint(base.revision, "stale")).toMatchObject({ status: "conflict" });
    repository.checkout(first.receipt.commitId, { force: true });
    expect(repository.vfs.getSnapshot()).toEqual(base.snapshot);
    expect(await authority.read()).toEqual(current);
    await adapter.open();
    expect(repository.vfs.getSnapshot()).toEqual(target);
    expect(repository.vfs.stat("vfs:///documents/catalog.xnl").metadataId).toBe("catalog-file");
  });
});
