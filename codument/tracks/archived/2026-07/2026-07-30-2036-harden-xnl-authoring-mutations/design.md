# XNL Authoring Mutation 设计

## 1. 设计公理

1. `#id` 是树 diff 的 identity key：用于旧树与新树的节点对齐、move 检测和
   mutation target 寻址。
2. `#id` 不是普通 payload：diff 不产生 `#id` update，apply 不提供
   re-identification 快捷路径。
3. `diffNodes` 负责描述结构变化；authoring validation 负责判断某个业务动作
   是否允许删除旧 identity 并创建新 identity。
4. 旧 `applyMutations` 是低层 mutable primitive；新的 batch API 是面向
   authoring owner 的保守事务边界。

## 2. API 形态

新增名称最终以实现期类型检查为准，但职责固定为：

```ts
type XnlMutationDiagnosticCode =
  | "DUPLICATE_IDENTITY"
  | "MISSING_IDENTITY"
  | "IDENTITY_MUTATION_FORBIDDEN"
  | "PRECONDITION_FAILED"
  | "APPLY_FAILED"
  | "RESULT_IDENTITY_INVALID";

interface XnlMutationBatchOptions extends XnlMutationOptions {
  verifyValueBefore?: boolean;
  identityPolicy?: "allow-missing" | "require-elements";
}

type XnlMutationBatchResult =
  | {
      status: "applied";
      value: XnlNode;
      mutations: readonly XnlMutation[];
      diagnostics: readonly [];
    }
  | {
      status: "rejected";
      value: XnlNode;
      mutations: readonly XnlMutation[];
      diagnostics: readonly XnlMutationDiagnostic[];
    };

function dryRunMutations(
  base: XnlNode,
  mutations: readonly XnlMutation[],
  options?: XnlMutationBatchOptions,
): XnlMutationBatchResult;
```

硬约束：

- `base` 与输入 `mutations` 不得被修改。
- rejected result 的 `value` 是未修改的 base clone，不是部分 apply。
- diagnostics 至少包含 code、message，并在可定位时包含 mutation index、
  path 与 identity。
- `verifyValueBefore` 开启时，delete/update/move 的 observable target 必须与
  mutation 的 `valueBefore` 一致；缺失 `valueBefore` 不伪造检查。
- strict batch 在 apply 前检查 mutation target；任何直接指向 element `id`
  字段的 add/update/delete mutation 都以 `IDENTITY_MUTATION_FORBIDDEN`
  拒绝。Legacy `applyMutations` 保持既有兼容行为。
- `identityPolicy` 默认 `allow-missing`，不破坏通用 XNL；文档 authoring 可以
  选择 `require-elements`。

可以额外导出 `validateXnlIdentities` 和 clone helper，但不得让上层重组出与
`dryRunMutations` 不同的 apply 语义。

## 3. Identity 校验

- uniqueness 范围是传入 XNL root 的整棵可达树。
- Domain `#id` 优先于 legacy `metadata.id`，与现有 identity mode 保持一致。
- 同一 identity 出现两次必须产生 `DUPLICATE_IDENTITY`。
- `require-elements` 下，DataElement/TextElement 缺少 identity 产生
  `MISSING_IDENTITY`。
- validation 不比较旧/new `#id` 值，也不产生 `#id` mutation。
- strict batch 不接受手工构造的 element `id` 字段 mutation。
- identity 变化只能表达为旧节点 delete 与新节点 add；authoring 层仍应基于
  Domain Command 和 candidate policy 判断该结构替换是否允许。

## 4. Tag 与 kind

- 相同 element kind、相同 identity 的 tag 变化是节点语义字段变化，diff
  生成可 apply 的 tag update。
- DataElement 与 TextElement 的 kind 变化仍是结构 replacement，不伪装为
  tag update；若当前 diff 入口无法无歧义表达，应返回明确错误并由上层形成
  delete/add。

## 5. 原子预演

```text
validate(base identities)
  -> clone(base)
  -> for each mutation
       reject direct element-id field mutation
       verify valueBefore when requested
       apply with existing mutation engine
  -> validate(result identities)
  -> applied(result) | rejected(base clone, diagnostics)
```

任何异常都转换为结构化 rejection。旧 mutable API 不因新增事务边界而静默
改变异常或容错行为。

## 6. Parity

测试至少覆盖：

- 同层 reorder；
- 跨父节点 move；
- 三节点轮转；
- move 与 add/delete/update 混合；
- tag update；
- duplicate identity rejection；
- stale `valueBefore` rejection；
- direct element `id` mutation rejection；
- failed batch 不修改 base；
- parse -> diff -> dry-run -> format/AST equality。

Parity 断言比较完整 AST；不能只断言返回数组或 mutation type 存在。

## 7. 兼容与风险

- Existing `applyMutations` 保持 mutable，以免隐式改变已发布行为。
- 新 API 的 readonly 输入在 runtime 仍需防御调用方传入可变对象。
- 不能用 JSON stringify 作为领域相等性真源；可以复用 AST deep equality，
  clone 需保留 Word、Comment、Extend 等结构。
- move apply 的 path/index 会受前序 mutation 影响，测试必须覆盖批内顺序。
- strict identity policy 是 opt-in，不能让合法的无 `#id` 通用 XNL 失效。

## 8. 验收边界

完成后，dg-cell-mvi 可以把 dry-run result 作为 authoring ValueHost 接受前的
mutation engine 端口；它仍需自行拥有 Domain Command、candidate validation、
session revision 与 persistence policy。
