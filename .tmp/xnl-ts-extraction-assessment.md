# xnl.ts 可沉淀能力评估（基于 braid-demo packages 实现）

本文总结了当前项目 `packages/` 中哪些能力更适合进一步沉淀到 `xnl.ts`（更准确地说：沉淀到 `vendor/xnl.ts` 的通用库层），以及哪些不建议上移。

## 结论概览

优先建议沉淀的是“纯 XNL / mutation 语义层”的能力：
- `metadata.id`（稳定标识）相关工具（ensure/read/copy/clone）
- mutation 归一化（normalize）与安全 apply（避免 index shift / selector 失效）
- 对 `metadata.id` 变更的官方过滤/忽略入口

不建议沉淀的是与协同协议/版本图/业务规则强绑定的能力：
- 三方 merge 策略、winner 规则、版本图、rootTag lock、WS 协议与持久化

---

## 适合沉淀到 xnl.ts 的部分

### 1) `metadata.id`（稳定标识）相关工具

#### 背景与动机

在 `xnl.ts` 的 mutation 系统中，`metadata.id` 已经被当成“稳定定位”的重要手段：
- diff 时会优先用 `MetadataSelector {id="..."}` 生成更稳的 path
- move 相关 mutation 也会依赖 `targetUniqueName / parentUniqueName*`（通常就是 `metadata.id`）

因此，“保证 `metadata.id` 的存在与稳定性”更像是 XNL/mutation 的通用约束，而不应由上层应用在不同位置重复实现。

#### 现状（项目内重复点）

当前 `packages/` 中有多处重复实现/策略：
- 确保节点拥有 `metadata.id`，并将非 string 的 id 规范化为 string
- clone + ensure 的实现（为了避免修改原对象，或为了保证 canonical 形态）
- 读取 id 时兼容 `string | word`（上层实现了更宽松的读取逻辑）

而 `vendor/xnl.ts` 内部（mutation/index.ts）目前的 `readMetaId` 只识别 string（并且是私有函数），导致上层不得不自己做兼容。

#### 建议沉淀形态（API 方向）

可以在 `xnl.ts` 中提供一组官方入口（仅为建议形态）：
- `XNL.R.id.ensure(rootOrDoc, { key?: "id", gen?: () => string })`
- `XNL.R.id.ensureClone(nodesOrDoc, opts)`（返回新对象，避免原地修改）
- `XNL.R.id.read(node): string | undefined`（兼容 string/word，并可做规范化）
- `XNL.R.id.copyMissing(before, after)`：将“已有稳定 id”补到新树上

> 目标：消除 packages 中重复的 ensure/copy/read 逻辑，让 mutation diff/apply 的前置条件在库层可一键满足。

---

### 2) mutation 归一化/安全 apply（`normalizeForApply`）

#### 背景与动机

`applyMutations` 当前是顺序逐条 apply。实际 diff 生成的 mutation 序列存在一些“顺序敏感”的场景：
- 同一数组多次 `TREE_DELETE`：按升序删会产生 index shift
- `metadata.id` 被删除/覆盖：后续基于 `MetadataSelector` 的 path 会失效，导致 apply 失败

这些问题是 mutation 语义层面的通用问题（不属于 realtime 协议）。

#### 现状（项目内实现）

目前在 server 侧（packages/realtime-server-bun）存在一段 mutation sanitize/归一化逻辑，包含：
- `TREE_DELETE` 按 parentPath 分组、对同父节点的 ListIndex delete 做降序处理
- 对 `metadata.id` 的 delete 做保护性处理（将 delete 转换为“保持原值”的 update）

这类能力建议迁移到 `xnl.ts` 统一提供。

#### 建议沉淀形态（API 方向）

- `XNL.mutation.normalizeForApply(mutations, opts?) => XnlMutation[]`
  - `TREE_DELETE`：同 parent 分组后按索引降序
  - `metadata.id`：删除/覆盖归一化为 no-op 或保持原值的 update；或延迟到最后执行

> 目标：让 `XNL.mutation.apply(root, XNL.mutation.diff(root, next))` 在更大范围内“自洽可用”。

---

### 3) 过滤/忽略 `metadata.id` 变更的官方入口

#### 背景与动机

很多场景会把 `metadata.id` 当作内部稳定键，不希望 diff 把它当成业务变更传输/持久化。

当前项目中 client 侧通过手写 `isMetaIdObjectMutation` + filter 来实现，这个需求很通用。

#### 建议沉淀形态（API 方向）

- `XNL.mutation.isMetadataKeyMutation(m, { objectPath: ["metadata", "id"] })`
- `XNL.mutation.filter(mutations, { ignoreMetadataId: true })`
- 或更强：`diffNodes(old, next, { ignoreKeys: { metadata: ["id"] } })`

> 如果希望保持向后兼容，可先以“后处理 filter”的方式落地；若可接受 API 演进，再考虑把 ignore 变成 diff 的一等参数。

---

## 不建议沉淀到 xnl.ts 的部分

这些更像是协同编辑 demo 的应用层语义/策略，不属于 XNL 文本/树/路径/mutation 的通用能力：
- realtime 的协议/版本图：LCA、merge graph、ws message、持久化
- 业务规则：single-root 规则、rootTag lock、以及相关的校验/错误恢复策略
- 三方 merge 的 winner 决策与冲突策略（这是应用层语义，可能因产品变化而变化）

---

## 建议的落地优先级（若要做“沉淀”工程）

1. `XNL.mutation.normalizeForApply`（提升 diff+apply 的自洽性，价值最大）
2. `XNL.R.id.*`（消除项目内重复逻辑，让 id 稳定性成为库层能力）
3. `diffNodes` 的 ignore/filter 能力（减少上层手写过滤器）

---

## 风险与边界

- 如果选择“增强 diff/apply 自洽性”，可能会改变少量边界行为（例如对 `metadata.id` delete 的处理）。建议以 opt-in 或新增 API 的方式逐步引入。
- 若只想“加 helper，不改现有行为”，则优先添加 `XNL.R.id.*` 与 `XNL.mutation.filter/normalize`（作为可选步骤），保持默认路径不变。
