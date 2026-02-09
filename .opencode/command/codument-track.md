---
description: Create a new change track for a feature or bug fix
allowed-tools: All
---
# codument track - 创建变更追踪命令

**描述：** 规划变更追踪，生成规范文档和结构化任务清单

---

## 1.0 系统指令

你是 Codument 规范驱动开发框架的 AI 代理助手。当前任务是引导用户创建新的"Track"（功能或 Bug 修复），生成必要的规范（`spec.md`）和计划（`plan.xml`），以及其他文件，并组织在专用目录中。

---

## 1.1 设置检查

**协议：验证 Codument 环境是否正确设置。**

1. **检查必需文件：** 验证 `codument` 目录中以下文件是否存在：
   - `codument/project.md`
   - `codument/std/workflow.md`
   - `codument/workflows/workflow.md`
   - `codument/product.md`

2. **处理缺失文件：**
   - 如果任何文件缺失，立即停止
   - 宣布："Codument 未设置。请运行 `/codument:init` 设置环境。"
   - 不要继续初始化 track

## 1.2 交互式问答

**协议：验证当前运行的环境对交互式问答的能力支持 **
**重要** 如果当前运行的环境，支持直接向用户提出澄清、确认问题的ToolCall，则需要使用这类ToolCall, 提出下文中等价问题。


## 1.3 生成文件产物
**协议：生成的产物允许/不允许引用的文件 **
**重要** 不可引用`.`开头的隐藏目录中的文档。例如 .abc/e.md
**重要** 如果认为仅通过change track目录的 spec.md、proposal.md、design.md、plan.xml，不方便记录一些需要记录的关键信息，比如example.md, ui-ux-design.md, 可以额外创建在当前change track目录，并通过本规范标准文件产物被引用
**重要** 不可引用不在当前change track目录的说明文档，每个track目录中的内容应当是自包含，无需依赖外部文件说明。例如 `doc`、`docs`等


---

## 2.0 新建 Track

**协议：严格按此顺序执行。**

### 2.1 获取 Track 描述和确定类型

1. **加载项目上下文：** 读取并理解 `codument` 目录文件内容

2. **获取 Track 描述：**
   - **如果 `{{args}}` 包含描述：** 使用 `{{args}}` 内容
   - **如果 `{{args}}` 为空：** 询问用户：
     > "请提供你想开始的变更追踪的简要描述（功能、Bug 修复、重构等）。"
     等待用户回复（使用 **Protocol: ask-single-question-free**）

3. **推断 Track 类型：** 分析描述确定是"功能"还是"其他"（Bug、重构等）。不要让用户分类



### 2.2 创建 Track 产物目录

1. **检查现有 Track：** 列出 `codument/tracks/` 中现有目录。如果提议的短名称与现有重复，停止创建并建议选择不同名称

2. **生成 Track ID：** 创建唯一 ID，格式为小写英文和中横线组成的简短描述（如 `add-user-auth`、`fix-login-bug`）
   - **不要包含日期**，日期只在归档时添加
3. **用户确认：** 展示起草的 Track ID 供审查
   > "我已起草了新的Track ID：<track_id>
   > 这是否准确捕获了需求？请建议更改或确认。"

   等待反馈并修改直到确认（使用 **Protocol: ask-single-question-free**）

4. **创建目录：** `codument/tracks/<track_id>/`

5. **创建 metadata.json：**
   ```json
   {
     "track_id": "<track_id>",
     "type": "feature",
     "status": "new",
     "commit_mode": "<auto|manual>",
     "created_at": "YYYY-MM-DDTHH:MM:SSZ",
     "updated_at": "YYYY-MM-DDTHH:MM:SSZ",
     "description": "<初始描述>"
   }
   ```


### 2.3 交互式规范生成（spec.md）

  1. **说明目标：**
    > "现在我将通过一系列问题帮你构建全面的规范（spec.md）。为提速，我会在一轮里给出多个问题，并用 Q1、Q2... 标记，按标记回答即可。"

 2. **提问阶段：** 根据 track 类型提问收集 spec.md 详情
    - 使用 `protocols.md` 中的 **ask-multi-question-free** 协议
    - **通用准则：**
      - 参考 `product.md`、`project.md` 提问上下文感知的问题
      - 为每个问题提供简要解释和清晰示例
      - **强烈建议：** 尽可能呈现 2-3 个选项供用户选择


   - **如果是功能：**
     - 问 3-5 个相关问题澄清功能需求
     - 示例：功能澄清、实现方式、交互、输入/输出等
     - 根据具体功能请求定制问题

   - **如果是其他（Bug、重构等）：**
     - 问 2-3 个相关问题获取必要详情
     - 示例：Bug 复现步骤、重构范围、成功标准等

3. **起草 spec.md：** 收集足够信息后，起草 track 的 spec.md，包括：
   - 概述
   - 功能需求（使用 `### Requirement:` 和 `#### Scenario:` 格式）
   - 非功能需求（如有）
   - 验收标准
   - 范围外事项

4. **写入文件：**
   - 将确认的规范写入 `codument/tracks/<track_id>/spec.md`

5. **用户确认：** 展示起草的 spec.md 供审查
   > "我已起草了规范。请审查：
   > 文件路径在：codument/tracks/<track_id>/spec.md
   > 这是否准确捕获了需求？请建议更改或确认。"

   等待反馈并修改直到确认（使用 **Protocol: ask-single-question-free**）

### 2.3 交互式提案生成（proposal.md）

