import { describe, expect, it } from "vitest";
import { XNL } from "../src";
import { XnlNode } from "../src/types";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };

interface AiChatRecord extends Record<string, JsonValue> {
  role: string;
}

function toValueNode(value: JsonValue): XnlNode {
  if (value === null) return null;
  if (typeof value !== "object") return value as XnlNode;
  if (Array.isArray(value)) {
    return value.map((item) => toValueNode(item)) as XnlNode;
  }
  const obj: Record<string, XnlNode> = {};
  for (const [k, v] of Object.entries(value)) {
    obj[k] = toValueNode(v);
  }
  return obj as XnlNode;
}

function aiChatRecordToNode(record: AiChatRecord): XnlNode {
  const attrEntries: Record<string, XnlNode> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "role") continue;
    attrEntries[key] = toValueNode(value);
  }
  return {
    kind: "DataElement",
    tag: record.role,
    metadata: {},
    attributes: attrEntries,
  };
}

describe("aiChatRecordToNode", () => {
  it("builds node and pretty-prints to XNL", () => {
    const record: AiChatRecord = {
      role: "assistant",
      content: "\n\n我来帮您为当前项目中的脚本编写一个README.md文件。首先让我查看一下项目的结构，了解有哪些脚本。\n",
      toolCalls: [
        {
          id: "019abbf4e8c5b19442ae1eacc72b1eb0",
          name: "bash",
          input: { command: "ls -la" },
        },
      ],
    };

    const node = aiChatRecordToNode(record);
    const output = XNL.stringify(node, { pretty: true, indent: 2 });

    const expected = `<assistant {
  content = "\\n\\n我来帮您为当前项目中的脚本编写一个README.md文件。首先让我查看一下项目的结构，了解有哪些脚本。\\n"
  toolCalls = [
    {
      id = "019abbf4e8c5b19442ae1eacc72b1eb0"
      name = "bash"
      input = {
        command = "ls -la"
      }
    }
  ]
}>`;

    expect(output).toBe(expected);
  });
});
