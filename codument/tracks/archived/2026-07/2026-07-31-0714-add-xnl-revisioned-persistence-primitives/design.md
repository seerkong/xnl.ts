# Revision-aware Persistence 设计

## 上下文

当前系统已经有三种不同事实，不应合并成一个“版本号”：

1. **Domain/VFS snapshot**：当前编辑内容。
2. **Live revision**：某个 persistence authority 对 snapshot 的并发写入代次。
3. **VCS commit id**：一次显式历史 checkpoint 的内容寻址 identity。

`applyVfsMutationsAtomically` 能保证 candidate 构造失败时不修改 base，但并不
负责持久化；`saveSnapshot` 返回 `void`，也没有 expected revision。另一方面，
`Repository.commit()` 返回 commit id，但 commit id 不能证明调用方基于最新
live snapshot，也不应被 halfcode authoring session 当作 CAS token。

## 方案概览

### 1. VFS authority contract

```ts
type Awaitable<T> = T | PromiseLike<T>

interface RevisionedPersistenceDiagnostic {
  readonly code: string
  readonly message: string
  readonly cause?: unknown
}

interface VfsRevision {
  readonly authorityId: string
  readonly value: string
}

interface RevisionedVfsSnapshot {
  revision: VfsRevision
  snapshot: DataElementNode
}

interface RevisionedVfsFlushInput {
  expectedRevision: VfsRevision
  snapshot: DataElementNode
}

interface RevisionedVfsReceipt {
  previousRevision: VfsRevision
  revision: VfsRevision
  persistedAt: string
  durability: "memory" | "workspace"
}

interface RevisionedVfsAuthority {
  read(): Awaitable<RevisionedVfsSnapshot>
  compareAndSwap(
    input: RevisionedVfsFlushInput
  ): Awaitable<
    | { status: "applied"; receipt: RevisionedVfsReceipt }
    | { status: "unchanged"; revision: VfsRevision }
    | { status: "conflict"; actualRevision: VfsRevision }
    | {
        status: "failed"
        actualRevision: VfsRevision
        diagnostics: readonly RevisionedPersistenceDiagnostic[]
      }
  >
}
```

约束：

- revision 是 authority-qualified opaque equality token。调用方同时比较
  `authorityId` 与 opaque `value`，不能排序或解析 value。
- CAS 的检查与持久化由 authority 自己完成；coordinator 不以
  `read -> unchecked save` 模拟 CAS。
- semantic no-op 也必须进入 `compareAndSwap`：authority 先在线性化点校验
  expected revision，再对完整 AST 做 identity-sensitive structural equality；
  当前 no-op 返回
  `unchanged`，stale no-op 返回 `conflict`。
- snapshot equality 不复用 `diffNodes`。后者会读取 `#id`，将其作为节点对齐与
  move 检测的 identity；它不会把 `#id` 当普通 payload 字段生成 update，因此
  不能用“没有普通字段 mutation”替代完整 AST 相等判断。新的
  `areXnlSnapshotsStructurallyEqual` 递归比较所有 AST 字段：
  object key 顺序无关，array/body/Extend order 顺序相关，并比较显式 `id`、
  metadata、attributes、tag、kind 与文本字段。
- 根或子节点的显式 `#id` 变化、metadata fallback identity 变化，以及显式
  `#id` 与同值 fallback 之间的 authority transition 都不是 no-op。
- `failed` 表示 authority revision 与 snapshot 都没有推进。
- cross-authority revision 必须 conflict；不能仅因两个 authority 的 value 都是
  `revision:0` 而接受。
- `receipt.revision` 是 live revision，不允许出现 `commitId` 字段。
- adapter 可以同步或异步；公共 API 统一接受 `Awaitable`。

### 2. Mutation coordinator

