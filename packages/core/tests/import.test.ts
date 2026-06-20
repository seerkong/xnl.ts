import { describe, expect, it } from "vitest";
import { parseXnl } from "../src/parser";
import { resolveImports, resolveVfsSrc, ImportResolver } from "../src/import";

/** In-memory resolver — proves dependency inversion (no filesystem). */
function mockResolver(files: Record<string, string>): ImportResolver {
  const dirs = new Set<string>(["/"]);
  for (const p of Object.keys(files)) {
    let d = p.slice(0, p.lastIndexOf("/")) || "/";
    while (d && d !== "/") {
      dirs.add(d);
      d = d.slice(0, d.lastIndexOf("/")) || "/";
    }
  }
  return {
    readFile: (p) => (p in files ? files[p] : null),
    isDir: (p) => dirs.has(p) && !(p in files),
    readDir: (p) => {
      if (!dirs.has(p)) return null;
      const prefix = p === "/" ? "/" : `${p}/`;
      const names = new Set<string>();
      for (const f of Object.keys(files)) {
        if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
      }
      return [...names];
    },
  };
}

const ROOT = { baseDir: "/", workspaceRoot: "/" };

describe("vfs-import resolver", () => {
  it("zero-import: documents without <Imports> are returned unchanged", () => {
    const root = parseXnl(`<Doc {ref="z:Missing"}>`);
    const r = resolveImports(root, mockResolver({}), ROOT);
    expect(r.symbols).toEqual({});
    expect(r.resolved).toBe(root);
  });

  it("resolves vfs addressing forms @/ ./ ..", () => {
    const opts = { baseDir: "/x/y", workspaceRoot: "/root" };
    expect(resolveVfsSrc("vfs://@/a/b", opts)).toBe("/root/a/b");
    expect(resolveVfsSrc("vfs://./c", opts)).toBe("/x/y/c");
    expect(resolveVfsSrc("vfs://../d", opts)).toBe("/x/d");
  });

  it("imports a file and exposes its exports under the alias", () => {
    const files = { "/defs/review/Artifact.xnl": `<Artifact #Artifact export=true {kind="doc"}>` };
    const root = parseXnl(
      `<Imports [ <Import as="review" src="vfs://@/defs/review/Artifact.xnl"> ]>\n<Doc {ref="review:Artifact"}>`,
    );
    const { symbols } = resolveImports(root, mockResolver(files), ROOT);
    expect(symbols.review.Artifact).toBeDefined();
  });

  it("imports a directory type-package", () => {
    const files = {
      "/defs/coding/Artifact.xnl": `<Artifact #Artifact export=true>`,
      "/defs/coding/Verdict.xnl": `<Verdict #Verdict export=true>`,
    };
    const root = parseXnl(`<Imports [ <Import as="coding" src="vfs://@/defs/coding/"> ]>\n<Doc>`);
    const { symbols } = resolveImports(root, mockResolver(files), ROOT);
    expect(symbols.coding.Artifact).toBeDefined();
    expect(symbols.coding.Verdict).toBeDefined();
  });

  it("merges same-alias imports into one namespace", () => {
    const files = {
      "/a/Artifact.xnl": `<Artifact #Artifact export=true>`,
      "/b/agent.xnl": `<Agent #codingAttractor export=true>`,
    };
    const root = parseXnl(
      `<Imports [ <Import as="coding" src="vfs://@/a/Artifact.xnl"> <Import as="coding" src="vfs://@/b/agent.xnl"> ]>\n<Doc>`,
    );
    const { symbols } = resolveImports(root, mockResolver(files), ROOT);
    expect(symbols.coding.Artifact).toBeDefined();
    expect(symbols.coding.codingAttractor).toBeDefined();
  });

  it("raises on duplicate import symbol from different sources", () => {
    const files = {
      "/a/X.xnl": `<Thing #Foo export=true {v=1}>`,
      "/b/X.xnl": `<Thing #Foo export=true {v=2}>`,
    };
    const root = parseXnl(
      `<Imports [ <Import as="z" src="vfs://@/a/X.xnl"> <Import as="z" src="vfs://@/b/X.xnl"> ]>\n<Doc>`,
    );
    expect(() => resolveImports(root, mockResolver(files), ROOT)).toThrow(/Duplicate import/);
  });

  it("raises on an unresolved alias:name reference", () => {
    const files = { "/a/X.xnl": `<Thing #Foo export=true>` };
    const root = parseXnl(`<Imports [ <Import as="z" src="vfs://@/a/X.xnl"> ]>\n<Doc {ref="z:Missing"}>`);
    expect(() => resolveImports(root, mockResolver(files), ROOT)).toThrow(/Unresolved/);
  });

  it("raises when an import source is missing", () => {
    const root = parseXnl(`<Imports [ <Import as="z" src="vfs://@/nope.xnl"> ]>\n<Doc>`);
    expect(() => resolveImports(root, mockResolver({}), ROOT)).toThrow(/not found/);
  });
});
