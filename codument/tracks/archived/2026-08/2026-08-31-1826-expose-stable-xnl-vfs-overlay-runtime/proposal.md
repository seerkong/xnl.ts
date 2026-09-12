# 变更：提供稳定、原子的 XNL VFS overlay materialization runtime

## 背景和动机 (Context And Why)

`xnl-vfs` 已具备稳定 full snapshot、VFS diff/apply、XNL content mutation、identity guard 与 revisioned CAS authority，但调用方仍需自行拼接“稀疏目录 overlay + 显式 VFS mutation + 有序多层 + 一次原子发布”。缺少统一 runtime 会诱使下游直接 merge 文件 map，丢失 node identity、删除语义、mutation index 和失败关闭边界。

## “要做”和“不做” (Goals / Non-Goals)

**目标：**

- 定义 framework-neutral 的 directory-shaped overlay 与 explicit mutation overlay contract。
- 将 sparse directory snapshot 解释为 path add/replace/no-opinion，保持已有节点 identity，并保留新增节点的稳定 id。
- 按显式 order 顺序规划多个 overlay，在隔离 candidate 上完成全量 apply，输出带 overlay/mutation 定位的 diagnostics。
- 将最终 candidate 转为一批 strict XNL mutations，通过已有 revisioned coordinator 一次 CAS 发布。
- 暴露独立、browser-safe 的 `xnl-vfs/overlay-materialization` package subpath。

**非目标：**

- 不识别 Eidolon、BunFS、home/workspace 或 Halfcode FQN。
- 不读取物理目录；物理目录 adapter 由调用方转换为 sparse VFS snapshot。
- 不加入 field-manager/SSA 语义；冲突裁决只使用明确的 overlay order、identity、precondition 与 revision。
- 不替代现有 `serializeVfsSnapshot`、`applyRevisionedVfsMutations` 或 VCS checkpoint API。

## 变更内容（What Changes）

- 新增 overlay materialization 类型、pure planner、directory merge 与 revisioned applier。
- 新增 structured diagnostic，至少携带 overlay id/order/index、logical path、mutation index 与 cause。
- 新增 public subpath、构建入口、类型声明与 transitive browser-safety test。
- 新增 sparse replacement/fallback、explicit delete/move/XNL mutation、stale CAS 与 all-or-nothing tests。

## 影响范围（Impact）

- 受影响能力：`xnl-vfs-overlay-materialization`
- 受影响代码：`packages/vfs/src/overlay-materialization.ts`、package exports/tsup、`packages/vfs/tests/`