```ts
interface ApplyRevisionedVfsMutationsInput {
  readonly base: RevisionedVfsSnapshot
  readonly mutations: XnlMutationBatch
  readonly mutationOptions?: Omit<
    XnlMutationBatchOptions,
    "metadataIdMode"
  >
}

type ApplyRevisionedVfsMutationsResult =
  | {
      status: "applied"
      snapshot: DataElementNode
      receipt: RevisionedVfsReceipt
    }
  | {
      status: "unchanged"
      snapshot: DataElementNode
      revision: VfsRevision
    }
  | {
      status: "conflict"
      actualRevision: VfsRevision
    }
  | {
      status: "rejected"
      base: RevisionedVfsSnapshot
      diagnostics: readonly XnlMutationDiagnostic[]
    }
  | {
      status: "failed"
      actualRevision: VfsRevision
      diagnostics: readonly RevisionedPersistenceDiagnostic[]
    }

result = await applyRevisionedVfsMutations(authority, input)
```

单向链路：

```text
base snapshot + expected revision
  -> clone-based mutation dry-run
  -> reject invalid candidate without authority write
  -> authority.compareAndSwap(expectedRevision, candidate)
  -> authority checks scope + freshness at one linearization point
  -> authority detects complete-AST semantic no-op
  -> applied receipt / unchanged / conflict / failed
```

统一结果：

- `applied`：返回完整 candidate clone 与 receipt。
- `unchanged`：authority 确认 expected revision 仍是 current 且 candidate
  与 persisted snapshot 语义等价；不推进 revision。
- `conflict`：expected revision 已过期；返回 actual revision，不暴露伪成功。
- `rejected`：mutation/precondition/identity 校验失败；base 与 authority 不变。
- `failed`：authority flush 失败；返回 diagnostics，authority 必须保持旧 revision。

browser-safe coordinator 只接受 `XnlMutationBatch` 和
不含 `metadataIdMode` 的 `XnlMutationBatchOptions` 子集，通过
`xnl-core.dryRunMutations` strict dry-run。coordinator 在运行时最后覆盖
`metadataIdMode: "identity"`，调用方不能只靠类型逃逸切回 `"metadata"`；
`identityPolicy` 仍由调用方显式选择。
因此直接 add/update/delete element `#id` 会在 authority 写入前 rejected；
直接 add/update/delete 当前承担 effective identity 的 metadata fallback id
同样 rejected，identity replacement 只允许 delete+add。通用场景默认允许
missing identity，authoring consumer 可显式选 `require-elements`。VFS domain mutation 可通过
未来独立、非 browser-safe candidate compiler adapter 接入，但不属于本 Track；
它必须先转换成 `XnlMutationBatch` 再进入同一 strict coordinator，不能直接复用
legacy `applyMutations` 绕过 strict authoring policy。

该能力依赖 `reject-xnl-identity-replacement-bypass` 已完成：whole-node、
container 与 Extend order update 也不能绕过 identity continuity；`#id` 仍只做
alignment/move identity，不作为 ordinary diff payload。

### 3. Memory reference authority

`MemoryRevisionedVfsAuthority` 是确定性的 reference implementation：

- 初始 revision 由 authority 生成，默认 `revision:0`。
- 每次成功 CAS 生成新 opaque token。
- stale expected revision 返回 conflict。
- 支持注入 next-flush failure，用于证明失败不推进和 retry。
- 并发请求通过 authority 内部串行化在线性化点裁决；同一 expected revision 的
  两个异步 replace 必须恰好一个 applied、一个 conflict。
- cross-authority revision 在 freshness 检查阶段 conflict。
- stale/cross-authority 优先于 failure injection，且不消费注入失败；current
  no-op 也不消费只针对 replace 的失败。
- clock 与 revision factory 可注入，保证测试确定性。
- 所有 read/result snapshot 都是 clone，authority 不泄露可变引用。
- no-op 与 read-back verification 统一使用
  `areXnlSnapshotsStructurallyEqual`，不会把 diff 的 identity 对齐语义误当成
  完整 AST 相等语义。

