## 上下文

- `metadata.id` 在本项目中用于 XNL 节点的稳定标识（identity），用于提升 diff/apply 的稳定性（例如 selector/move）。
- 近期 `vendor/xnl.ts` 已支持 `XnlMutationOptions.metadataIdMode`：
  - `identity`（默认）：diff/apply 忽略 `metadata.id` 变更
  - `metadata`：把 `metadata.id` 当作普通字段处理

本 Track 的核心是：把“`metadata.id` 不参与业务变更”这一约束从上层散落逻辑，收敛为库层语义 + 关键调用点显式参数。

## 方案概览

1. 统一语义：关键 diff/apply 调用点显式传 `{ metadataIdMode: "identity" }`
  - realtime-client：diff
  - realtime-core：apply
2. 删除冗余逻辑
  - realtime-client：删除 `isMetaIdObjectMutation` 以及基于它的 filter
  - realtime-server-bun：删除 `metadata.id` delete→update 改写
3. 保留必要的 sanitize
  - realtime-server-bun：保留多条 `TREE_DELETE` 对同父 list 的 index 降序重排
4. 用单测锁定行为
  - vendor/xnl.ts：新增测试覆盖 `metadataIdMode` 的 diff/apply 行为（identity vs metadata）

## 影响范围与修改点（Impact）

- `packages/realtime-client/src/index.ts`
  - 删除 metadata.id filter，并在 `diffNodes` 显式传参
- `packages/realtime-server-bun/src/index.ts`
  - 精简 `sanitizeMutations`：移除 `metadata.id` delete→update 改写，保留 TREE_DELETE 重排
- `packages/realtime-core/src/merge.ts`
  - `XNL.mutation.apply` 显式传参
- `vendor/xnl.ts/tests/*`
  - 新增/扩充测试

## 决策

- 决策：将 `metadata.id` 视为 identity 字段；默认不允许/不传播对其的变更（通过 `metadataIdMode: "identity"` 实现）。
- 原因：
  - 避免把 identity 字段当作业务 diff 传播，减少无意义的 mutation 噪音
  - 减少项目内重复/分叉的过滤与保护逻辑
  - 显式参数增强可读性，避免未来默认值变化造成隐式行为漂移

- 考虑的替代方案：
  - 替代方案 A：继续保留上层 filter/sanitize（现状）
    - 缺点：重复实现、维护成本高、行为不一致风险更高
  - 替代方案 B：在 diff/apply 内部硬编码忽略 `metadata.id`（无可选项）
    - 缺点：缺少可配置入口，不利于后续迁移/特殊场景

## 风险 / 权衡

- 风险：如果未来有场景希望把 `metadata.id` 当作业务字段同步，需要切换到 `metadataIdMode: "metadata"` 并评估对 move/selector 的影响。
  - 缓解：关键调用点显式传参；vendor 单测覆盖两种模式差异。

- 风险：移除 server 端的 `metadata.id` delete→update 改写后，依赖该改写的行为可能变化。
  - 缓解：在 `identity` 模式下 apply 本就会忽略 `metadata.id` mutation；通过测试锁定。

## 兼容性设计

- 默认行为保持与当前预期一致：`metadata.id` 不作为业务变更传播。

## 迁移计划

1. 先在 `vendor/xnl.ts` 补齐 `metadataIdMode` 的单测覆盖，保证语义可验证。
2. 修改 consumer 调用点显式传参（client diff / core apply）。
3. 删除冗余 filter/sanitize 逻辑。
4. 运行验收：vendor tests + demo build。

## 待解决问题

- 当前 mutation 层 `readMetaId` 仅识别 string；若后续需要支持 Word，需要另起 Track 处理。
