import { describe, expect, it } from "vitest";
import { binaryFileHandler } from "../src/handlers";

describe("binary file handler", () => {
  it("refuses three-way merge when both sides change", () => {
    const base = "AAA";
    const ours = "BBB";
    const theirs = "CCC";

    const merged = binaryFileHandler.merge(base, ours, theirs);
    expect(merged.conflict?.type).toBe("BINARY_UNMERGEABLE");
  });
});
