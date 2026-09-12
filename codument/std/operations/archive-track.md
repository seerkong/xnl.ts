# skill: codument-archive-track（归档 Track）

归档完成或经用户明确确认终止的 Track。CLI 负责 behavior/modeling/engineering/decision registry transaction、冲突检测、rollback、目标路径、Track move 与条件 memory 提升；operation 只编排 hook、命令和语义复核。

## 主流程

1. 定位 Track，读取 `track.xnl`、proposal、design、reports 与未解决 Decision。
2. 执行 `operation-hooks.xnl` 中显式配置的 `archive-track:before` hook。
3. 只基于 track-local evidence 写 `reports/retrospective.md`，使用下方固定结构；没有耐久沉淀时明确记录“无候选”。
4. 在 Track 仍位于 active authority 时，把复盘确认合格的 durable 内容物化为 CLI 已支持的 track-local 输入：Decision 写入根 `decisions.xnl` 或有业务归属的递归 XNL 文件，memory 写入 `memory/<type>/*.md`。不合格或仅属猜测的内容不创建候选。
5. 运行 `codument validate <track-id> --strict`。结构或 registry 问题按 diagnostics 修正后重跑。
6. 对 completed Track 运行 `codument archive <track-id>`。只有用户明确同意归档非 completed Track 时才加 `--yes`。
7. 接受 CLI 返回的事务结果，不再人工重复 apply mutation、merge registry、提升 candidate 或移动目录。
8. 执行显式 `archive-track:after` hook；其中的 ArtifactSync 按 `codument-artifact-sync` 处理。after hook 必须把已归档 authority 视为只读，不得补写 retrospective、decision、memory 或其他 Track 文件。
9. 报告 archive 路径、晋升的 registry、跳过项、冲突和后续动作。

若当前 Track 是 Mission 子流程，归档结果和未完成 Track 的裁决都交还 MissionApplier；Mission 随后继续自己的完成判定与 ready operation，不把 archive 子流程收口当作 invocation 终点。

## 复盘结构

主流程第 3 步按固定小节产出复盘；只使用 Track authority、实现 diff、验证 receipt 和现有 report：

1. **负载/改动面**：本 track 触碰的行为增量（behavior_deltas）、文件与 MaterialBundle 清单、晋升的决策（decisions）、验收/验证记录。
2. **摩擦面**：阻塞与失败证据、确实发生的回退复盘、重复劳动、验证缺口和计划漂移。
3. **沉淀候选**：
   - 符合 knowledge tier 的 lessons / incidents / patterns / summaries，进入现有 `memory/<type>/` 候选；
   - 承重且可复用的决策，进入有业务归属的 `decisions/` XNL，并保留 tree closure 与 provenance；
   - 已有 owner 足以承载的结论，更新对应 owner delta，不创建平行真源。

复盘的目的不是罗列工作量，而是让摩擦与差距进入既有晋升管道。候选必须在主流程第 4 步完成物化，随后才能 validate/archive；归档成功后发现的新想法属于后续 Track，不能回写 archive authority。

## Review-required

CLI 返回 `review-required` 时，读取保留的原 authority、migration manifest 与当前规范，完成语义转换后再次运行 `codument upgrade-resource <path>`、`codument validate` 和 `codument archive`。根 durable Decision 缺少业务 owner 时由 AI 选择有业务含义的 `codument/decisions/**` 路径，并保留完整 tree closure 与 provenance。

## 失败边界

- CLI 的校验、冲突和事务错误是需要处理的真实结果，不改走人工文件移动。
- 系统找不到 CLI 时归档保持 blocked，并说明缺失命令；不使用提示词模拟 registry transaction。
- Git 操作只在 Track 的 `commit_mode` 与用户授权允许时执行，不把提交当作归档成功的前提。

## 完成条件

CLI 成功、archive authority 可重新验证、显式 hook 已处理，且最终报告能对应实际文件和 registry 状态。
