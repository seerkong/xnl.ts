# 变更：xnl-core 支持点分 FQN tag 名（`<dg.materials.CrudTable>`）

## 背景和动机 (Context And Why)

下游 dg-cell-mvi lowcode v3 分层单元 DSL（mission `redesign-lowcode-hierarchical-unit-dsl`，位于 `/Users/kongweixian/infra-dev/dg-cell-mvi/codument/missions/active/`）决定：元素树中 component/page 实例用**定义 FQN 做 tag**，如 `<dg.materials.CrudTable #users-table>`、`<elementPlus.ElInput #kw>`（类 Java 限定名，`.` 分隔命名空间）。

该 mission 的 G1-T1 能力验证（evidence：其 `analysis/xnl-core-capability-report.md`）实测结论：xnl-core 0.1.7 中点分 `#id`、`(...)`+`[...]` 并存、引号内 scheme URI、点分 Word 属性值均已原生支持，**唯一缺口是 tag 名不支持 `.`**——`parseNode` 的 tag 走 `readIdentifier`，identifier 语法 `[A-Za-z_][A-Za-z0-9_-]*`（parser.ts:578-586），`<dg.materials.CrudTable>` 在 `.` 处报 `Expected metadata key`。

由于此前点分 tag 是解析错误，不存在依赖旧行为的文档，本变更为**纯增量**。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- `parseNode` 的 tag 读取支持点分序列 `seg(.seg)*`，每段沿用既有 identifier 语法；`DataElementNode.tag` / `TextElementNode.tag` 保持 string（存 joined 形态 `"dg.materials.CrudTable"`）。
- 非法形态（空段、首/尾点）明确报 parse error，不静默截断。
- formatter / lineBlockFormatter 输出点分 tag 原样，parse -> stringify -> parse 稳定。
- path / mutation(diff/apply) / loader/import 把点分 tag 当不透明 tag string，行为无变化（回归测试确认）。

**非目标:**

- 不把 tag 类型改为 Word{namespace,name}（消费方自行 split）。
- 不改 `#id`、attribute、Word 字面量等既有语法。
- 不放宽 identifier 段内字符集（`:`、`/` 等仍非法；scheme URI 仍须写在引号字符串中）。
- 不改 text 节点闭合标记（`</?marker>`）协议。

## 变更内容（What Changes）

- `packages/core/src/parser.ts`：`parseNode` tag 读取从单 `readIdentifier` 改为点分段读取（新增 `readTagName` 或复用 word segment 逻辑后 join）。
- 测试：`packages/core/tests/` 新增 dotted-tag 用例（grammar、全区段组合、roundtrip、mutation/path 回归）。
- formatter 预期零改动（tag 按 string 原样打印），以 roundtrip 测试证明。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`xnl-dotted-tag`（新增）
- 受影响的代码：`packages/core/src/parser.ts`；`packages/core/tests/*`
- 兼容性：纯增量；既有单段 tag 文档与全部既有测试不变。
- 下游消费者：dg-cell-mvi lowcode v3 track `add-lowcode-unit-bundle-loader`（fixtures 使用点分 tag 前置依赖本 track）。
