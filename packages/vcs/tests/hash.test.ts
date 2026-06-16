import { describe, expect, it } from "vitest";
import { hashObject, sha256Hex } from "../src/hash";

describe("vcs hash", () => {
  it("is deterministic for identical content", () => {
    const payload = { type: "blob", content: "hello" };
    const a = hashObject(payload);
    const b = hashObject(payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when content changes", () => {
    const a = hashObject({ type: "blob", content: "hello" });
    const b = hashObject({ type: "blob", content: "world" });
    expect(a).not.toBe(b);
  });

  it("hashes raw bytes", () => {
    const bytes = new TextEncoder().encode("hello");
    const digest = sha256Hex(bytes);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
