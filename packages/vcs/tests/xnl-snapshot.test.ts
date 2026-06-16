import { describe, expect, it } from "vitest";
import { Repository } from "../src/repository";
import {
  captureRepositorySnapshot,
  deserializeRepositorySnapshot,
  deserializeRepositorySnapshotFromString,
  serializeRepositorySnapshot,
  serializeRepositorySnapshotToString,
} from "../src/xnl-snapshot";

function hasChildTag(node: { body?: unknown[] }, tag: string): boolean {
  for (const child of node.body ?? []) {
    if (child && typeof child === "object" && (child as { kind?: string; tag?: string }).kind === "DataElement" && (child as { tag?: string }).tag === tag) {
      return true;
    }
  }
  return false;
}

function findFirstByTag(node: { body?: unknown[] }, tag: string): { metadata?: Record<string, unknown>; body?: unknown[] } | undefined {
  for (const child of node.body ?? []) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const element = child as { kind?: string; tag?: string; metadata?: Record<string, unknown>; body?: unknown[] };
    if (element.kind !== "DataElement") {
      continue;
    }
    if (element.tag === tag) {
      return element;
    }
    const nested = findFirstByTag(element, tag);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function createRepositoryFixture(): Repository {
  const repo = new Repository();
  repo.init();

  repo.vfs.mkdir("vfs:///src", { recursive: true });
  repo.vfs.mkdir("vfs:///assets", { recursive: true });
  repo.vfs.writeFile("vfs:///src/main.ts", "export const version = 1;", { fileType: "text" });
  const base = repo.commit("base", { author: "tester" });
  repo.createTag("v0.1.0", base, "base snapshot");

  repo.createBranch("feature");
  repo.checkout("feature");
  repo.vfs.writeFile("vfs:///src/layout.xnl", "<Layout [ <Header> ]>", { fileType: "xnl" });
  repo.vfs.writeFile("vfs:///assets/logo.bin", "AAECAw==", { fileType: "binary" });
  const featureTip = repo.commit("feature", { author: "tester" });
  repo.createTag("v1.0.0", featureTip, "feature release");

  repo.checkout(base);
  return repo;
}

describe("vcs xnl snapshot", () => {
  it("serializes and deserializes full repository snapshot without loss", () => {
    const repo = createRepositoryFixture();
    const snapshot = captureRepositorySnapshot(repo);

    const serialized = serializeRepositorySnapshot(snapshot, { mode: "full" });
    const restored = deserializeRepositorySnapshot(serialized);

    expect(serialized.tag).toBe("RepositorySnapshot");
    expect(hasChildTag(serialized, "Contents")).toBe(true);

    const blobNode = findFirstByTag(serialized, "Blob");
    expect(blobNode).toBeDefined();
    expect(typeof blobNode?.metadata?.refId).toBe("string");
    expect(blobNode?.metadata?.contentId).toBeUndefined();

    expect(restored).toEqual(snapshot);
  });

  it("supports string roundtrip and deterministic output", () => {
    const repo = createRepositoryFixture();
    const snapshot = captureRepositorySnapshot(repo);

    const textA = serializeRepositorySnapshotToString(snapshot, { mode: "full" });
    const textB = serializeRepositorySnapshotToString(snapshot, { mode: "full" });

    expect(textA).toBe(textB);

    const restored = deserializeRepositorySnapshotFromString(textA);
    expect(restored).toEqual(snapshot);
  });

  it("supports manifest mode without contents section", () => {
    const repo = createRepositoryFixture();
    const snapshot = captureRepositorySnapshot(repo);

    const manifest = serializeRepositorySnapshot(snapshot, { mode: "manifest" });
    expect(hasChildTag(manifest, "Contents")).toBe(false);

    const restored = deserializeRepositorySnapshot(manifest);
    expect(restored.head).toEqual(snapshot.head);
    expect(restored.branches).toEqual(snapshot.branches);
    expect(restored.tags).toEqual(snapshot.tags);
    expect(Object.keys(restored.objects).sort()).toEqual(Object.keys(snapshot.objects).sort());
  });

});