它适用于测试、内存 demo 与自定义 adapter 的协议示例，不冒充磁盘持久化。

### 4. Lossless VCS snapshot tree codec

现有 `buildTree/readTreeSnapshot` 是面向文件历史的 legacy projection：它会把
metadata/attributes 业务字段合并，并不保存 element 显式 `#id`。因此它不能
作为 exact authority snapshot 的 checkpoint codec。

本 Track 增加版本化的 `xnl-vfs-v2` tree encoding：

- root `TreeObject` 保留 legacy entries/index projection，同时携带一个带版本
  marker 的完整 lossless snapshot payload；payload 使用 JSON-safe 的 tagged
  AST encoding 显式记录 own-key presence 与 `undefined`，不直接把 raw AST
  交给会删除 `undefined` 的 JSON/ObjectStore canonicalization，也不从 legacy
  entries 反推；
- payload 保留显式 `id`、metadata、attributes、任意 body XNL nodes、tag、
  kind、TextElement 的 text/textMarker、Comment、Word、字段存在性（包括
  present-with-undefined）和 Extend；
  object key 顺序不构成语义，但 array/body/Extend order 构成语义；
- v2 reader 必须用 identity-sensitive structural equality 通过
  `snapshot -> tree -> snapshot` round-trip；
- 没有 v2 marker 的旧 `TreeObject` 继续走现有 legacy reader；
- `captureRepositorySnapshot`、node/string snapshot serializer/deserializer 与
  `restoreRepositoryFromSnapshot` 必须逐字保留 v2 marker/payload，使 object id
  在 RepositorySnapshot round-trip 后仍通过 hash 校验；
- 既有 `Repository.commit()` 与 legacy `buildTree()` 保持行为，新
  `commitSnapshot()` 使用 v2 codec，因此新 checkpoint 的 object/commit id
  可以不同，但旧对象仍可读取。

round-trip characterization 覆盖根和子节点显式 `#id`、metadata/attributes
同名键、字段缺省与空值、DataElement/TextElement/Comment/Word/primitive/
array/object、text/textMarker、folder/body 顺序、Extend order/children、
legacy tree object read fallback，以及 RepositorySnapshot node/string
round-trip 后的 exact checkout。

### 5. Repository exact-snapshot primitive

```ts
type CommitSnapshotHistoryState =
  | "not-started"
  | "possibly-accepted"
  | "accepted"

type RepositoryCommitSnapshotResult =
  | {
      status: "committed"
      commitId: ObjectId
      headBefore: ObjectId | null
      observedHead: ObjectId | null
      historyState: "accepted"
      worktreeState: "restored"
    }
  | {
      status: "failed"
      phase: "stage" | "pre-commit"
      headBefore: ObjectId | null
      observedHead: ObjectId | null
      historyState: "not-started"
      worktreeState: "restored"
      diagnostics: readonly RevisionedPersistenceDiagnostic[]
    }
  | {
      status: "indeterminate"
      phase: "commit" | "restore"
      headBefore: ObjectId | null
      observedHead: ObjectId | null
      candidateCommitId?: ObjectId
      historyState: CommitSnapshotHistoryState
      worktreeState: "restored" | "unknown"
      diagnostics: readonly RevisionedPersistenceDiagnostic[]
    }
```

`Repository.commitSnapshot(snapshot, message, options)` clone public worktree，
临时装入 exact authority snapshot，使用 v2 codec 创建 commit，并在 `finally`
恢复 public worktree 与 backend workspace state。它返回封闭 outcome，而不是
只返回 `ObjectId | throw`，使 adapter 不必从异常猜测 commit 是否可能已接受。
若 restore 失败，无论此前在哪个阶段失败，都返回 `phase="restore"` 的
`indeterminate`。

