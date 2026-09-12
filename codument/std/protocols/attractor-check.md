# AttractorCheck 协议

AttractorCheck 是显式 hook 触发的方向审查：检查计划或实现是否仍受所选 attractor profile 引导。它不是通用 validation、GapLoop 的别名、实现器或 mission 控制循环。

## Reviewer Contract

每次调用都使用 fresh context。reviewer 重新读取：

- hook 的 `{ use = "<profile>" }` 与 `config/attractor-profiles.xnl`；
- profile 引用的标准和项目 attractor；
- 调用方指定的计划、实现、decision 与必要工程事实。

reviewer 只读，不修改文件、不改变 task/track/mission 状态、不向用户提问。调用方可显式授权只读检查命令；实现测试、修复和状态写回仍由调用方负责。

## Receipt

每轮只返回紧凑文本：

```text
status: PASS | GAP | BLOCKED
summary: <结论或需要处理的差距>
evidence:
- <path:line 或稳定 id>
```

- `PASS`：没有发现违反所选 attractor 的差距。
- `GAP`：发现调用方可修复的方向偏差；`summary` 说明期望态与实际态之差。
- `BLOCKED`：缺少审查所需 authority/evidence，或差距需要调用方之外的真实决策、权限或外部输入。

evidence 必须能回到具体文件锚点或稳定资源 id；不要用未引用的直觉代替证据。

## Caller Contract

轮次和控制流归调用方所有：

- `PASS`：完成当前 hook，继续所属 operation。
- `GAP`：调用方修复所报差距并验证，然后启动新的 fresh reviewer；同一 reviewer 不执行修复或自行续轮。
- `BLOCKED`：调用方按所属 operation 的失败边界协调。Track 子流程中的 `BLOCKED` 先交还 MissionApplier，不自动成为 mission invocation 返回点。

调用方应给 reviewer 明确的 profile、审查对象、当前 hook 点和允许的只读命令。协议不要求额外 XNL receipt 或持久 round 状态；需要审计时，由调用方把文本 receipt 写入现有 report。

## 与 GapLoop 的关系

GapLoop 负责目标对比、修复和 fresh 复检循环；AttractorCheck 只判断方向是否违反 attractor。二者互不替代，也不从 `GapLoopDefaults.verify_round` 推导对方是否运行。

若同一 lifecycle point 显式配置两者，调用方按 hook 在 XNL 中的顺序执行，并分别消费结果。未配置 AttractorCheck 时不隐式运行。

## 引用规则

任何直接 author 或 execute AttractorCheck 的 operation 都必须引用 `std/protocols/attractor-check.md`，并只保留自己的触发条件与 caller 行为，不复制 reviewer verdict、轮次或证据格式。
