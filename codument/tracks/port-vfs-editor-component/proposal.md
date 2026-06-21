# 变更：移植 vfs-editor 为 xnl.ts 可复用组件子包 + demo 应用

## 背景
`/Users/kongweixian/infra-dev/vfs-editor` 是一个独立 Vue3+Pinia 应用，自造了一份虚拟文件系统（`stores/vfsStore.ts` + `db/indexedDb.ts`），**未使用** xnl 生态的 `xnl-vfs`/`xnl-vcs`/`xnl-core`。

eidolon-workbench 的 DEPA 分析（`codument/analysis/xnl-editor-depa-refactor`）判定：vfs-editor 的文件系统/历史能力应收敛到 xnl 的成熟中立库，并把编辑器抽成**可复用组件**。本 track 在 xnl.ts 内落地这一收敛。

## 变更内容
1. 新建子包 **`packages/vfs-editor`**（包名 `xnl-vfs-editor`）——可复用 Vue3 组件库：
   - 导出 `VfsEditor` 组件 + composables（`useVfsTree`/`useVfsOperations`/`useZipExport`）+ types + 基于 xnl-vfs 的 store 绑定工厂。
   - **数据层重写到 xnl-vfs**：删除 bespoke `vfsStore`/`db/indexedDb`，改为对 `VirtualFileSystem` + `IndexedDbVfsPersistence` 的薄绑定（一 tree 一 VFS 实例 + workspaceId）。
   - **布局（位置/折叠/zoom）存 vfs `extend`**、键用稳定 XNL id、永不反写 XNL（决策 D1）。
   - **历史走 xnl-vcs**：显式保存=`repo.commit`、去抖 autosave=`persistWorkspace`（决策 D2）。
   - 构建用 **vite lib 模式**（`@vitejs/plugin-vue` + `vue-tsc -d` 出类型）——子包既有 tsup 约定处理不了 `.vue`。
   - 重 UI 依赖 **element-plus / ag-grid-community / @guolao/vue-monaco-editor / pinia / vue** 作 **peerDependencies**（消费方提供）。
   - **ag-grid 降为 community**（去 enterprise）：Tree Data 是 enterprise 付费功能 → **重写树渲染**（community + 扁平化行/缩进/展开折叠自实现）。
   - 运行时依赖 **xnl-vfs / xnl-vcs / xnl-core**（workspace:^）+ jszip。
2. 新建 demo 应用 **`demo/vfs-editor`**（包名 `xnl-vfs-editor-demo`）——消费 `xnl-vfs-editor` 的可运行 vite 应用：
   - **编辑器为主**：移植 app 壳 `App.vue`/`main.ts`/`router`/`views`（TreeListPage/TreeEditorPage）。
   - **不移** LLMConfig 页 / prompt-service 来源 / PromptSelectorDialog 等 app 特定功能（可留最小占位）。
   - demo 负责构造具体 vfs/vcs 实例并注入组件；提供可点运行的编辑器（create/edit/save=commit/export）。

## 影响范围
- 新增：`packages/vfs-editor/**`、`demo/vfs-editor/**`。
- 根 `pnpm-workspace.yaml` 已含 `packages/*` + `demo/*`，无需改 glob。
- 源仓 `infra-dev/vfs-editor` 作为移植来源（只读参照），不在本仓改动。

## 非目标
- 不改 xnl-core/xnl-vfs/xnl-vcs 库本身（它们是被消费的 vendor 原语；若发现缺口登记 backlog）。
- 不做多人协作（xnl-collab）——留后续。
- 不做 eidolon-workbench 侧改造——**本 track 完工后**另起 workbench track（移植 bastard 示例 / 复用本组件）。
- 不追求与源应用 100% 像素一致；保功能等价 + DEPA 合规。

## 决策来源
eidolon-workbench `codument/analysis/xnl-editor-depa-refactor/convergence/decisions.md`（D1 布局→vfs extend·随文件版本化；D2 commit=显式保存）+ recommendations/impl-context R1–R5。
