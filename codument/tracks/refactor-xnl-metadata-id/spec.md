# Track Spec: refactor-xnl-metadata-id

## 概述

本 Track 目标：在当前项目的 realtime pipeline（client diff → server apply → merge/canonicalize）中，把 `metadata.id` 明确视为“稳定 identity 字段”，并利用 `xnl.ts` 提供的 `metadataIdMode` 能力移除冗余的过滤/清洗逻辑；同时补充必要测试，保证行为不回退。

## ADDED Requirements

### Requirement: 默认将 `metadata.id` 作为 identity 字段处理
系统在进行 XNL mutation diff/apply 时，**默认**应当（SHALL）将 `metadata.id` 作为 identity 字段处理：
- diff：不把 `metadata.id` 的变化当作业务变更输出为 mutation
- apply：忽略任何指向 `metadata.id` 的 mutation

#### Scenario: diff 不产出 `metadata.id` 相关 mutations
- **GIVEN** `baseNodes` 与 `desiredNodes` 仅在 `metadata.id` 上存在差异
- **WHEN** 使用 `diffNodes(baseNodes, desiredNodes, [], { metadataIdMode: "identity" })` 计算 mutations
- **THEN** 返回的 mutations 列表不包含 path 指向 `...metadata.id` 的 `OBJECT_ADD` / `OBJECT_UPDATE` / `OBJECT_DELETE`

#### Scenario: apply 忽略 `metadata.id` 相关 mutations
- **GIVEN** 输入 mutations 中包含 path 指向 `...metadata.id` 的 `OBJECT_*` mutation
- **WHEN** 使用 `applyMutations(root, mutations, { metadataIdMode: "identity" })` 应用到现有文档
- **THEN** 输出文档中的 `metadata.id` 值保持不变

### Requirement: realtime-client 不再依赖额外 filter 来丢弃 `metadata.id` 变更
`@braid-demo/realtime-client` 在生成要发送到 server 的 mutations 时，应当（SHALL）不再依赖额外的 `isMetaIdObjectMutation` 过滤器来移除 `metadata.id` 变更，而是依赖 `xnl.ts` 的 `metadataIdMode: "identity"` 行为。

#### Scenario: 仅修改 `metadata.id` 不产生可发送 mutations
- **GIVEN** 用户输入导致 `metadata.id` 字段发生变化（例如删除/覆盖）
- **WHEN** client 生成 mutations 并准备发送到 server
- **THEN** client 不会发送仅由 `metadata.id` 变化构成的 mutations

### Requirement: realtime-server-bun 不再需要把 `metadata.id` delete 改写为 update
`@braid-demo/realtime-server-bun` 在 sanitize mutations 时，应当（SHALL）移除对 `metadata.id` delete 的特殊改写（delete → update），因为 apply 阶段会忽略 `metadata.id`。

#### Scenario: server 对 `metadata.id` delete 不做改写
- **GIVEN** server 收到的 mutations 中包含对 `metadata.id` 的 `OBJECT_DELETE`
- **WHEN** server 执行 sanitize
- **THEN** sanitize 不会再将其改写为 `OBJECT_UPDATE`

### Requirement: sanitize 必须保留 TREE_DELETE 的降序重排
当同一父节点 list 上存在多个 `TREE_DELETE`（按 index 删除）时，server 的 sanitize 逻辑应当（SHALL）按 index 降序重排以避免 index shift。

#### Scenario: 同父 list 的多次 TREE_DELETE 按 index 降序
- **GIVEN** 一组 mutations 中存在对同一个 list parent 的多条 `TREE_DELETE`，且删除 index 不同
- **WHEN** server 执行 sanitize
- **THEN** 输出 mutations 中这些 `TREE_DELETE` 的删除 index 顺序为降序

## ADDED Requirements (Tests)

### Requirement: xnl.ts 对 `metadataIdMode` 的行为有单测覆盖
`vendor/xnl.ts` 应当（SHALL）增加单测，覆盖 `metadataIdMode` 在 diff/apply 两侧的关键语义。

#### Scenario: diff 在 identity 模式忽略 metadata.id
- **GIVEN** old/new nodes 仅在 `metadata.id` 上不同
- **WHEN** 调用 `diffNodes(..., { metadataIdMode: "identity" })`
- **THEN** 不产生 `metadata.id` 相关 mutation

#### Scenario: diff 在 metadata 模式包含 metadata.id
- **GIVEN** old/new nodes 仅在 `metadata.id` 上不同
- **WHEN** 调用 `diffNodes(..., { metadataIdMode: "metadata" })`
- **THEN** 产生 `metadata.id` 相关 mutation

#### Scenario: apply 在 identity 模式忽略 metadata.id update
- **GIVEN** root 含有 `metadata.id` 且 mutation 试图更新/删除该字段
- **WHEN** 调用 `applyMutations(..., { metadataIdMode: "identity" })`
- **THEN** `metadata.id` 不改变

#### Scenario: apply 在 metadata 模式允许 metadata.id update
- **GIVEN** root 含有 `metadata.id` 且 mutation 试图更新/删除该字段
- **WHEN** 调用 `applyMutations(..., { metadataIdMode: "metadata" })`
- **THEN** `metadata.id` 发生相应改变

## Non-Functional Requirements

### Requirement: 调用点显式化
为了提升可读性与避免未来默认值变化导致行为漂移，涉及 realtime diff/apply 的关键调用点应当（SHALL）显式传入 `{ metadataIdMode: "identity" }`。

#### Scenario: 关键调用点均显式传参
- **GIVEN** 代码中存在 realtime diff/apply 的关键调用点
- **WHEN** 进行代码审查
- **THEN** 这些调用点均显式传入 `{ metadataIdMode: "identity" }`

## Out of Scope

- 将 `metadata.id` 当作业务字段进行同步（即 `metadataIdMode: "metadata"` 作为默认值）
- 在 `xnl.ts` mutation 层扩展 `readMetaId` 去支持非 string 形式（例如 Word）；该部分仍由上层在 canonicalization 阶段保证 `metadata.id` 为 string
