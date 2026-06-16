import { describe, expect, it } from "vitest";
import { textFileHandler } from "../src/handlers";

describe("text file handler", () => {
  it("merges non-overlapping changes", () => {
    const base = ["line1", "line2", "line3"].join("\n");
    const ours = ["LINE1", "line2", "line3"].join("\n");
    const theirs = ["line1", "line2", "LINE3"].join("\n");

    const merged = textFileHandler.merge(base, ours, theirs);
    expect(merged.conflict).toBe(false);
    expect(merged.merged).toBe(["LINE1", "line2", "LINE3"].join("\n"));
  });
});
