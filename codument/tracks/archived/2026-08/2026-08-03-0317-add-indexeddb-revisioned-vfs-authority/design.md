# 设计：IndexedDB Revisioned VFS Authority

## 事实与 owner

IndexedDB 中每个 `authorityId` 对应一条 revisioned authority record：

```ts
interface IndexedDbRevisionedVfsRecord {
  authorityId: string;
  sequence: number;
  revisionValue: string;
  snapshot: DataElementNode;
}
```

该 record 是浏览器 workspace 的持久事实。调用方 seed 只在 record 不存在时生效；打开已有 record
不得用 seed 覆盖。VCS commit id、tree hash 与 collaboration version 不进入 record。

## 公共 API

```ts
interface IndexedDbRevisionedVfsAuthorityOptions {
  authorityId: string;
  initialSnapshot: DataElementNode;
  dbName?: string;
  dbVersion?: number;
  indexedDbFactory?: IDBFactory;
  clock?: () => string;
  revisionFactory?: (sequence: number) => string;
}

function createIndexedDbRevisionedVfsAuthority(
  options: IndexedDbRevisionedVfsAuthorityOptions,
): Promise<RevisionedVfsAuthority>;
```

异步 factory 完成数据库升级和 seed-if-absent；返回对象只实现既有 interface，不向上层暴露数据库。

## 原子链路

`compareAndSwap` 在单个 readwrite transaction 内执行：

1. 读取 authority record。
2. 比较 `authorityId + revision.value`；foreign/stale 返回 conflict。
3. 使用既有 identity-sensitive structural equality 判断 candidate；current no-op 返回 unchanged。
4. clone candidate，推进 sequence/revision，并写回同一 record。
5. 等待 transaction complete 后返回 applied receipt；事务失败返回 failed 和事务开始时的 actual revision。

IndexedDB 对同一 object store 的 readwrite transaction 串行化，因此两个独立 authority 实例不需要共享
进程内 mutex。只有 transaction complete 是 workspace durability 的成功证据。

## 数据隔离与错误语义

- seed、read result、CAS input 与持久 record 之间均 clone，调用方不能越权修改事实。
- schema/clone/transaction 错误映射为既有 `failed` closed outcome；若 record 无法可靠读取，`read`
  可以抛出基础设施错误，但不得构造伪 revision。
- conflict、unchanged 和 failed 不推进 record。
- 数据库升级只新增专用 store，保留普通 `IndexedDbVfsPersistence` 的既有 stores。

## 验证矩阵

- seed/open/reopen 与 clone isolation。
- applied/unchanged/stale/cross-authority。
- 两个独立实例 same-base 并发。
- transaction abort/failure 不推进，随后 retry 可成功。
- 与现有 `IndexedDbVfsPersistence` 共存。
- VFS 全量 test、lint/build、ESM/CJS/types import 与 Node builtin reachability scan。
