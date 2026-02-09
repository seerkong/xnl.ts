# xnl.ts metadata.id 能力落地：apps/demo & packages 可改造点

> 生成时间：2026-01-29

## 背景：vendor/xnl.ts 新增的 metadata.id 行为开关

`vendor/xnl.ts/src/mutation/index.ts` 新增了可选参数：

- `XnlMutationOptions.metadataIdMode?: "identity" | "metadata"`（默认 `"identity"`）
  - 定义位置：`vendor/xnl.ts/src/mutation/index.ts:27`

两种模式含义（基于当前实现）：

- `"identity"`（默认）
  - diff：忽略对 `metadata.id` 的变更，不产出对应的 mutations
    - 相关逻辑：`vendor/xnl.ts/src/mutation/index.ts:319`
  - apply：忽略任何 path 指向 `...metadata.id` 的 mutation（不删除/不更新）
    - 相关逻辑：`vendor/xnl.ts/src/mutation/index.ts:90`
  - 同时仍会把 `metadata.id` 当作稳定定位信息（用于 selector/move）

- `"metadata"`
  - diff/apply 都会把 `metadata.id` 当作普通字段处理
  - 不再依赖 `metadata.id` 做 identity（相关 move/selector 行为会与 `"identity"` 不同）

结论：之前在上层手写的「过滤/保护 metadata.id」逻辑，很多可以直接删除，或替换为显式传参。

---

## 可改造点 1：packages/realtime-client/src/index.ts

### 现状

- 手动过滤掉 `metadata.id` 的 object mutations：
  - `isMetaIdObjectMutation`：`packages/realtime-client/src/index.ts:226`
  - `rawMutations.filter((m) => !isMetaIdObjectMutation(m))`：`packages/realtime-client/src/index.ts:472`

目的：不把 `metadata.id` 当作业务变更发送到 server。

### 建议改造

- 方案 A（最小改动，推荐）：删除过滤器，直接使用 `diffNodes` 结果
  - 原因：`diffNodes(..., opts?)` 默认 `metadataIdMode="identity"` 已经不会产出 `metadata.id` 的 mutations，因此这层 filter 变成冗余。

- 方案 B（更显式、更抗未来变更）：在 `diffNodes` 调用处显式传参

```ts
const mutations = diffNodes(baseNodes, desiredNodes, [], { metadataIdMode: "identity" });
```

这样读代码就能一眼看出：`metadata.id` 只做 identity，不是业务数据。

### 仍需保留的逻辑（当前 xnl.ts 还不能替代）

- `ensureMetadataIdsClone` / `copyMissingMetaIds`（`packages/realtime-client/src/index.ts:102` 起）
  - 这些是在编辑器侧保证：
    - 每个 Element 都有 `metadata.id`
    - `metadata.id` 非 string 时归一化为 string
    - 用户输入删除 id 时，从 base tree 把 id “补回去”，避免 id 漂移导致 diff 误判成 delete/add

原因：xnl.ts mutation 侧的 `readMetaId` 目前只识别 `string`（`vendor/xnl.ts/src/mutation/index.ts:487`），因此上层仍需要保证 id 最终落成 string。

---

## 可改造点 2：packages/realtime-server-bun/src/index.ts

### 现状

`sanitizeMutations` 做了两类处理（`packages/realtime-server-bun/src/index.ts:66`）：

1) `OBJECT_DELETE` 且 path 是 `metadata.id`：转成 `OBJECT_UPDATE` 保持原值（`packages/realtime-server-bun/src/index.ts:72`）
2) 同一 parent 下多次 `TREE_DELETE`：按索引降序重排，避免 index shift（`packages/realtime-server-bun/src/index.ts:84`）

### 建议改造

- 删除第 1) 类逻辑（metadata.id delete -> update）
  - 因为 server 最终 apply 用的是 `XNL.mutation.apply`（默认 `metadataIdMode="identity"`），它会直接忽略所有指向 `metadata.id` 的 mutation，不需要事先“转成 no-op update”。
  - 去掉后能减少一段 path 判断（`looksLikeDeleteMetaId`）和一次 parsePath 的调用分支。

- 保留第 2) 类逻辑（TREE_DELETE 重排）
  - 这属于 applyMutations 的通用 index shift 问题，当前 vendor/xnl.ts 里还没有 `normalizeForApply` 之类的能力可替代。

---

## 可改造点 3：packages/realtime-core/src/merge.ts

- `applyIntent` 内部调用 `XNL.mutation.apply(root, mutations)`：`packages/realtime-core/src/merge.ts:669`
- 如果希望“metadata.id 永远只做 identity”这个约束更明显，可以考虑在这里显式传参：

```ts
const next = XNL.mutation.apply(root, mutations, { metadataIdMode: "identity" });
```

（可选；默认已经是 `"identity"`。）

---

## apps/demo 侧观察

- `apps/demo/src/ws-smoke.ts` 里直接调用 `diffNodes(baseNodes, desiredNodes, [])`：`apps/demo/src/ws-smoke.ts:147`
  - 当前默认 `metadataIdMode="identity"` 已经符合「不把 metadata.id 当业务变更发送」的目标；不一定需要改。

- `apps/demo/public/app.js` / `apps/demo/public/peer.js` 中出现的同名函数（ensureMetadataIdsClone 等）是构建产物
  - 建议只改源头：`packages/realtime-client/src/index.ts`，然后重新 build 生成。

---

## 推荐落地顺序（如果后续要真的改代码）

1) realtime-client：删 `isMetaIdObjectMutation` + 删 filter；必要时在 diffNodes 显式传 `{ metadataIdMode: "identity" }`
2) realtime-server-bun：sanitizeMutations 去掉 metadata.id delete 转换逻辑，仅保留 TREE_DELETE 重排
3) （可选）realtime-core：applyIntent 显式传参，增强自解释性

---

## 风险 / 注意事项

- 如果后续有场景需要“同步 / 修改 metadata.id 本身”（把它当业务字段），需要把相关 diff/apply 调用切到 `{ metadataIdMode: "metadata" }`，并评估对 move/selector 稳定性的影响。
- 当前 xnl.ts mutation 侧 `readMetaId` 仍只认 string；如果未来把它扩展到支持 `Word`，realtime-client/realtime-core 里“归一化 metaId 为 string”的逻辑可能还能再进一步收敛。
