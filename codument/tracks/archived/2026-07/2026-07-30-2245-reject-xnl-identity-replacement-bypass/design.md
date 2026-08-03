# Strict Identity Skeleton 设计

## 上下文

direct path guard 只能识别 element `:id` 这类 mutation target，无法看见
`valueAfter` 深处携带的新 identity，也尚未闭合直接修改 metadata fallback id
的语义。例如：

```ts
{
  type: "TREE_UPDATE",
  path: "#root:body::0",
  valueAfter: <Item #new>
}
```

现有 strict dry-run 会接受它，即使 target 原来是 `<Item #old>`。

## 方案概览

### 1. full-tree update identity skeleton

对 `TREE_UPDATE` 与 `OBJECT_UPDATE`，在 apply 前后分别从 working root 递归
收集：

```ts
type IdentityAuthority = "explicit-id" | "metadata-fallback"

interface IdentityDescriptor {
  readonly authority: IdentityAuthority
  readonly value: string
}

type IdentitySkeleton =
  ReadonlyMap<OrderedSemanticStructuralPath, IdentityDescriptor>
```

- ordered semantic structural path 从 root 开始，包含 object key、array index、
  element metadata/attributes/body，以及 Extend `order[index] -> child(tag)` 的
  有序位置；不能只遍历 `extend.children[tag]`，否则看不见 Extend 重排。
- identity value 延续现有规则：element `#id` 优先，metadata id 仅作为当前
  compatibility fallback。
- descriptor 同时记录 raw authority source。显式 `#id` 被删除后退回同值
  metadata id，或从 metadata fallback 切到同值 `#id`，仍属于 identity
  authority mutation，strict update 必须拒绝。
- 有 identity 的 DataElement/TextElement 进入 skeleton。
- 无 identity element 在 `allow-missing` 下不进入；`require-elements` 仍由
  既有 identity validation 拒绝。

全树 skeleton 前后必须完全相同。否则返回
`IDENTITY_MUTATION_FORBIDDEN`，并丢弃 working candidate。

使用全树而不是 target subtree，是因为 mutation target 可能只是
`#node:metadata` map；map 本身没有 identity，但它决定父 element 的 metadata
fallback identity。

这个 invariant 会拒绝：

- whole-node `#old -> #new`
- 更新 body/array 时新增或移除 identified element
- 用 container update 交换两个 identity
- 用 update 隐藏 element move
- 直接更新 `extend.order` 隐藏 identified child reorder
- 替换 metadata map 时改变父 element fallback identity
- 在 explicit `#id` 与 metadata fallback 之间切换 identity authority

它允许：

- 同 identity whole-node payload update
- tag、metadata、attributes、text 与 non-element collection update
- 没有 identity 的普通值更新
- element 保留相同 explicit `#id` 时修改不生效于 effective identity 的
  metadata compatibility 字段

这里的 descriptor 比较是 strict mutation continuity guard，不会成为
`diffNodes` 的普通 payload 比较。`#id` 仍只承担 alignment/move identity，
不会生成 `:id` update。

direct metadata fallback path 的规则也必须显式：

- element 没有 explicit `#id`、`metadata.id` 正在承担 effective identity 时，
  strict identity mode 对该 map key 的 add/update/delete 返回
  `IDENTITY_MUTATION_FORBIDDEN`。
- element 已有 explicit `#id` 时，metadata id 不是 authority；identity mode
  保留现有 compatibility no-op，不把 metadata id 提升为 ordinary diff
  payload。
- legacy `applyMutations` 与显式 metadata mode 保留现有行为边界。

### 2. structural destination guard

`TREE_ADD`/`OBJECT_ADD` 和 move mutation 不应用 update skeleton invariant，
因为合法结构操作本来就会改变 identity path。但 strict entry 在 apply 前检查
destination：

- 普通 array `ListIndex` 使用 insert 语义，保持可用。
- Extend `ListIndex` 不是普通数组插入：它同时写
  `order[index]` 与 `children[value.tag]`。collision guard 只检查
  `children[value.tag]` 的 keyed occupant：该 key 为空，或其 occupant 就是
  当前 move source child 时可用；不得覆盖同 tag 的另一 identified child。
  `order[index]` 当前用于让位的兄弟只是插入位置，不是 assignment occupant，
  不能据此拒绝合法 reorder。
- assignment-style `InstanceProperty`/`MapKey`/extend child 目标为空时可用。
- assignment-style destination 已存在且其 subtree 含 identified element 时，
  返回 `IDENTITY_MUTATION_FORBIDDEN`，不得静默覆盖。
- move 先在 source 仍存在时检查 destination，防止 extract 后通过 add 覆盖另一
  identity。
- 同一 Extend 内的 reorder 是例外但不是 replacement：
  `children[value.tag]` occupant 与 move source 是同一 child，且操作只改变
  `order` 时允许；目标 index 原本存在另一个兄弟不构成 collision。

`TREE_DELETE`/`OBJECT_DELETE` 继续由：

- batch 顺序与 precondition
- duplicate/missing identity policy
- apply semantics
- final result identity validation

约束。

