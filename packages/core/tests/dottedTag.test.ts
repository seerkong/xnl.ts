import { describe, expect, it } from "vitest";
import { parseXnl } from "../src/parser";
import { stringify as stringifyFormatter } from "../src/formatter";
import { stringify as stringifyLineBlock } from "../src/lineBlockFormatter";
import { applyMutations, diffNodes } from "../src/mutation";
import { resolvePath } from "../src/path";
import { batchLoad } from "../src/loader";

describe("dotted FQN tag names", () => {
  it("parses a dotted tag into a joined tag string", () => {
    const doc = parseXnl(`<dg.materials.CrudTable #users-table { pageSize = 20 }>`);
    const node = doc.nodes[0] as any;
    expect(node.tag).toBe("dg.materials.CrudTable");
    expect(node.id).toEqual({ kind: "Word", namespace: [], name: "users-table" });
    expect(node.attributes.pageSize).toBe(20);
  });

  it("keeps single-segment tags unchanged", () => {
    const doc = parseXnl(`<Capsule #f [ <h1 #t { text = "x" }> ]>`);
    expect((doc.nodes[0] as any).tag).toBe("Capsule");
  });

  it("rejects empty, leading, and trailing dot segments", () => {
    expect(() => parseXnl(`<a..b>`)).toThrow();
    expect(() => parseXnl(`<.a>`)).toThrow();
    expect(() => parseXnl(`<a.>`)).toThrow();
  });

  it("parses the full section combination on a dotted tag", () => {
    const doc = parseXnl(`<dg.admin.UsersPage #p meta=1 { a = "b" } (
  <Slot #toolbar [ <span #s> ]>
) [
  <h1 #title { text = "hello" }>
  <elementPlus.ElInput #kw { propsRef = "config://#f/kw" }>
]>`);
    const node = doc.nodes[0] as any;
    expect(node.tag).toBe("dg.admin.UsersPage");
    expect(node.metadata.meta).toBe(1);
    expect(node.attributes.a).toBe("b");
    expect(node.body).toHaveLength(2);
    expect(node.body[1].tag).toBe("elementPlus.ElInput");
    expect(node.extend).toBeTruthy();
  });

  it("parses dotted-tag text elements", () => {
    const doc = parseXnl(`<dg.ui.Note ?>plain text</?>`);
    const node = doc.nodes[0] as any;
    expect(node.kind).toBe("TextElement");
    expect(node.tag).toBe("dg.ui.Note");
    expect(node.text).toBe("plain text");
  });

  it("roundtrips dotted tags through both formatters", () => {
    const src = `<dg.materials.CrudTable #users-table { pageSize = 20 } [
  <elementPlus.ElInput #kw { propsRef = "config://#f/kw" }>
]>`;
    const doc = parseXnl(src);
    for (const out of [stringifyFormatter(doc.nodes[0] as any), stringifyLineBlock(doc.nodes[0] as any)]) {
      expect(out).toContain("<dg.materials.CrudTable");
      expect(out).toContain("<elementPlus.ElInput");
      expect(parseXnl(out).nodes).toEqual(doc.nodes);
    }
  });

  it("diffs and applies mutations on dotted-tag nodes", () => {
    const oldDoc = parseXnl(`<dg.materials.CrudTable #t { pageSize = 20 }>`).nodes[0];
    const newDoc = parseXnl(`<dg.materials.CrudTable #t { pageSize = 50 }>`).nodes[0];
    const mutations = diffNodes(oldDoc, newDoc, "#t");
    expect(mutations.length).toBeGreaterThan(0);
    const clone = JSON.parse(JSON.stringify(oldDoc));
    expect(applyMutations(clone, mutations)).toEqual(newDoc);
  });

  it("loads prefab/proto/export batches containing dotted-tag nodes", () => {
    const { nodes } = parseXnl(`<dg.materials.CrudTable #users-table proto=SharedCrudBase export=true name="users-table" { entity = "users" } (
  <Prefabs [
    <dg.materials.CrudTable #SharedCrudBase name="SharedCrudBase" { pageSize = 10 }>
  ]>
)>`);
    const { resolved, exports } = batchLoad([nodes as any]);
    const table = resolved[0][0] as any;
    expect(table.tag).toBe("dg.materials.CrudTable");
    expect(table.attributes.entity).toBe("users");
    expect(table.attributes.pageSize).toBe(10);
    expect(exports["dg.materials.CrudTable"]?.["users-table"]).toBeDefined();
  });

  it("resolves paths through dotted-tag nodes", () => {
    const doc = parseXnl(`<dg.admin.UsersPage #p [
  <dg.materials.CrudTable #t { pageSize = 20 }>
]>`);
    const value = resolvePath(doc.nodes[0], "#p:body::0:attributes::'pageSize'");
    expect(value).toBe(20);
  });
});
