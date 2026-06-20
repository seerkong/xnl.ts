# Knowledge Context

## Source Notes
| Source | Summary | Relevance |
|--------|---------|-----------|
| `packages/core/src/loader/index.ts` | proto/Prefabs 原型继承、export/name 导出、batchLoad exports map、remove 合并 | import 解析复用其 exports |
| `packages/core/src/index.ts` | 公开 API：parseXnl/XNL/applyMutations/diffNodes/parsePath/loader | 新增 resolveImports 导出位 |
| `packages/vfs/src/path.ts` + `vfs.ts` | vfs 路径工具 + VirtualFileSystem 读写 | 提供 ImportResolver 适配 |
| sparrow `spec/layer-1-kernel.md` §1 | `<Imports>` + `<Import as src="vfs://">` 规范、同别名合并、零 import 回退、vfs 三式寻址 | 本能力的规范蓝本 |
| 下游 codument `add-modeling-registry` | modeling registry 分形多文件需跨文件引用 | 本 track 的需求方 |

## Codebase Knowledge
- XnlWord 支持 namespace（`#a.b.c` → namespace [a,b], name c）；alias:name 引用可映射到带 namespace 的 id。
- batchLoad 返回 `{ resolved, exports }`，exports 按 tag→name 索引——是 import 符号表的现成来源。
- loader 的 `export=true name=`/`Prefabs` 决定一个文件“导出什么”，import 别名只是给这些导出加命名空间前缀。

## Domain Knowledge
- 依赖反转：core 接收 resolver 接口而非绑定 vfs，保持 core 可在无 fs 环境运行、易 mock 测试。
- vfs 三式寻址：`@/`=workspace 根，`./`=当前文件目录，`../`=父目录。

## Terms
| Term | Meaning |
|------|---------|
| Import directive | `<Import as="X" src="vfs://...">` 文档头引入指令 |
| alias namespace | `as=` 别名前缀，文档内以 `X:name` 引用 |
| 同别名合并 | 多个 `<Import as="X">` 的导出并入同一命名空间 X |
| 零 import 回退 | 无 `<Imports>` 时保持现状（可选目录 glob） |
| ImportResolver | core 依赖反转接收的 file/dir 读取接口 |
