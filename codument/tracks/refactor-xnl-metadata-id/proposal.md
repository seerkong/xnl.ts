# 变更：Refactor metadata.id handling via xnl.ts metadataIdMode

## 背景和动机 (Context And Why)
项目内存在多处对 `metadata.id` 的上层“过滤/保护”逻辑（client 过滤 metadata.id mutations、server 将 metadata.id delete 改写为 update 等）。

近期 `vendor/xnl.ts` 已具备可配置的 `metadataIdMode`（默认 `identity`）能力：在 `identity` 模式下，diff/apply 会忽略 `metadata.id` 变更，同时仍可将其作为稳定定位信息。

因此，上层的冗余逻辑可以下沉为“调用点显式传参 + 删除重复过滤/改写”，从而减少代码复杂度，并把 `metadata.id` 的语义统一在库层。

## “要做”和“不做” (Goals / Non-Goals)
**目标:**
- 统一 `metadata.id` 的语义：作为稳定 identity 字段，默认不参与业务变更 diff/同步。
- 移除项目内对 `metadata.id` mutation 的冗余过滤与改写逻辑，减少维护成本。
- 在关键 diff/apply 调用点显式传入 `{ metadataIdMode: "identity" }`，提升可读性和抗未来变更能力。
- 增加 `vendor/xnl.ts` 的单测覆盖，锁定 `metadataIdMode` 的 diff/apply 行为。

**非目标:**
- **不做** 将 `metadata.id` 当作业务字段同步（即把 `metadataIdMode: "metadata"` 作为默认/常用路径）。
- **不做** 扩展 mutation 层 `readMetaId` 去支持非 string 形式（例如 Word）；仍由上层 canonicalization 确保 `metadata.id` 为 string。
- **不做** 大规模重构或引入新依赖。

## 变更内容（What Changes）
- `@braid-demo/realtime-client`
  - 移除 `isMetaIdObjectMutation` 以及对 `rawMutations` 的过滤。
  - `diffNodes` 调用点显式传入 `{ metadataIdMode: "identity" }`。
- `@braid-demo/realtime-server-bun`
  - 在 `sanitizeMutations` 中移除针对 `metadata.id` 的 delete→update 改写逻辑（apply 阶段会忽略该字段）。
  - 保留并继续使用“同父 list 的多次 TREE_DELETE 按 index 降序重排”的逻辑，避免 index shift。
- `@braid-demo/realtime-core`
  - `XNL.mutation.apply` 调用点显式传入 `{ metadataIdMode: "identity" }`。
- `vendor/xnl.ts`
  - 新增单测覆盖：`metadataIdMode` 在 diff/apply 中的 identity vs metadata 行为差异。

## 影响范围（Impact）
- 受影响的功能规范：realtime diff/apply pipeline 中 `metadata.id` 的处理语义（视为 identity，不当业务字段）。
- 受影响的代码模块：
  - `packages/realtime-client`
  - `packages/realtime-server-bun`
  - `packages/realtime-core`
  - `vendor/xnl.ts`（tests）
- 验证/验收：
  - 运行 `vendor/xnl.ts` 的测试
  - 运行 `apps/demo` 的 build（刷新 demo 产物）
