# 变更：封闭 strict XNL identity replacement 绕过

## 背景和动机 (Context And Why)

`xnl-core.dryRunMutations` 已拒绝直接针对 element `:id` 的 add/update/delete，
但调用方仍可用 `TREE_UPDATE` 或 `OBJECT_UPDATE` 替换包含 element 的整个节点或
容器，从而把 `<Item #old>` 原地变成 `<Item #new>`。这绕过了“`#id` 只用于
identity alignment，identity replacement 必须由 delete+add 表达”的 strict
authoring 规则。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- strict mutation batch 拒绝隐藏在 whole-node、metadata/body、array、extend
  或 object replacement 中的 effective identity 变化。
- update mutation 必须保留全树、顺序敏感的 identity skeleton；新增、删除、交换和
  搬动 identity 必须使用结构 mutation。
- strict identity continuity 同时保留 identity 值及其 authority source：
  explicit `#id` 与 metadata compatibility fallback 不能借 whole-node update
  相互替换，即使两者字符串相同。
- assignment-style add/move 不得覆盖已占用的 identified destination；空目标与
  普通 array insertion 保持可用；Extend index insertion 还必须验证 child tag
  不会覆盖现有 child。
- 保持同 identity 节点的 tag、metadata、attributes、body text 与普通 payload
  更新可用。
- 保持 `diffNodes` 使用 `#id` 对齐并生成 move；不把 `#id` 加入普通字段比较。
- Extend child 重排必须全部由显式 move mutation 表达（有 `#id` 时按 identity，
  无 identity 时按 `pathBefore`），而不是更新 `extend.order` 容器；
  diff/apply/strict dry-run 保持 parity。
- Extend child retag 必须迁移 `children` key 与 `order` entry，不能只更新 child
  tag 后留下不一致结构。
- 保持 legacy `applyMutations` 源兼容。

**非目标:**

- 不要求普通 XNL 的所有 element 都有 identity。
- 不改变 delete/add/move 的现有结构语义。
- 不在本 Track 中实现 revision persistence。

## 变更内容（What Changes）

- 为 strict batch 增加 full-tree update identity-skeleton invariant 与
  structural destination guard。
- 修正 Extend diff，把 identified child reorder 编译成有序 move mutation，并
  把 missing-identity reorder 编译成 path-based move；区分普通 array insertion
  与 Extend tag-keyed insertion。
- 为 XNL move mutation 增加可选 `destinationKey` 结构载体，使 same-identity
  Extend retag 与非尾部 reorder 能由一次 move + 后续 payload update 表达。
- 复用 `IDENTITY_MUTATION_FORBIDDEN` diagnostic 表达 direct 与 hidden identity
  mutation；新增 `RESULT_STRUCTURE_INVALID` 表达 batch-final Extend
  order/key/tag incoherence。
- 添加 whole-node/container replacement、metadata fallback、`#id` precedence、
  raw authority source transition、Extend reorder/collision、occupied add/move
  destination、identity swap、same-id update、delete+add replacement 与 diff
  residue 测试。
- 更新 `xnl-core` 文档与构建输出。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`xnl-mutation-transaction`
- 受影响的代码：
  - `packages/core/src/mutation/index.ts`
  - `packages/core/src/path/index.ts`
  - `packages/core/tests/mutation-authoring-characterization.test.ts`
  - `packages/core/README.md`
  - `packages/core/dist/`
