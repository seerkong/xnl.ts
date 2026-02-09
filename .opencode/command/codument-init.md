---
description: Initialize Codument in the current project
allowed-tools: All
---
# codument init - 项目初始化命令

**描述：** 搭建项目脚手架并设置 Codument 环境

---

## 1.0 系统指令

你是一个 AI 代理，负责使用 Codument 方法论设置和管理软件项目。严格按照这些指令顺序执行，不要做假设。
**重要** 如果当前运行的环境，支持直接向用户提出澄清、确认问题的ToolCall，则需要使用这类ToolCall, 提出下文中等价问题。

---

## 1.1 恢复检查

**协议：开始设置前，使用状态文件确定项目状态。**

1. **读取状态文件：** 检查 `codument/state.json` 是否存在。
   - 如果不存在，这是新项目设置。继续步骤 1.2。
   - 如果存在，读取其内容。

2. **基于状态恢复：**
   - 设 JSON 中的 `last_successful_step` 值为 `STEP`。
   - 根据 `STEP` 值跳转到下一个逻辑部分：

   - 如果 `STEP` 是 "2.1_project"，宣布恢复进度并继续 **2.2 节**。
   - 如果 `STEP` 是 "2.2_product"，宣布恢复进度并继续 **2.3 节**。
   - 如果 `STEP` 是 "2.3_workflow":
     - 宣布："项目已初始化。你可以使用 `/codument:track` 创建新变更追踪，或使用 `/codument:implement` 开始实现。"
     - 停止 init 流程。

---

## 1.2 初始化概述

1. **提供高层概述：**
   > "欢迎使用 Codument。我将引导你完成以下步骤来设置项目：
   > 1. **项目发现：** 分析当前目录，确定这是新项目还是现有项目。
   > 2. **项目定义：** 定义项目的技术栈、架构约定和产品愿景。
   > 3. **工作流配置：** 选择开发工作流和质量门控。
   > 4. **变更追踪生成：** 定义初始 track 并自动生成详细计划以开始开发。
   >
   > 开始吧！"

---

## 2.0 第一阶段：项目设置

**协议：按此顺序执行交互式设置。**

### 2.0 项目发现
0. 分析现有项目时，要忽略当前workspace下一些目录
  - codument 目录：这个目录是让使用Codument 方法论设置和管理软件项目的文档和配置目录
  - .gitignore 文件中，配置的忽略的内容：这些文件是用户强制指定要忽略的

1. **检测项目成熟度：**
   - **Brownfield 指标：**
     - 存在版本控制目录：`.git`、`.svn` 或 `.hg`
     - 如果存在 `.git`，执行 `git status --porcelain`。输出非空则为 Brownfield
     - 存在依赖清单：`package.json`、`pom.xml`、`requirements.txt`、`go.mod`、`Cargo.toml`
     - 存在源代码目录：`src/`、`app/`、`lib/` 包含代码文件
   - **Greenfield 条件：**
     - 以上指标都不存在，且目录为空或仅包含通用文档（如单个 `README.md`）

2. **根据成熟度执行工作流：**
   - **如果是 Brownfield：**
     - 宣布检测到现有项目
     - 如果 git 有未提交更改，警告用户提交或暂存后再继续
     - **开始 Brownfield 初始化协议：**
       1. **请求权限：** 请求进行只读扫描分析项目
       2. **代码分析：** 优先分析 `README.md`，扩展到其他相关文件
       3. **提取上下文：** 识别编程语言、框架、数据库驱动、架构类型
       4. **推断项目目标：** 根据 README 或 package.json 描述一句话总结
     - 完成后继续 2.1
    - **如果是 Greenfield：**
      - 宣布将初始化新项目
      - 初始化 Git 仓库（如不存在）
      - **询问：** "你想构建什么？" 等待用户回复（使用 **Protocol: ask-single-question-free**）
      - 创建 `codument/` 目录

     - 初始化状态文件：创建 `codument/state.json`，内容为 `{"last_successful_step": ""}`
     - 将用户回复写入 `codument/product.md` 的 `# 初始概念` 部分

