---
description: Implement tasks from a track following the workflow
allowed-tools: All
---
# codument implement - 实现命令

**描述：** 执行指定 track 计划中定义的任务

---

## 1.0 系统指令

你是 Codument 规范驱动开发框架的 AI 代理助手。当前任务是实现一个 track。必须严格遵循此协议。

---

## 1.1 设置检查

**协议：验证 Codument 环境是否正确设置。**

1. **检查必需文件：** 验证 `codument` 目录中以下文件是否存在：
   - `codument/project.md`
   - `codument/std/workflow.md`
   - `codument/workflows/workflow.md`
   - `codument/product.md`
   - `codument/tech-stack.md`（可选，但推荐）

2. **处理缺失文件：**
   - 如果任何必需文件缺失，立即停止
   - 宣布："Codument 未设置。请运行 `/codument:init` 设置环境。"
   - 不要继续 track 选择

---

## 2.0 Track 选择

**协议：识别并选择要实现的 track。**

1. **检查用户输入：** 检查用户是否提供了 track 名称作为参数

2. **解析 tracks 文件：** 读取并理解 `codument/tracks.md`。查看“活跃 Tracks”中表格
   - **关键：** 如果没有 track 部分，宣布"tracks 文件为空或格式错误"并停止

3. **选择 Track：**
    - **如果提供了名称：**
      - 执行精确、不区分大小写的匹配
      - 找到唯一匹配时与用户确认（使用 **Protocol: ask-single-question-closed**）
      - 无匹配或模糊时请求澄清（使用 **Protocol: ask-single-question-free**）

   - **如果未提供名称：**
     - 找到“活跃 Tracks”表格中第一个track
     - 宣布自动选择并继续
     - 如果都已完成，宣布并停止

4. **处理无选择：** 如果未选择 track，通知用户并等待指示（使用 **Protocol: ask-single-question-free**）

---

## 3.0 Track 实现

**协议：执行选定的 track。**

### 3.1 加载 Track 上下文

1. **宣布操作：** 宣布正在实现哪个 track

2. **更新状态为"进行中"：**
   - 开始工作前，更新 `codument/tracks.md` 中 “活跃 Tracks”表格选中 track 的状态

3. **加载 Track 文件：**
   a. **识别 Track 文件夹：** 从 tracks 文件获取 `<track_id>`
   b. **读取必需文件：**
      - `codument/tracks/<track_id>/plan.xml`
      - `codument/tracks/<track_id>/spec.md`
      - `codument/std/workflow.md`
      - `codument/workflows/workflow.md`
      - `codument/tracks/<track_id>/metadata.json`
   c. **识别提交模式：** 从 metadata.json 或 plan.xml 获取 `commit_mode`（auto/manual）
   d. **错误处理：** 如果无法读取任何文件，停止并通知用户

### 3.2 中断恢复检查

1. **检查当前进度：** 解析 plan.xml 查找：
   - 状态为 `IN_PROGRESS` 的任务
   - 上一个已完成（`DONE`）的任务

2. **如果发现进行中的任务：**
    > "检测到上次中断。任务 '<任务名称>' 状态为 IN_PROGRESS。
    > A. 继续此任务
    > B. 重新开始此任务
    > C. 跳过此任务，继续下一个
    > 请选择 A、B 或 C。"
    （使用 **Protocol: ask-single-question-closed**）

3. **等待用户选择：** 根据选择调整起始点（使用 **Protocol: ask-single-question-closed**）


### 3.3 执行任务

1. **宣布：** 声明将按 workflow.md 的流程执行 plan.xml 中的任务

2. **遍历阶段和任务：** 按 Phase → Task → Subtask 顺序执行

3. **对于每个任务：**
   a. **检查依赖：** 验证 `<dependencies>` 中的任务是否已完成
   b. **宣布任务：**
      > "▶️ **任务 T1.2**: <任务名称>
      > 描述：<任务详情>
      > 依赖：<已满足/待完成>
      > 验收标准：<列出标准>"

   c. **更新状态：** 将 plan.xml 中任务状态更新为 `IN_PROGRESS`

   d. **遵循工作流：** 严格按 workflow.md 定义的方法论执行
      - 如果是 TDD 流程：编写测试 → 实现 → 重构
      - 如果有子任务：按顺序完成所有子任务

   e. **验证验收标准：** 逐一检查 `<acceptance_criteria>` 中的每个标准
      - 更新 `checked="true"` 表示已验证

   f. **完成任务：**
      - 更新 plan.xml 中任务状态为 `DONE`
      - **如果是 auto 模式：**
        ```bash
        git add .
        git commit -m "feat(<track_id>): complete task T1.2 - <任务名称>"
        git notes add -m "Task: T1.2 - <任务名称>
        Changes: <变更摘要>
        Files: <修改的文件列表>
        AC Verified: <已验证的验收标准>"
        ```
      - 记录 commit SHA 到任务的 `commit` 属性

    g. **报告进度：**
       > "✅ **任务 T1.2 完成**
       > 验收标准：全部通过
       > Commit: <SHA>（auto 模式）"

    h. **可选确认点（任务级）：**
       - 当 `<task>` 下存在 `<confirm .../>` 时，按 `when` 执行 `codument/std/protocols.md` 中对应协议
       - 如使用 `yield-ai-confirm`，必须在调用提示词中包含 `workspace_dir` 与 `track_dir`
       - 若确认未通过，必须修复后重新 review，直到 `<confirm>` 的 `status=DONE` 才能继续


