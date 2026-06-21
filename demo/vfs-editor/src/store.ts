import { useXnlVfsStore, type XnlVfsStore } from "xnl-vfs-editor";

// Single shared store instance for the demo (the package store is a composable,
// not a global singleton — the demo decides the sharing scope).
let instance: XnlVfsStore | null = null;

export function useStore(): XnlVfsStore {
  if (!instance) {
    instance = useXnlVfsStore({
      dbName: "xnl-vfs-editor-demo",
      vcsDbName: "xnl-vfs-editor-demo-vcs",
      author: "demo-user",
    });
  }
  return instance;
}
