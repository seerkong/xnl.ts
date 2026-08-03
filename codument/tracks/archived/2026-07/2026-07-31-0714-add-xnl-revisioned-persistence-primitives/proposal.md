# 变更：增加 XNL revision-aware persistence 原语

## 背景和动机 (Context And Why)

XNL authoring 已有 clone-based mutation dry-run 与完整 diff/apply parity，但
`xnl-vfs` 的原子性止于内存 candidate，现有 persistence API 只返回 `void`；
`xnl-vcs` 又只暴露 commit object id。上层因此缺少一种公共协议来表达：
“基于我看到的 live revision 持久化这个 candidate；过期则冲突；失败不得推进；
成功后给出可观察 receipt”。

这个缺口不能由 dg-cell-mvi 或 Workbench 各自复制一套 revision 规则。它属于
XNL 的 VFS/VCS authority 边界，并且必须明确区分编辑会话的 live revision 与
VCS commit id。

本 Track 以前置 corrective Track
`reject-xnl-identity-replacement-bypass` 完成为依赖：coordinator 复用的 strict
dry-run 必须已经能阻止 whole-node/container identity replacement，同时继续以
`#id` 做 diff alignment 和 move detection。该依赖是 activation gate：前置
Track 未完成、归档且 behavior 未提升时，本 Track 不得进入实现阶段。

## "要做"和"不做" (Goals / Non-Goals)

**目标:**

- 在 `xnl-vfs` 定义 renderer-neutral、runtime-neutral 的 revisioned snapshot
  authority、CAS flush、receipt 与 apply result。
- 以 opaque revision token 做相等性检查，不向调用方承诺可排序或等同 hash。
- 把 mutation dry-run、identity-sensitive snapshot equality 与 authority CAS
  串成单向写入链；diff 会读取 `#id` 来完成节点对齐和 move 检测，但不会把
  `#id` 当普通 payload 字段生成 update，因此 snapshot equality 使用独立的
  完整 AST 结构比较。
- 提供确定性的 memory authority，覆盖 stale writer、flush failure、重试和
  base immutability。
- 在 `xnl-vcs` 提供 repository adapter，把成功 persisted snapshot 装入
  worktree，并将可选 checkpoint receipt 与 live revision 分开返回。
- 为 exact checkpoint 增加版本化、lossless 的 VCS tree encoding，完整保留
  完整 XNL AST（含显式 `#id`、metadata、attributes、任意 body values 与
  Extend），同时兼容读取旧 tree objects，并穿透 RepositorySnapshot
  node/string 序列化与恢复链。
- 保持既有 VFS persistence、Repository、commit 与 backend API 源兼容。
- 为新 contract/reference authority 提供独立 browser-safe subpath；不借本
  Track 宣称既有 package root 已经 browser-safe。

**非目标:**

- 不把 `commitId`、tree hash、collaboration `VersionId` 当作 live revision。
- 不在该 Track 中实现 CRDT/OT、跨进程分布式锁或云端数据库 adapter。
- 不承诺现有多文件 `LocalFsVfsPersistence.saveSnapshot` 自动获得事务语义。
- 不让 VCS checkpoint 成为每次 authoring mutation 的强制步骤。
- 不把既有 Repository 的 queued/backend failure 伪装成“历史一定未推进”。
- 不把旧 `VfsMutation` bridge 放入新的 browser-safe strict coordinator；
  该入口只接受 `XnlMutationBatch` 与去除 `metadataIdMode` 的 options，并在
  运行时强制 `metadataIdMode="identity"`。
- 不实现 dg-cell-mvi 的 authoring session；它由下游 Track 组合这些原语。

## 变更内容（What Changes）

- 新增 revisioned VFS authority 与 mutation coordinator 公共类型。
- 新增比较完整 AST 的 identity-sensitive structural equality；它与用于
  alignment/move 检测的 `diffNodes` 保持正交。
- 新增内存 reference authority，作为简单场景、测试和自定义 adapter 参考。
- 新增结构化 `applied | unchanged | conflict | rejected | failed` 结果。
- 新增 flush receipt，记录 previous/current live revision 与 durability；不含
  VCS commit identity。
- 新增 repository adapter 与独立 checkpoint receipt；checkpoint 绑定 authority
  读取到的精确 snapshot，并以封闭 result union 显式表达
  checkpointed/conflict/failed/indeterminate 与 truthful durability。
- 新增版本化 lossless VCS tree codec，并为 Repository 增加
  source-compatible exact-snapshot checkpoint primitive；临时 staging 必须在
  `finally` 恢复 public worktree，不能让 checkpoint 尝试偷偷改写编辑态。
- checkpoint 的 backend flush 只能使用 Repository 自身 backend 暴露的可选
  capability，且 active object/content stores 必须绑定到该 backend ports；
  不接受与该 Repository 无法证明关联的任意 flush port。
- 添加 stale CAS、failed flush、no-op、retry、checkpoint separation 和完整
  package 回归测试，包括并发双写、cross-authority 和 out-of-band worktree
  mutation。
- 更新显式 subpath exports 与 API 文档。

## 影响范围（Impact）

- 受影响的能力（behaviors）：`xnl-revisioned-persistence`
- 受影响的代码：
  - `packages/vfs/src/`
  - `packages/vfs/tests/`
  - `packages/vcs/src/`
  - `packages/vcs/tests/`
  - `packages/vfs/package.json`
  - `packages/vfs/tsup.config.ts`
  - `packages/vcs/package.json`
  - `packages/vcs/tsup.config.ts`
  - 两个 package 的公开导出与文档
