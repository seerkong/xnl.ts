# 设计：xnl-vfs-editor 组件子包 + demo

## 1. 包边界（可复用 component vs demo app）

| 源（infra-dev/vfs-editor/src）| 去向 | 说明 |
|---|---|---|
| `components/VfsEditor/**`（index.vue/types/renderers/composables/dialogs）| `packages/vfs-editor/src/` | 可复用核心 |
| `stores/vfsStore.ts` | `packages/vfs-editor/src/store/`（**重写**）| 改为 xnl-vfs 薄绑定 |
| `db/indexedDb.ts` | **删除** | 由 xnl-vfs `IndexedDbVfsPersistence` 取代 |
| `utils/ag-grid.config.ts` | `packages/vfs-editor/src/utils/` | 随组件 |
| `App.vue`/`main.ts`/`router/`/`views/`/`components/PromptSelectorDialog.vue` | `demo/vfs-editor/src/` | app 壳 |

## 2. 子包结构 `packages/vfs-editor`
```
package.json        name=xnl-vfs-editor; peerDeps(vue,element-plus,ag-grid-community,monaco,pinia); deps(xnl-vfs,xnl-vcs,xnl-core,jszip)
vite.config.ts      lib 模式 + @vitejs/plugin-vue；external 所有 peerDeps + xnl-*
tsconfig.json       vue-tsc 友好；declaration via vue-tsc -d
src/
  index.ts          导出 VfsEditor + composables + types + createVfsBinding
  VfsEditor.vue     (← components/VfsEditor/index.vue)
  types.ts          (D1：VfsLayout 键 stableXnlId)
  renderers/*.vue   VfsNameRenderer / VfsActionsRenderer
  dialogs/*.vue     Create/Edit/UploadFolder
  composables/*     useVfsTree / useVfsOperations / useZipExport（改调 xnl-vfs）
  store/
    vfsBinding.ts   薄绑定：VirtualFileSystem + IndexedDbVfsPersistence（替 vfsStore/db）
    vcsBinding.ts   Repository(IndexedDbRepositoryBackend) + save=commit + autosave
    layout.ts       布局读写 vfs extend（键 stableXnlId）
```
**构建**：`scripts.build = vite build && vue-tsc -d --emitDeclarationOnly`；exports 指向 `dist/`。

## 3. 数据层重写（R1/D1）
- `vfsBinding`：每 tree 一 `new VirtualFileSystem({reservedNames:['.node-meta','.xnl-vcs']})` + `new IndexedDbVfsPersistence({workspaceId:treeId})`；`Map<treeId,vfs>`。
- CRUD 映射（详见 workbench impl-context R1）：createNode→算 path→`vfs.writeFile/mkdir`；delete→`vfs.unlink/rmdir`；rename/move→`vfs.rename`；扁平视图=遍历 `vfs.getSnapshot()`。
- 无响应式 → Pinia store 改后 `refreshNodes()` 重建 `currentNodes` ref。
- source-type（static/online-docs/prompt-service）存 `node.extend.sourceConfig`；online/prompt 由 demo 层 lazy-fetch。
- **布局** `layout.ts`：读 `vfs.getExtend(filePath).layout` / 写经 `VfsMutation(EXTEND_UPDATE)`；键 `Record<stableXnlId,{x,y,collapsed}>`+zoom；**永不进 XNL content**。

## 4. 历史层（R2/D2）
- `vcsBinding`：`new Repository({backend:await IndexedDbRepositoryBackend.open({dbName,repoId}), store, contentStore})`；`repo.init('main')`；启动 `loadWorkspaceState()`。
- 三档：apply 每编辑（vfs 写）/ 去抖 `persistWorkspace()` autosave / 显式保存按钮→`repo.commit(msg,{author})`。
- 最小历史 UI：log 列表 + checkout（可放 demo 层；组件暴露 hook）。

## 5. demo `demo/vfs-editor`（编辑器为主）
```
package.json   name=xnl-vfs-editor-demo; deps: xnl-vfs-editor(workspace:*) + 全部 peerDeps 实体 + xnl-*
vite.config.ts + index.html
src/ App.vue main.ts router/ views/(TreeListPage/TreeEditorPage)
```
demo 构造 vfs/vcs 实例、装配 element-plus/ag-grid-community/monaco 插件、渲染 `<VfsEditor>`。
**不移** LLMConfigPage / PromptSelectorDialog / prompt-service 来源（app 特定，留最小占位或省）。

## 6. 验证
- 包：`vite build`（lib 产物）+ `vue-tsc --noEmit`（类型）+ 移植的 `useZipExport.spec` 等测试零回归。
- demo：`vite build` 通过 + `vite dev` 可起、能创建/编辑/保存(commit)/导出。
- DEPA 自检：grep 确认无 bespoke db、布局不入 XNL content、单写经 mutation。

## 7. 风险/坑
- Vue SFC 类型导出：用 `vue-tsc -d`（tsup 不行）。
- peerDeps 版本对齐（element-plus2/ag-grid-community35/vue3.5）。
- **ag-grid 降 community（已定）**：Tree Data 是 enterprise 付费功能 → **重写树渲染**（community + 扁平行/缩进/展开折叠自实现，作为 P2 的一部分）。
- xnl-vfs 无响应式：所有 UI 刷新靠 store 主动重建。
- 布局 ID 错配：务必键稳定 XNL id，转换时 idMapping 贴回 ulid。
- demo 编辑器为主（已定）：LLMConfig/prompt-service 不移。
