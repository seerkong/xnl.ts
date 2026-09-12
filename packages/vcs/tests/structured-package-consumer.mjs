// Copy this file into a directory containing only packed package installations.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseXnl, stringifyLiteral, diffNodes, dryRunMutations } from "xnl-core";
import { VirtualFileSystem, MemoryRevisionedVfsAuthority, applyRevisionedVfsMutations } from "xnl-vfs";
import { Repository, RevisionedRepositoryAdapter } from "xnl-vcs";

const require = createRequire(import.meta.url);
for (const name of ["xnl-core", "xnl-vfs", "xnl-vcs"]) {
  assert.match(require.resolve(name), /node_modules/);
  assert.ok(require(name));
}
const literal = JSON.parse('{"kind":"DataElement","metadata":{},"__proto__":{"ok":true}}');
const data = parseXnl(`<Config #config { value=${stringifyLiteral(literal, { sortKeys: true })} }> `).nodes[0];
assert.deepEqual(data.attributes.value, literal);
const parse = (s) => parseXnl(s).nodes[0];
const baseData = parse('<Config #config { n=1 values=[{ allow=true }] }>');
const targetData = parse('<Config #config { n=2 values=[{ allow=false }] }>');
const changes = diffNodes(baseData, targetData);
assert.equal(dryRunMutations(baseData, changes, { verifyValueBefore: true }).status, "applied");
assert.equal(dryRunMutations(parse('<Config #config { n=9 values=[{ allow=true }] }>'), changes, { verifyValueBefore: true }).status, "rejected");

const vfs = new VirtualFileSystem();
vfs.writeFile("vfs:///first.xnl", '<First #first { n=1 }>', { fileType: "xnl" });
vfs.writeFile("vfs:///second.xnl", '<Second #second { n=1 }>', { fileType: "xnl" });
const authority = new MemoryRevisionedVfsAuthority(vfs.getSnapshot(), { authorityId: "package-consumer" });
const repository = new Repository(); repository.init();
const adapter = new RevisionedRepositoryAdapter({ authority, repository });
const base = await adapter.open();
const first = await adapter.checkpoint(base.revision, "base");
assert.equal(first.status, "checkpointed");
vfs.writeFile("vfs:///first.xnl", '<First #first { n=2 }>', { fileType: "xnl" });
vfs.writeFile("vfs:///second.xnl", '<Second #second { n=2 }>', { fileType: "xnl" });
const accepted = await adapter.apply({ base, mutations: diffNodes(base.snapshot, vfs.getSnapshot()), mutationOptions: { verifyValueBefore: true } });
assert.equal(accepted.status, "applied");
assert.equal((await applyRevisionedVfsMutations(authority, { base, mutations: [] })).status, "conflict");
const current = await authority.read();
repository.checkout(first.receipt.commitId, { force: true });
assert.deepEqual(repository.vfs.getSnapshot(), base.snapshot);
assert.deepEqual(await authority.read(), current);
console.log(`structured package consumer passed: ${process.release.name} ${process.version} ${process.platform}/${process.arch}`);
