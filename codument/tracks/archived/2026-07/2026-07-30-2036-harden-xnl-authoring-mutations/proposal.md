# 变更：强化 XNL Authoring Mutation 原语

## 背景和动机 (Context And Why)

XNL mutation 已经使用节点 `#id` 对齐树节点并识别同层、跨层 move，这个
identity-based 设计必须保持。面向文档、DSL 与多 actor authoring 时，调用方
还需要在接受候选状态之前预演一个 mutation batch，校验前置值、identity
唯一性和最终 parity，并保证失败不会污染 base snapshot。

当前 `applyMutations` 是面向已受信调用方的原地顺序 apply；它没有提供
clone-based dry-run、结构化 rejection 或 `valueBefore` precondition。现有
move parity 测试也没有真正断言 apply 后等于目标树，节点 tag 变化没有进入
diff。上层若各自补这些能力，会形成多套 mutation 语义。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 保持 `#id` 是 identity key，不把它当作普通可更新字段。
- 提供不修改 base 的 mutation batch dry-run/atomic apply 结果。
- 支持可选的 `valueBefore` precondition 与结构化 diagnostics。
- 提供可配置的 XNL element identity 唯一性/缺失校验。
- 明确同 kind 节点 tag 变化的 diff/apply 语义。
- 用同层、跨层、轮转 move 和 mixed add/delete/update 的 parity 性质测试证明
  `apply(base, diff(base, target)) == target`。

**非目标:**

- 不把 `#id` 改造成普通属性 update。
- 不定义 Document/Flow 等上层领域命令。
- 不实现 VFS/VCS revision CAS；它由后续独立 Track 负责。
- 不改变 parser、formatter 或 loader 的 XNL 语法。
- 不引入自动 merge、CRDT 或 OT。

## 变更内容（What Changes）

- 在 `xnl-core` mutation 模块增加 renderer-neutral 的 batch preview/result
  与 identity diagnostics API。
- 保留现有 `diffNodes` 和 `applyMutations` public API；新增严格 authoring
  API，避免破坏当前受信调用方。
- 在严格 API 中 clone base、校验前置条件、执行 batch、校验结果 identity，
  失败时返回 diagnostics 而不暴露部分 apply。
- 补齐 tag diff 和真实 mutation parity 测试。
- 公开新类型与入口，并更新 mutation API 文档。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`xnl-mutation-transaction`
- 受影响的代码：`packages/core/src/mutation/`、`packages/core/src/index.ts`
- 受影响的测试：`packages/core/tests/mutation*.test.ts`
- 兼容性：现有 mutable `applyMutations` 行为保持；严格事务 API 为新增能力