`RepositoryBackend` 可选增加与实例绑定的 `flush(): Awaitable<void>`
capability；Repository 只在 active `store === backend.objectStore` 且 active
`contentStore === backend.contentStore` 时代理该 backend flush，此时 backend
也拥有 ref/workspace ports。若构造 Repository 时覆盖任一 store，则没有完整
binding proof，只能报告 `memory-accepted`。任意外部 flush function 不能证明
它持久化了该 Repository 的 object/content/ref/workspace，不能用于 durability
receipt。

### 6. VCS repository adapter

```ts
interface RepositoryCheckpointReceipt {
  liveRevision: VfsRevision
  commitId: ObjectId
  durability: "memory-accepted" | "backend-flushed"
}

type RepositoryCheckpointResult =
  | {
      status: "checkpointed"
      receipt: RepositoryCheckpointReceipt
    }
  | {
      status: "conflict"
      expectedRevision: VfsRevision
      actualRevision: VfsRevision
    }
  | {
      status: "failed"
      phase: "read" | "pre-commit"
      historyState: "not-started"
      diagnostics: readonly RevisionedPersistenceDiagnostic[]
      headBefore: ObjectId | null
      observedHead: ObjectId | null
      worktreeState: "restored"
    }
  | {
      status: "indeterminate"
      phase: "commit" | "post-commit-verify" | "flush" | "restore"
      liveRevision: VfsRevision
      headBefore: ObjectId | null
      observedHead: ObjectId | null
      candidateCommitId?: ObjectId
      historyState:
        | "not-started"
        | "possibly-accepted"
        | "accepted"
      worktreeState: "restored" | "unknown"
      diagnostics: readonly RevisionedPersistenceDiagnostic[]
    }
```

`RevisionedRepositoryAdapter` 组合 `Repository` 与
`RevisionedVfsAuthority`：

1. `open()` 从 authority 读取 snapshot 并装入 repository worktree。
2. `apply()` 复用 VFS coordinator；只有 `applied` 才更新 worktree。
3. `checkpoint(expectedLiveRevision, message, author)` 从 authority 做一次
   revision+snapshot read；匹配后通过
   `Repository.commitSnapshot(snapshot, ...)` 的封闭 outcome 提交 v2 exact
   snapshot。checkpoint 后回读 commit tree，并用 identity-sensitive structural
   equality 与 authority snapshot 比较；调用前的 out-of-band worktree mutation
   不会混入 commit，也不会因 checkpoint 被永久覆盖。
4. checkpoint receipt 同时给出 `liveRevision` 与 `commitId`，但两者不可互换。
5. 若 Repository 自身 backend 暴露并成功完成 `flush()`，且 active
   object/content stores 与该 backend ports 通过引用相等证明绑定，receipt
   durability 才能是 `backend-flushed`；没有 capability 或存在 store override
   时只能声明 `memory-accepted`。

VCS checkpoint 失败不回滚已经成功的 VFS flush。由于既有 Repository 可能在
backend error 前已推进内存 branch，结果边界为：

- `conflict`：authority read 明确看到 stale/cross-authority revision；commit
  未开始。
- `failed`：read 或 pre-commit preparation 失败，并且 adapter 能证明 commit
  尚未被接受；public worktree 已恢复，携带
  `historyState="not-started"` 与可观察的 head before/after。
- `checkpointed`：commit tree 验证通过；Repository backend 没有 flush
  capability 时只声明 `memory-accepted`，其自身 backend flush 成功后才声明
  `backend-flushed`。
- `indeterminate`：commit 调用、restore、post-commit tree verification 或
  flush 失败且无法证明完整成功；携带 `historyState`、`headBefore`、
  `observedHead`、可得时的 `candidateCommitId` 和真实 `worktreeState`，不得
  虚构 history 回滚。pre-commit error 后 restore 又失败也归入该分支。

public worktree 与 VCS history 分开判断：checkpoint 的临时 staging 必须
try/finally 恢复；如果恢复本身失败，则结果只能是 `indeterminate` 且
`worktreeState="unknown"`。history 是否推进仍由 head/commit evidence 决定。