因此 identity replacement 的合法表达是 old-node delete 后 new-node add；
节点位置变化使用 move。strict batch 仍可一次原子提交这些显式结构 mutation。

### 3. Extend reorder diff

`diffExtend` 不能继续把 `oldOrder !== newOrder` 表达成：

```ts
TREE_UPDATE "#parent:extend:order"
```

这会与顺序敏感 skeleton 冲突，也把结构变化伪装成容器 payload update。

新的 diff 顺序：

1. 先按 child identity/tag 计算 add/delete/cross-parent move 与 child payload
   update。
2. 在剩余共同 child 上，以工作副本模拟 `oldOrder -> newOrder`。
3. 每当目标 index 的 child 不在该位置，发出 `TREE_MOVE_SAME_LEVEL`。有
   identity 的 child 带稳定 `targetUniqueName` 与 `pathBefore`；无 identity
   child 必须带当前工作顺序下的 `pathBefore`。两者都使用目标 Extend index
   path，并在模拟应用后更新工作顺序。
4. `diffNodes` 对任何 Extend reorder 都不得生成
   `TREE_UPDATE ...:extend:order`；`allow-missing` 只改变 identity 完整性要求，
   不把 Extend 结构降级成 payload update。
5. 结果必须满足
   `dryRunMutations(base, diffNodes(base, target)).value === target`。

这不是让 `#id` 参与字段比较，而是继续用 `#id` 对齐同一个 child，并把位置变化
表达成 move。

### 4. Extend retag coherence

Extend 同时维护：

```ts
extend.order[index] === childTag
extend.children[childTag] === child
child.tag === childTag
```

因此同 identity Extend child 的 retag 不能只发 `TREE_UPDATE #id:tag`。diff 必须
把它表达为：

1. 生成带 `destinationKey: newTag` 的 move，从旧
   `children[oldTag]`/order 位置移动到目标 index 下的新
   `children[newTag]`。
2. 在同一 ordered batch 中更新 child tag 与其他 payload。
3. strict batch 在最终 candidate 上验证 Extend coherence：order 无重复、order
   与 children key 集合一致、每个 `children[key].tag === key`。

公共 mutation contract 增加可选结构字段：

```ts
interface XnlMutation {
  // Existing fields...
  destinationKey?: string
}
```

- 它只对 Extend destination 生效，不是 node payload。
- move apply 先 extract source，再以
  `destinationKey ?? moved.tag` 作为 `children` key，并把该 key 插入目标
  Extend index；不能仅从 moved object 的旧 tag 推导 key。
- destination collision guard 也检查这个 resolved key。
- diff 的 move 仍可携带 `valueAfter` 做审计/precondition，但 move apply 不以
  `valueAfter` 偷换 source identity；后续 update 显式完成 payload 变化。
- 无 identity child 无法在 retag 前后可靠对齐，因此 missing-id retag 使用
  delete+add；missing-id 同 tag reorder 仍使用 pathBefore move。

中间 working value 可以在 move 与 tag update 之间短暂不一致，因此 coherence
是 batch-final invariant，不是逐 mutation gate。直接 standalone retag 若没有
key migration，会以 `RESULT_STRUCTURE_INVALID` 拒绝；legacy apply 继续保留
原行为。identity skeleton 差异继续使用 `IDENTITY_MUTATION_FORBIDDEN`，不把
两类错误混成同一诊断。

必须覆盖 retag 与 reorder 同时发生的两个方向：

- old index 1 -> new tag at index 0
- old index 0 -> new tag at index 1

两者的 diff 都只能包含 structural move + ordinary non-id payload update，
strict apply 后必须与 target 完全相等。

### 5. transaction ordering

每个 mutation 的顺序：

```text
parse and direct-id guard
  -> valueBefore precondition
  -> capture ordered full-tree identity skeleton for update
  -> validate structural destination for add/move
  -> apply mutation to working clone
  -> compare post-update ordered full-tree skeleton
  -> validate working identities
  -> continue or reject whole batch
```

任何 hidden identity violation 都返回原始 base clone，不暴露部分 apply。

### 6. compatibility

- `applyMutations` 不变；相同 bypass mutation 在 legacy entry 仍沿用旧行为。
- `diffNodes` 不比较或更新 `#id`；Extend reorder 也使用 identity alignment
  或 pathBefore 生成 move。
- 新限制只在显式 `dryRunMutations` strict entry 生效。
- diagnostic code 沿用 `IDENTITY_MUTATION_FORBIDDEN`，避免新增同义错误码。

## 风险 / 权衡

- whole-container update 过去可隐式重排 identified children；strict entry 现在
  要求显式 move。这个收紧是有意行为，能保留审计与 precondition 语义。
- explicit `#id` 与 metadata fallback 的同值切换过去看似“effective identity
  未变”，但 authority 已变化；strict update 将其视为 identity mutation。
- assignment-style add 过去可覆盖 occupied identified destination；strict entry
  现在要求先 delete。普通 legacy apply 不变。
- 递归 skeleton 有额外成本。它只对 update mutation 执行，且 authoring strict
  correctness 优先于微小常数开销。

## 待解决问题

- 无。
