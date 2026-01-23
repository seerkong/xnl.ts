export function positionToLineColumn(input: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < input.length; i++) {
    const ch = input[i];
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
