# 提案：IndexedDB Revisioned VFS Authority

## 背景

`xnl-vfs` 已提供 `RevisionedVfsAuthority`、内存参考实现和严格 mutation-to-CAS coordinator，
也已有普通 `IndexedDbVfsPersistence`。但浏览器应用仍缺少一个同时拥有持久快照、opaque live
revision 与原子 compare-and-swap 的 IndexedDB authority。应用若自行拼接 load/save 与内存 revision，
页面重开后 revision 会丢失，多个页面或 authority 实例也无法在线性化点识别 stale writer。

## 目标

在 `xnl-vfs` owner 中提供浏览器安全的 IndexedDB `RevisionedVfsAuthority`：

- 首次打开以调用方 seed 初始化；再次打开恢复同一 authority 的 snapshot 与 revision。
- `read` 和 `compareAndSwap` 复用既有公开 contract 与 identity-sensitive equality。
- expected revision 校验、semantic no-op 判断、snapshot/revision 更新位于同一个 IndexedDB
  readwrite transaction 中。
- 两个独立实例基于同一 revision 并发写入时恰好一个 applied、一个 conflict。
- 冲突、失败与 stale no-op 均不推进持久事实；成功 receipt 报告 `durability="workspace"`。
- 经 package root 与 `xnl-vfs/revisioned-persistence` 的 ESM/CJS/types 公共面发布；延续既有边界，
  只有显式 revisioned subpath 承诺不引入 Node-only 依赖，不扩大 package root 的 browser-safe 声明，
  也不改变 VCS identity 边界。

## 非目标

- 不实现 CRDT/OT、多主同步或跨设备协作。
- 不让 IndexedDB authority 创建 VCS commit。
- 不以 Workbench 私有 adapter、localStorage 或进程内锁代替持久化 CAS。
- 不修改 `#id` 的 structural identity 语义。

## 风险与验证

主要风险是把 read/compare/write 拆到多个 transaction、数据库升级破坏旧 persistence store，或在
页面重开时重新生成 authority identity。验证必须覆盖 reopen、独立实例并发、stale/no-op、失败原子性、
clone isolation、既有 IndexedDB persistence 兼容，以及构建产物的浏览器安全性。
