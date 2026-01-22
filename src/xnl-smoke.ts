import { parseXnl } from "../node_modules/xnl.ts/dist/index.js";

const doc = parseXnl("<a>");
console.log(JSON.stringify(doc));
