# 变更：为 XNL 增加 vfs-import 跨文件解析（`<Import as src="vfs://">`）

## 背景和动机 (Context And Why)

XNL 当前只能在**单文件内**做逻辑组合：loader 的 `proto` / `Prefabs` / `export` + `batchLoad` 能跨“批次”共享原型与导出，但没有**文件级 import**——无法在一个文档头部用 `<Import as="X" src="vfs://...">` 显式引入另一个文件/目录里的定义，并以命名空间别名 `X:name` 引用。

下游需求（codument 的 `add-modeling-registry`）要把领域建模 registry 拆成分形多文件，节点需跨文件引用类型/定义。sparrow Layer-1 内核语言已设计了 `<Imports>` + `vfs://` + `as` 命名空间合并这套规范，但 xnl-core 尚未实现。本 track 补上这个能力，作为 modeling registry 多文件管理的底座。

## “要做”和“不做” (Goals / Non-Goals)

**目标:**
- 在 xnl-core 增加 `<Imports><Import as="X" src="vfs://...">` 文档头指令的解析与解析器（resolver）。
- 支持 `src` 指向**文件**或**目录（类型包）**；vfs 三式寻址 `vfs://@/`（工作区根）/ `vfs://./`（相对当前文件）/ `vfs://../`（父目录）。
- `as` = 别名命名空间前缀：文档内以 `X:name`（如 `type="review:Artifact"`、`ref="coding:coding-attractor"`）引用导入符号。
- **同别名合并**：多个 `<Import as="X">` 共享别名 X 时，导出符号合并进同一命名空间；重复 id → 报错，不静默覆盖。
- **零 import 回退**：无 `<Imports>` 时保留“目录 glob 自动加载”作为向后兼容。
- 复用既有 loader 的 `export=true name=` / `Prefabs` 导出与 `batchLoad`；复用 xnl-vfs 的 path 工具做 vfs 路径规范化。

**非目标:**
- 不让 xnl-core 直接依赖 xnl-vfs：解析器接收一个 **file/dir resolver 接口**（依赖反转），具体读文件由调用方（xnl-vfs 或 codument）提供。
- 不实现远程 / http import（仅 vfs 本地寻址）。
- 不改 mutation / path / formatter 既有协议。

## 变更内容（What Changes）

- 新增 `xnl-core` 解析能力：解析 `<Imports>` 节点 + `<Import as src>` 指令。
- 新增 import 解析器：`resolveImports(rootDoc, resolver, baseDir)` → 构建 per-alias 符号表，解析文档内 `alias:name` 引用。
- 复用 loader 的 exports（`batchLoad` 的 exports map，按 tag/name 索引）。
- vfs 路径解析复用 `xnl-vfs` 的 `normalizeVfsPath` / `joinVfsPath` / `dirnameVfsPath`。
- 同别名合并 + 重复 id 报错 + 零 import 目录 glob 回退。

## 影响范围（Impact）

- 受影响的功能规范：`xnl-import`（新增能力）。
- 受影响的代码：`packages/core/src/loader/`（或新增 `packages/core/src/import/`）；`packages/vfs`（可能新增一个 fs/vfs resolver 适配，供调用方复用）。
- 下游：codument `add-modeling-registry` 的多文件 registry 依赖本能力。
