import { XnlWord } from "./types";

export function GetWordFullName(word: XnlWord): string {
  const parts = [...(word.namespace ?? []), word.name].filter((part) => part.length > 0);
  return parts.join(".");
}

export function MakeWord(wordStr: string, namespace = []): XnlWord {
  return {
    kind: "Word",
    namespace: namespace,
    name: wordStr
  }
}