import { describe, expect, it } from "vitest";
import { GetWordFullName } from "../src/NodeHelper";
import { XnlWord } from "../src/types";

describe("GetWordFullName", () => {
  it("joins namespace segments with the word name", () => {
    const word: XnlWord = { kind: "Word", namespace: ["abc", "def"], name: "ghi" };
    expect(GetWordFullName(word)).toBe("abc.def.ghi");
  });

  it("returns the name when namespace is empty", () => {
    const word: XnlWord = { kind: "Word", namespace: [], name: "solo" };
    expect(GetWordFullName(word)).toBe("solo");
  });
});
