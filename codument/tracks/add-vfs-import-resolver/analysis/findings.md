# Findings

## Found Facts
- xnl-core 无文件级 import：grep `Import\|vfs-import\|resolveImport` 在 packages/core/src、packages/vfs/src 均无命中。
- xnl-core loader 已有：`proto=Name` + `Prefabs` 原型继承、`export=true name=` 导出、`batchLoad(batches)` 跨批次共享原型 + 产出 `exports[tag][name]`、`remove=true` 删除合并。
- xnl-vfs 已有 path 工具：normalizeVfsPath/joinVfsPath/dirnameVfsPath/basenameVfsPath/relativeVfsPath；VirtualFileSystem readFile/readdir/stat/exists。
- 规范来源：sparrow dynamic-workflow spec/layer-1-kernel.md §1 Imports（`<Import as src="vfs://">`、同别名合并、零 import 目录 glob 回退、vfs 三式寻址 @/ ./ ../）。
- xnl.ts/codument 工作区:新格式 std(operations/spec/sop)，但有旧根文件残留(product.md/project.md/tracks.md)、无 behaviors/ 目录、archive 仍是旧 plan.xml/spec.md(OpenSpec 迁移)。能力命名习惯 `xnl-<area>`(xnl-mutation/xnl-path/xnl-loader)。

## Constraints
- xnl-core 不绑 xnl-vfs：用依赖反转的 ImportResolver 接口。
- 不改 parser/path/mutation/formatter 既有协议。
- 复用 loader exports + batchLoad，不另造导出机制。

## Open Questions
- 受支持的引用 metadata key(type/ref/proto 起步)。
- 循环 import 检测(CIRCULAR_IMPORT)。
- 目录 import 是否递归子目录(起步不递归)。

## Conclusions
- 新增 capability `xnl-import`：`<Imports><Import as src="vfs://">` 解析 + per-alias 符号表 + 同别名合并 + 重复报错 + 零 import 回退。
- core 用 `resolveImports(rootDoc, resolver, {baseDir, workspaceRoot})`；vfs/codument 提供 resolver 适配。
