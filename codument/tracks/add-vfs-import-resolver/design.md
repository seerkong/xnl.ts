## 上下文

- xnl-core loader 现有跨节点组合：`proto=Name` + `Prefabs` 原型继承、`export=true name=` 导出、`batchLoad(batches)` 跨批次共享原型 + 产出 exports map（`exports[tag][name] = node`）。但**没有文件级 import**。
- xnl-vfs 提供 `vfs:///` 路径工具（`normalizeVfsPath`/`joinVfsPath`/`dirnameVfsPath`/`basenameVfsPath`/`relativeVfsPath`）与 VirtualFileSystem（`readFile`/`readdir`/`stat`/`exists`）。
- 规范来源：sparrow dynamic-workflow Layer-1 §1 Imports（`<Import as src="vfs://">`、同别名合并、零 import 回退、vfs 三式寻址）。
- 约束：xnl-core 不应硬依赖 xnl-vfs（保持 core 轻量、可在浏览器/无 fs 环境用）。

## 方案概览

1. **解析层（parser/类型）**
   1. 识别文档头部 `<Imports>` 容器及其下 `<Import as="X" src="vfs://...">` 子节点（DataElement，metadata `as`/`src`）。
   2. 不改 XNL 语法本身——`<Imports>`/`<Import>` 是普通 DataElement，由 import 解析器按约定 tag 识别。

2. **解析器（依赖反转，不绑 vfs）**
   1. 接口：
      ```ts
      interface ImportResolver {
        readFile(vfsPath: string): string | null;          // 文件内容（null=不存在）
        readDir(vfsPath: string): string[] | null;         // 目录下条目（用于类型包/目录 import）
        isDir(vfsPath: string): boolean;
      }
      resolveImports(
        rootDoc: XnlDocument,
        resolver: ImportResolver,
        opts: { baseDir: string; workspaceRoot: string }
      ): { resolved: XnlDocument; symbols: Record<string, Record<string, XnlNode>>; warnings: string[] };
      ```
   2. vfs 三式寻址在解析器内按 `baseDir`/`workspaceRoot` 归一：`@/`→workspaceRoot、`./`→baseDir、`../`→dirname(baseDir)，复用 xnl-vfs path 工具。
   3. `src` 指**文件** → 读取并 `parseXnl`；指**目录** → `readDir` 收集 `.xnl` 文件逐个 parse（类型包）。
   4. 对每个被导入文档跑现有 `batchLoad`，取其 exports map；按 `<Import as="X">` 的别名 X 把 exports 并入 `symbols["X"]`。
   5. **同别名合并**：多个 import 共享 X → 合并进 `symbols["X"]`；同一 `X:name` 出现两个不同来源 → 抛 `DUPLICATE_IMPORT`（不静默覆盖）。
   6. **引用解析**：扫描 rootDoc 中形如 `X:name` 的引用位（约定出现在 `type=`/`ref=` 等 metadata 值，或显式 `proto=` 跨别名引用），用 `symbols["X"]["name"]` 解析；未命中 → `UNRESOLVED_IMPORT`。

3. **零 import 回退**
   1. rootDoc 无 `<Imports>` → 不做 import 解析，保持现状（向后兼容：调用方可选择目录 glob 自动加载，由调用方实现，core 只提供 batchLoad）。

4. **调用方适配（不在 core）**
   1. xnl-vfs 侧（或 codument 侧）提供一个 `ImportResolver` 实现：基于 VirtualFileSystem 或本地 fs 读 `vfs://` 路径。core 只依赖接口。

## 影响范围与修改点（Impact）

- 受影响的文件/模块：
  - `packages/core/src/import/index.ts`（新增：Import 指令解析 + `resolveImports`）。
  - `packages/core/src/index.ts`（导出 `resolveImports` / `ImportResolver`）。
  - `packages/core/src/loader/index.ts`（复用 exports；如需暴露 per-doc exports 提取）。
  - `packages/vfs/src/`（可选：提供 VfsImportResolver 适配，桥接 VirtualFileSystem → ImportResolver）。
- 不改：parser/path/mutation/formatter 既有协议。

## 决策摘要

- 详见 `decisions.md`。
- 关键：core 用依赖反转接收 resolver（不绑 vfs）；复用 loader exports + batchLoad；同别名合并 + 重复报错；vfs 三式寻址；零 import 回退保留。

## 风险 / 权衡

- **引用语法位置不唯一**（`type=`/`ref=`/`proto=` 都可能带 `X:name`）→ 先约定一组受支持的引用 metadata key，文档化；未识别位不强解析。
- **目录类型包加载顺序**影响重复检测 → readDir 结果排序后稳定加载。
- **core 不绑 vfs** 增加一层 resolver 接口 → 但换来 core 轻量、可测（mock resolver）。

## 兼容性设计

- 无 `<Imports>` 文档行为完全不变（零 import 回退）。
- 既有 `proto`/`Prefabs`/`batchLoad` 语义不变；import 解析在其之上加一层跨文件符号解析。

## 待解决问题

- 受支持的引用 metadata key 集合最终清单（`type`/`ref`/`proto` 起步）。
- 循环 import 的检测与报错（建议：访问栈 + `CIRCULAR_IMPORT`）。
- 目录 import 是否递归子目录（建议：起步只收当前目录 `.xnl`，递归留后续）。
