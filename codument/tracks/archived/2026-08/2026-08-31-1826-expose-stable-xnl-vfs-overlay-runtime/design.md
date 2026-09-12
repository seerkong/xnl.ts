# Design：XNL VFS overlay materialization runtime

## 上下文

现有原语已经承担单一职责：`serializeVfsSnapshot` 保留完整节点 identity；`diffVfsSnapshots/toXnlMutations` 把文件树差异映射为严格 mutation；`applyRevisionedVfsMutations` 在完整 candidate dry-run 后调用 authority CAS。新 runtime 只组合这些成熟原语，不复制 mutation engine 或 persistence authority。

## 方案概览

```text
RevisionedVfsSnapshot B
  + ordered VfsOverlayIntent[]
      ├─ directory(snapshot): sparse path opinion
      └─ mutations(VfsMutation[]): explicit create/delete/move/rename/content
        │
        ▼
planVfsOverlays(B)
  - validate unique id + contiguous order
  - apply each overlay to isolated working snapshot
  - locate error by overlay/mutation/path
  - diff B -> final candidate
  - translate once to strict XnlMutationBatch
        │
        ▼
materializeRevisionedVfsOverlays(authority, plan)
  -> applyRevisionedVfsMutations
  -> applied | unchanged | conflict | rejected | failed
```

### Directory-shaped overlay

Directory overlay 是一个 full-identity VFS snapshot，但语义是 sparse opinion：

- overlay 中存在、base 不存在的 path：add，沿用 overlay node id；
- 同 path 同 kind：replace 该节点的内容/业务 metadata/attributes/extend，但沿用 base node id 与 path name；folder 继续递归；
- overlay 缺少 path：no opinion，不删除 base；
- 同 path file/folder kind 冲突：reject，禁止隐式 destructive replacement；
- 撤销 replacement 后以相同 Builtin base 重新规划空 overlay，自然恢复 base；
- 删除必须由 explicit `FILE_DELETE/FOLDER_DELETE` 表达。

materializer 先在 clone 上形成 desired snapshot，再用 `diffVfsSnapshots` 生成可审计 VFS mutation；不会直接改 caller base。

### Explicit mutation overlay

显式 overlay 直接承载既有 `VfsMutation[]`。每个 mutation 在 working clone 上按序应用，以便错误能够准确回报 `overlayIndex/mutationIndex`；整个 candidate 未完成前不会调用 authority。`CONTENT_UPDATE.contentMutation` 继续由既有 XNL handler 执行，保留 `#id` 对齐和 `valueBefore` precondition。

### Publication boundary

planner 输出最终 candidate、canonical VFS mutations 与 strict XNL batch。applier 只把 XNL batch交给 `applyRevisionedVfsMutations`：

- planning rejection：authority 未被调用；
- strict dry-run rejection：authority 未被调用；
- stale CAS：返回 conflict，current snapshot 不变；
- persistence failure：返回 failed，current snapshot/revision 不变；
- success/unchanged：返回完整 plan provenance 与现有 truthful receipt。

### Browser-safe public surface

新增 `xnl-vfs/overlay-materialization` subpath，入口只依赖 `xnl-core` 与 `xnl-vfs` browser-safe modules，不引入 `node:fs/path/crypto`。package root 继续保持既有兼容声明，不扩大其 browser-safe 承诺。

## 影响范围与修改点

- `packages/vfs/src/overlay-materialization.ts`
- `packages/vfs/src/index.ts`
- `packages/vfs/package.json`
- `packages/vfs/tsup.config.ts`
- `packages/vfs/tests/overlay-materialization.test.ts`
- `packages/vfs/tests/overlay-materialization-public-entry.test.ts`

## 决策摘要

- directory overlay 以 path 为意见位置，但 node identity 仍由 VFS id 管理。
- absence 与 delete 严格分开；kind mismatch fail closed。
- 复用现有 strict mutation/CAS 链，不创建第二 persistence authority。
- runtime 不包含任何 Eidolon/物理目录/语义资源概念。

## 风险 / 权衡

- sparse snapshot 容易被误解为完整 desired tree → 类型命名、行为测试和 no-opinion case 明确约束。
- sequential apply 后重新 diff 可能归并中间步骤 → plan 同时保留每层 provenance 和最终 canonical batch；审计定位来自 planning diagnostics，发布只关心最终 atomic candidate。
- build subpath 增加发布表面 → public-entry 与 emitted graph scan 固定 browser safety。

## 兼容性设计

- 只新增 API/subpath，不改变现有 snapshot、mutation、authority 与 package-root exports。
- 既有消费者可继续直接使用低层 primitives。

## 迁移计划

1. 添加 planner contract 与 RED tests。
2. 实现 sparse directory apply 与 explicit mutation sequencing。
3. 接入 revisioned coordinator 和 public subpath。
4. 跑 package tests、typecheck、build 与 emitted graph scan。

## 待解决问题

- 物理 directory 到 sparse snapshot 的 adapter 由调用方 owner 实现，不进入本 package。