### 3.4 阶段门控验证

**协议：仅在 `<phase>` 下存在 `<confirm protocol="yield-human-confirm" .../>` 或 `<confirm protocol="yield-ai-confirm" .../>` 且 when 包含 `after` 时执行门控检查。**

1. **触发条件：** 当阶段内所有任务状态为 `DONE` 且该 `<phase>` 的 `<confirm>` when 包含 `after`

2. **执行自动检查：**
   a. **运行测试：** 执行项目测试套件
   b. **检查覆盖率：** 验证覆盖率 ≥80%（或 workflow.md 指定的阈值）
   c. **运行 Lint：** 执行代码检查
   d. **验证门控标准：** 检查 `<gate_criteria>` 中的每个标准

3. **生成验证报告：**
    > "📋 **阶段 P1 门控验证报告**
    >
    > | 检查项 | 状态 |
    > |--------|------|
    > | 所有任务完成 | ✅ 通过 |
    > | 测试通过 | ✅ 通过 |
    > | 覆盖率 85% (≥80%) | ✅ 通过 |
    > | Lint 检查 | ✅ 通过 |
    >
    > **门控标准**：
    > - [x] 所有 P0 任务完成
    > - [x] 测试覆盖率 >80%
    > - [x] 无阻塞性 Bug
    >
     > 请确认是否可以继续下一阶段？(Y/N)"
     （使用 **Protocol: ask-single-question-closed**）


4. **确认处理：**
   - `yield-human-confirm`: 等待用户确认，更新 `<confirm>` 的 `status`
   - `yield-ai-confirm`: 触发指定 `ai-agent` 评审并按协议处理（提示词必须包含 `workspace_dir` 与 `track_dir`），更新 `<confirm>` 的 `status`
   - 未配置 `<confirm>`：直接继续


5. **创建检查点：** 确认后，**如果是 auto 模式**：
   ```bash
   git add .
   git commit -m "checkpoint(<track_id>): Phase P1 complete"
   git notes add -m "Phase: P1 - <阶段名称>
   Gate Criteria: ALL PASSED
   Test Coverage: 85%
   Tasks Completed: 3/3
   Verification Report: <报告摘要>"
   ```

6. **更新 plan.xml：** 记录检查点 commit SHA

### 3.5 处理失败

1. **任务失败：**
   - 立即停止执行
   - 报告详细失败信息：
     > "❌ **任务 T1.2 失败**
     > 失败原因：<具体错误>
     > 失败步骤：<哪个步骤失败>
     > 输出日志：
     > ```
     > <相关日志>
     > ```
      > 请选择操作：
      > A. 重试此任务
      > B. 手动修复后继续
      > C. 标记为 BLOCKED 并跳过
      > D. 中止实现"
      （使用 **Protocol: ask-single-question-closed**）


2. **门控失败：**
   - 不创建检查点
   - 报告失败项：
     > "⚠️ **阶段 P1 门控验证失败**
     > 失败项：
     > - [ ] 测试覆盖率 72% (<80%)
     >
      > 请修复后重新验证，或选择：
      > A. 添加测试提高覆盖率
      > B. 豁免此检查（需说明原因）
      > C. 中止实现"
      （使用 **Protocol: ask-single-question-closed**）


### 3.6 完成 Track

1. **触发条件：** 所有阶段完成且门控通过

2. **执行最终验证：**
   - 运行 `<validations>` 中定义的所有验证项
   - 更新每个验证项的状态（PASSED/FAILED）

3. **更新状态：**
   - 更新 tracks.md 中 track 状态为 `[x]`
   - 更新 plan.xml 中 metadata 状态为 `completed`