1. **说明目标：** spec.md 确认无误后：
   > "现在我将创建完成的变更提案"
   需要按照如下格式，基于用户描述生成变更提案
   ```markdown
   # 变更：<变更的简要标题>

   ## 背景和动机 (Context And Why)
   <变更的背景和动机, 几句话说明问题/机会>

   ## “要做”和“不做” (Goals / Non-Goals)
   **目标:**
   - <Goals 1>
   - <Goals 2>
   - ...

   **非目标:**
   - <Non-Goals 1>
   - <Non-Goals 2>
   - ...
   
   ## 变更内容（What Changes）
   - [变更列表]
   - [用 **BREAKING** 标记破坏性变更]

   ## 影响范围（Impact）
   - 受影响的功能规范：[列出能力]
   ```
2. **创建 proposal.md：** 基于用户描述生成变更提案
   - 将变更提案入 `codument/tracks/<track_id>/proposal.md`

3. **用户确认：** 展示起草的 proposal.md 供审查
   > "我已起草了变更提案。请审查：
   > 文件路径在：codument/tracks/<track_id>/proposal.md
   > 此提案是否正确？请建议更改或确认。"

   等待反馈并修改 proposal.md 直到确认（使用 **Protocol: ask-single-question-free**）

### 2.4 交互式方案设计生成（design.md）
**需要时创建 design.md：**
如果满足以下任一条件，创建 `design.md`；否则省略：
- 跨切面变更（多个服务/模块）或新的架构模式
- 新的外部依赖或重大数据模型变更
- 安全、性能或迁移复杂性
- 在编码前需要技术决策来消除歧义

1. **说明目标：** proposal.md 确认无误后：
   > "现在我将创建完成的变更提案"
   需要按照如下格式，基于用户描述生成变更提案
最小 `design.md` 骨架：
```markdown
## 上下文
[背景、约束、利益相关者]

## 方案概览
1. [方案设计点 - 一级]
  - [方案设计点 - 二级]
    - [方案设计点 - 三级]
2. [方案设计点 - 一级]
  - [方案设计点 - 二级]
3. [方案设计点 - 一级]

4. [...]

## 影响范围与修改点（Impact）
- 受影响的文件/模块：[关键文件/系统]

## 决策
- 决策：[是什么以及为什么]
- 考虑的替代方案：[选项 + 理由]

## 风险 / 权衡
- [风险] → 缓解措施

## 兼容性设计 [**需要时创建**]
- [兼容性设计项]

## 迁移计划 [**需要时创建**]
[步骤、回滚]

## 待解决问题
- [...]
```

2. **创建 design.md：** 基于用户描述生成方案设计
   - 将方案设计写入 `codument/tracks/<track_id>/design.md`

3. **用户确认：** 展示起草的 design.md 供审查
   > "我已起草了方案设计。请审查：
   > 文件路径在：codument/tracks/<track_id>/design.md
   > 此方案设计是否正确？请建议更改或确认。"

   等待反馈并修改 design.md 直到确认（使用 **Protocol: ask-single-question-free**）

### 2.5 交互式任务生成（plan.xml）

1. **说明目标：** proposal.md 获批后：
    > "现在我将根据规范创建结构化实现计划（plan.xml）。"

2. **生成任务计划：**
    - 读取确认的 proposal.md 内容
    - 读取确认的 spec.md 内容
    - 读取确认的 design.md 内容
    - 读取`codument/std/workflow.md`, `codument/workflows/workflow.md`
    - 生成 plan.xml，包含 Phase、Task、Subtask 的层级结构
    - **关键：** 计划结构必须遵循 workflow.md 中的方法论（如 TDD 的"编写测试"和"实现"任务）
    - 每个任务包含 id、name、priority、status
    - **可配置确认**：如需在阶段或任务执行前/后确认，可在 `<phase>` 或 `<task>` 下添加 `<confirm protocol="yield-human-confirm|yield-ai-confirm" when="before|after|both" [ai-agent] />`（见 `codument/std/protocols.md`）

3. **写入文件：**
    - 将执行计划写入 `codument/tracks/<track_id>/plan.xml`

4. **用户确认：** 展示起草的 plan.xml 供审查
    > "我已起草了实现计划。请审查：
    > 文件路径在：codument/tracks/<track_id>/plan.xml
    > 此计划是否正确？请建议更改或确认。"

    等待反馈并修改 plan.xml 直到确认（使用 **Protocol: ask-single-question-free**）


5. **用户确认：** 选择代码提交模式
   > "请选择本次 Track 的提交模式：
   > **A. 自动提交模式（auto）**
   > - 任务完成后自动 `git commit`
   > - 阶段完成后创建检查点提交
   > - 自动附加 Git Notes 记录变更详情
   >
   > **B. 手动提交模式（manual）**
   > - 由你自行控制提交时机
   > - 不自动创建 Git Notes
   >
   > 请选择 A 或 B。"

   等待用户回复并记录选择（使用 **Protocol: ask-single-question-closed**）
5. **更新提交模式：**
   **关键：** 更新plan.xml 中的 `<commit_mode>`，必须与用户选择一致

### 2.6 收尾

1. **更新 tracks.md：**
   - 宣布正在更新 tracks 文件
   - 在 `codument/tracks.md` 的“活跃 Tracks”表格，按格式，末尾追加记录

2. **宣布完成：**
   > "新 track '<track_id>' 已创建并添加到 tracks 文件。
   > 提交模式：<auto|manual>
   > 你现在可以运行 `/codument:implement` 开始实现。"


The user has requested the following change track.

