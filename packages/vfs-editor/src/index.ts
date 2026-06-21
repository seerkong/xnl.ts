// xnl-vfs-editor — reusable VFS editor Vue component package.
// P2: UI component layer ported from app `vfs-editor`, tree rendering rewritten
// from the paid treeData feature down to ag-grid-community (self-computed
// visible rows). Components are controlled: props in / events out.
// P3 (xnl-vfs data layer) / P4 (xnl-vcs history) fill in later.

export const XNL_VFS_EDITOR_VERSION = "0.1.0";

// ============================================
// 组件
// ============================================
export { default as VfsEditor } from "./VfsEditor.vue";
export { default as CreateNodeDialog } from "./dialogs/CreateNodeDialog.vue";
export { default as EditNodeDialog } from "./dialogs/EditNodeDialog.vue";
export { default as UploadFolderDialog } from "./dialogs/UploadFolderDialog.vue";
export { default as VfsNameRenderer } from "./renderers/VfsNameRenderer.vue";
export { default as VfsActionsRenderer } from "./renderers/VfsActionsRenderer.vue";

// ============================================
// Composables
// ============================================
export {
  useVfsTree,
  useZipExport,
  type TreeDataNode,
  type UseVfsTreeOptions,
} from "./composables";

// ============================================
// 类型 / 常量 / 守卫
// ============================================
export type {
  // 目录树
  VfsTree,
  CreateVfsTreeParams,
  UpdateVfsTreeParams,
  // 节点
  VfsNode,
  VfsNodeType,
  CreateVfsNodeParams,
  UpdateVfsNodeParams,
  // 来源类型与配置
  VfsSourceType,
  VfsSourceConfig,
  StaticSourceConfig,
  OnlineDocsSourceConfig,
  PromptServiceSourceConfig,
  StaticContentType,
  FetchMode,
} from "./types";

export {
  // 常量
  SOURCE_TYPE_OPTIONS,
  STATIC_CONTENT_TYPE_OPTIONS,
  FETCH_MODE_OPTIONS,
  // 类型守卫
  isStaticSourceConfig,
  isOnlineDocsSourceConfig,
  isPromptServiceSourceConfig,
} from "./types";

// ============================================
// 数据层（xnl-vfs / xnl-vcs 绑定，P3/P4）
// ============================================
export {
  useXnlVfsStore,
  type XnlVfsStore,
  type XnlVfsStoreOptions,
} from "./store/xnlVfsStore";
export {
  createXnlVcsHistory,
  type XnlVcsHistory,
  type XnlVcsHistoryOptions,
} from "./store/xnlVcsHistory";
export { flattenSnapshot, toVfsPath, toComponentPath } from "./store/mapping";