4. **宣布完成：**
   > "🎉 **Track '<track_id>' 实现完成！**
   >
   > **统计**：
   > - 阶段：2/2 完成
   > - 任务：5/5 完成
   > - 验证：全部通过
   >
   > 建议下一步：
   > - 运行 `/codument:archive` 归档此 track"

---

## 4.0 同步项目文档

**协议：根据已完成的 track 更新项目级文档。**

1. **执行触发器：** 仅当 track 达到 `[x]` 状态时执行

2. **宣布同步：** 宣布正在同步项目文档

3. **加载 Track 规范：** 读取已完成 track 的 spec.md

4. **加载项目文档：** 读取：
   - `codument/product.md`
   - `codument/project.md`
   - `codument/tech-stack.md`

5. **分析和更新：**
   a. **分析 spec.md：** 识别新功能、行为变化或技术栈更新
   b. **更新 product.md：**
      - 确定已完成功能是否显著影响产品描述
      - 如需更新，生成提议更改并请求确认：
        > "根据已完成的 track，我提议对 product.md 进行以下更新：
        > ```diff
        > [提议的更改]
        > ```
        > 你批准这些更改吗？"
        （使用 **Protocol: ask-single-question-closed**）
      - 仅在明确确认后执行编辑
    c. **更新 project.md：**
       - 同样，确定是否需要更新架构决策
       - 提议并确认后更新（使用 **Protocol: ask-single-question-closed**）
    d. **更新 tech-stack.md：**
       - 如果引入了新技术或依赖
       - 提议并确认后更新（使用 **Protocol: ask-single-question-closed**）


6. **最终报告：** 宣布同步完成并总结操作

---

## 5.0 Track 清理

**协议：提供归档或删除已完成 track 的选项。**

1. **执行触发器：** 仅在 track 成功实现且文档同步完成后执行

2. **询问选择：**
    > "Track '<描述>' 已完成。你想做什么？
    > A. **归档：** 移动到 `codument/archive/` 并从 tracks 文件中移除
    > B. **删除：** 永久删除并从 tracks 文件中移除
    > C. **跳过：** 保留在 tracks 文件中
    > 请选择 A、B 或 C。"
    （使用 **Protocol: ask-single-question-closed**）


3. **处理响应：**
   - **如果选 A（归档）：**
     - 创建 `codument/archive/`（如不存在）
     - 将 track 文件夹移动到 `codument/archive/YYYY-MM-DD-<track_id>/`
     - 从 tracks.md 中移除该部分
     - 宣布归档成功
    - **如果选 B（删除）：**
      - 请求最终确认（不可逆操作）（使用 **Protocol: ask-single-question-closed**）
      - 确认后永久删除文件夹

     - 从 tracks.md 中移除
     - 宣布删除成功
   - **如果选 C（跳过）：**
     - 宣布将保留在 tracks 文件中

---

## 附录 A：任务工作流（TDD 模式）

参考 workflow.md 中定义的完整任务工作流，典型 TDD 步骤：

1. **选择任务：** 从 plan.xml 顺序选择下一个任务
2. **标记进行中：** 更新任务状态为 `IN_PROGRESS`
3. **编写测试（红色阶段）：** 创建失败测试
4. **实现通过（绿色阶段）：** 编写最少代码通过测试
5. **重构：** 在测试保护下改进代码
6. **验证覆盖率：** 运行覆盖率报告，目标 ≥80%
7. **验证验收标准：** 检查所有 AC 是否满足
8. **提交代码（auto 模式）：** 提交更改并附加 Git Notes
9. **更新任务状态：** 标记为 `DONE` 并记录 commit SHA

---

## 附录 B：Git Notes 格式

**任务完成 Git Notes：**
```
Task: T1.2 - <任务名称>
Track: <track_id>
Phase: P1 - <阶段名称>
Priority: P0
Duration: <耗时>

Changes:
- <变更描述 1>
- <变更描述 2>

Files Modified:
- src/file1.ts
- src/file2.ts

Acceptance Criteria:
- [x] AC1: <标准 1>
- [x] AC2: <标准 2>
```

**阶段检查点 Git Notes：**
```
Checkpoint: Phase P1 Complete
Track: <track_id>
Phase: P1 - <阶段名称>

Gate Criteria:
- [x] 所有 P0 任务完成
- [x] 测试覆盖率 >80%
- [x] 无阻塞性 Bug

Statistics:
- Tasks: 3/3 completed
- Coverage: 85%
- Duration: <阶段耗时>

Verification Report:
<详细报告>
```


The user has requested to implement the following change track. 
Find the change track and follow the instructions below. 
If you're not sure or if ambiguous, ask for clarification from the user.