调用方始终保留真实 persisted revision，不得把 checkpoint failure 伪装成 VFS
apply failure，也不得谎称 history 必然未推进。

### 7. 兼容与扩展

- 既有 `VirtualFileSystem`、`applyVfsMutationsAtomically`、
  `LocalFsVfsPersistence`、`IndexedDbVfsPersistence` 与 `Repository.commit`
  保持签名。
- 新协议通过显式 exports 引入，不偷偷改变旧 API 的返回形状。
- local filesystem、IndexedDB、数据库或远端服务以后通过实现
  `RevisionedVfsAuthority` 接入；只有能原子实现 CAS 的 adapter 才能宣称
  `durability="workspace"`。
- 新 contract/reference authority 使用
  `xnl-vfs/revisioned-persistence` 独立 browser-safe subpath。既有
  `xnl-vfs`/`xnl-vcs` package root 已含 Node-only 依赖，本 Track 不扩大范围
  修复该历史基线，也不对 root 作 browser-safe 声明。
- repository adapter 使用 `xnl-vcs/revisioned-repository` 显式 subpath；
  它的 runtime compatibility 与现有 Repository 相同。
- browser-safe 验证扫描构建后的
  `dist/revisioned-persistence.{js,cjs}` 及其传递 import graph，而不是只扫描
  source 文件名；递归解析 chunks 与 bare package imports，不得经 root barrel
  或 path utility 引入 `fs/path/crypto` 及其 `node:` 形式。

## 影响范围与修改点（Impact）

- `packages/vfs/src/revisioned-persistence.ts`
- `packages/vfs/src/index.ts`
- `packages/vfs/package.json`
- `packages/vfs/tsup.config.ts`
- `packages/vfs/tests/revisioned-persistence.test.ts`
- `packages/vcs/src/revisioned-repository.ts`
- `packages/vcs/src/lossless-tree.ts`
- `packages/vcs/src/index.ts`
- `packages/vcs/src/types.ts`
- `packages/vcs/src/tree-converter.ts`
- `packages/vcs/src/xnl-snapshot.ts`
- `packages/vcs/src/repository-backend.ts`
- `packages/vcs/src/repository.ts`
- `packages/vcs/package.json`
- `packages/vcs/tsup.config.ts`
- `packages/vcs/tests/lossless-tree.test.ts`
- `packages/vcs/tests/xnl-snapshot.test.ts`
- `packages/vcs/tests/revisioned-repository.test.ts`
- `packages/vfs/docs/api.md`
- `packages/vcs/docs/api.md`
- package build outputs

## 决策摘要

- `VfsRevision` 是 opaque live revision，不是 commit id 或内容 hash。
- CAS 由 persistence authority 实现，coordinator 不模拟。
- snapshot equality 比较完整 AST identity；diff 继续只承担 alignment/move。
- mutation apply、persistence flush、VCS checkpoint 是连续但正交的三个阶段。
- no-op 不推进 revision。
- exact checkpoint 使用 lossless v2 tree；legacy tree 继续可读。
- backend-flushed 只能由 Repository 自身 backend capability 证明。
- 旧 API 保持兼容，新能力使用显式入口。

## 风险 / 权衡

- 只提供 memory reference authority，不能证明所有外部持久化 adapter 都正确。
  缓解：把 CAS/failure contract 写成可复用 contract tests，并在后续 adapter
  Track 复用。
- checkpoint 在 flush 之后独立失败，且既有 backend 可能部分接受。缓解：结果
  明确区分 persisted receipt、checkpoint receipt 与 indeterminate，不伪装
  全局回滚。
- revision token 不可排序。缓解：并发控制只依赖 equality；时序与审计由 receipt
  和 VCS history 表达。

## 待解决问题

- 无需用户决策。外部 durable adapter 的选型留给其 owner Track。
