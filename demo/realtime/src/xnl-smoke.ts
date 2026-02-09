import { parseXnl } from "@xnl/core";

const doc = parseXnl("<a>");
console.log(JSON.stringify(doc));
