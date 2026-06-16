import { describe, expect, it } from "vitest";
import { resolvePersistenceMode } from "../src/persistence-mode";

describe("persistence mode selection", () => {
  it("prefers local-fs when workspace root is available", () => {
    expect(resolvePersistenceMode({ requestedMode: "auto", workspaceRootPath: "/tmp/workspace", indexedDbAvailable: true })).toBe("local-fs");
  });

  it("falls back to indexeddb when local-fs is unavailable", () => {
    expect(resolvePersistenceMode({ requestedMode: "auto", indexedDbAvailable: true })).toBe("indexeddb");
  });

  it("falls back to snapshot when nothing else is available", () => {
    expect(resolvePersistenceMode({ requestedMode: "auto" })).toBe("snapshot");
  });

  it("respects explicit requested mode", () => {
    expect(resolvePersistenceMode({ requestedMode: "snapshot", workspaceRootPath: "/tmp/workspace", indexedDbAvailable: true })).toBe("snapshot");
    expect(resolvePersistenceMode({ requestedMode: "indexeddb", workspaceRootPath: "/tmp/workspace" })).toBe("indexeddb");
    expect(resolvePersistenceMode({ requestedMode: "local-fs" })).toBe("local-fs");
  });
});
