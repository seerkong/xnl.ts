import { parseXnl } from "xnl.ts";

const doc = parseXnl("<a>");
console.log(JSON.stringify(doc));