3. **继续：** 立即进入下一节

### 2.1 生成项目上下文（交互式）

1. **介绍：** 宣布将帮助创建 `project.md`

2. **批量提问（加速）：** 每轮可提出 2-4 个问题，每个问题前添加 `Q1`/`Q2`... 标识，等待用户按标识逐条回答
   - 使用 `protocols.md` 中的 **ask-multi-question-free** 协议
   - **约束：** 总问题数最多 5 个
   - **建议：** 每个问题生成 3 个高质量建议答案
   - **主题：** 技术栈、架构模式、代码风格、测试策略、Git 工作流
   - **问题类型：**
     - **累加型**：允许多选，添加"（选择所有适用项）"
     - **排他选择型**：引导单一决定
   - **自动生成逻辑：** 如果用户选 E，停止提问，根据已有信息推断剩余细节
   

3. **起草文档：** 对话完成后生成 `project.md` 内容
   - **关键：** 生成来源仅是用户选择的答案，忽略未选择的选项
   - 不要在最终文件中包含对话选项

4. **用户确认：** 展示起草内容供审查
   ```
   A) **批准：** 文档正确，继续。
   B) **修改建议：** 告诉我要修改什么。
   ```
   根据回复修改或批准后退出循环（使用 **Protocol: ask-single-question-closed**）

5. **写入文件：** 批准后写入 `codument/project.md`

6. **提交状态：** 写入 `codument/state.json`：`{"last_successful_step": "2.1_project"}`

7. **继续：** 立即进入下一节

### 2.2 生成产品定义（交互式）

1. **介绍：** 宣布将帮助创建或完善 `product.md`

2. **顺序提问：** 一次问一个问题
   - **加速：** 每轮可并行提出 2-4 个问题并用 `Q1`/`Q2`... 标识，等待用户按标识逐条回复。保持总问题数不超过 7 个
   - 使用 `protocols.md` 中的 **Protocol: ask-single-question-free** 协议（并行提问时使用 **Protocol: ask-multi-question-free**）
   - **主题：** 目标用户、核心目标、主要功能、产品愿景
   - 遵循 2.1 相同的问题格式规范

3. **起草文档：** 生成 `product.md` 内容
   - 如果已存在初始概念，在此基础上扩展

4. **用户确认：** 展示并确认（使用 **Protocol: ask-single-question-free**）

5. **写入文件：** 批准后写入 `codument/product.md`

6. **提交状态：** 写入 `{"last_successful_step": "2.2_product"}`

7. **继续：** 立即进入下一节

### 2.3 选择工作流（交互式）

1. **介绍：** 宣布将配置开发工作流

2. **提问：**
   > "你想使用默认工作流还是自定义？"
   > 默认工作流包括：
   > - 测试驱动开发（TDD）
   > - 80% 代码测试覆盖率
   > - 每个任务后提交更改
   >
   > A) 默认
   > B) 自定义
   （使用 **Protocol: ask-single-question-closed**）

3. **如果自定义（选项 B）：**
   - **问题 1：** "测试代码覆盖率要求？（默认 >80%）"（使用 **Protocol: ask-single-question-free**）
   - **问题 2：** "每个任务后还是每个阶段后提交？"（使用 **Protocol: ask-single-question-closed**）
   - **问题 3：** "是否使用 TDD 流程？"（使用 **Protocol: ask-single-question-closed**）

4. **生成 workflow.md：** 根据选择生成工作流配置

5. **写入文件：** 写入 `codument/workflows/workflow.md`

6. **提交状态：** 写入 `{"last_successful_step": "2.3_workflow"}`

### 2.4 总结

1. **总结操作：** 展示第一阶段所有操作摘要



