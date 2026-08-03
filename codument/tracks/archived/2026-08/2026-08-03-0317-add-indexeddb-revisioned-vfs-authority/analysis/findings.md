# Findings

## 2026-08-03 planning baseline

- `MemoryRevisionedVfsAuthority` 已固定 opaque authority-qualified revision、identity-sensitive equality、
  stale no-op、并发 same-base 与失败不推进语义。
- `IndexedDbVfsPersistence` 只提供普通 snapshot load/save；它没有持久 revision，也没有把 freshness
  check 与 snapshot write 放在同一 transaction 中，因此不能直接充当 `RevisionedVfsAuthority`。
- Workbench 可编程文档当前 bootstrap 使用进程内 memory authority，导致完整页面刷新后无法从浏览器
  持久事实恢复；在应用层包装会复制 xnl-vfs owner 的并发与一致性职责。
- 新实现应增加专用 object store，并与现有 IndexedDB stores 共存；不要复用其节点拆分格式来承担
  revisioned CAS，因为完整 candidate 与 revision 必须在一个原子 record/transaction 中替换。

## 2026-08-03 implementation evidence

- 新增 `indexeddb-schema.ts` 统一数据库 version 2 与 store upgrade。普通 persistence 和 revisioned
  authority 无论谁先打开 fresh database，都会获得完整 schema；旧三个 store 名与 keyPath 保持不变。
- `IndexedDbRevisionedVfsAuthority` 的 seed-if-absent、read 与 CAS 都只通过专用
  `revisioned-vfs-authorities` store；每条 authority record 同时保存 sequence、issued revision values、
  full snapshot，未引入 VCS identity。
- CAS 在一个 readwrite transaction 内读取 current record、检查 foreign/stale、判断 exact no-op、生成
  next revision 并 put；只有 transaction complete 后返回 `workspace` receipt。
- 聚焦测试先以五个 `createIndexedDbRevisionedVfsAuthority is not a function` 形成红基线；实现后 reopen、
  双实例竞争、stale/no-op、clone、failure/retry 与 schema 共存全部通过，TypeScript lint 通过。

## 2026-08-03 verification and gap closure

- 第一轮 fresh verifier 指出四个问题：误把 package root 纳入 browser-safe 承诺、没有真实 transaction
  abort、没有 populated legacy v1 upgrade、没有 package exports 实跑。实现期逐项修正，没有降低既有
  revisioned subpath 契约。
- 真实 `IDBTransaction.abort()` 测试确认 failed 后 reopen 保持原 snapshot/revision，随后从同一 base
  retry 成功。旧 v1 三-store 数据库写入普通 VFS 文件后升级到 v2，文件内容仍可读。
- 新 public-entry test 从 `xnl-vfs/revisioned-persistence` 静态导入 factory/types；package ESM/CJS
  import 均通过。显式 subpath 的 entry 与两个 reachable chunks 不含 fs/path/crypto；不对既有 root
  扩大 browser-safety 声明。
- 最终 VFS 全量为 22 files / 114 tests，lint/build/strict validate 全绿。fresh verifier 对 T1.1、
  T2.1、T3.1 全部判定 PASS，结论 `VERIFIED`，无 blocking 或 non-blocking issue。
- Attractor check：未改 diff/mutation identity；`#id` 继续只作为结构对齐/move identity，authority 仅
  clone、比较和持久完整 snapshot，VCS identity 仍完全独立。
