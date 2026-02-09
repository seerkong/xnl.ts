---
description: Archive a completed track
allowed-tools: All
---
# codument archive - 归档命令

**描述：** 归档已完成的变更追踪

---

## 1.0 系统指令

你是 Codument 规范驱动开发框架的 AI 代理助手。当前任务是归档已完成的 track。

---

## 2.0 归档流程

### 2.1 确定 Track ID

1. **检查输入：**
   - 如果提示词包含具体 track ID，使用该值
   - 如果对话中模糊引用了 track，运行 `codument list` 显示候选项并确认（使用 **Protocol: ask-single-question-closed**）
   - 否则，询问用户要归档哪个 track（使用 **Protocol: ask-single-question-free**）

2. **验证 Track：**
   - 运行 `codument list` 验证 track ID
   - 如果 track 缺失、已归档或未准备好，停止并通知用户

### 2.2 执行归档

1. **检查 Track 状态：**
   - 读取 `codument/tracks.md` 确认 track 状态为 `[x]`（已完成）
   - 如果未完成，警告用户并询问是否仍要归档（使用 **ask-single-question-closed**）

2. **创建归档目录：**
   - 如果 `codument/archive/` 不存在，创建它

3. **移动 Track 文件夹：**
   - 将 `codument/tracks/<track_id>/` 移动到 `codument/archive/YYYY-MM-DD-<track_id>/`

4. **更新规范（可选）：**
   - 读取 track 的 spec.md
   - 如果包含 `## ADDED Requirements`、`## MODIFIED Requirements` 或 `## REMOVED Requirements`：
     - 识别受影响的能力
     - 将增量变更应用到 `codument/specs/<capability>/spec.md`
     - 创建能力目录（如不存在）
   - 如果是纯工具变更（无规范增量），跳过此步骤

5. **更新 tracks.md：**
   - 从 `codument/tracks.md` 中移除已归档 track 的部分

6. **验证：**
   - 运行 `codument validate --strict` 确认归档后状态正确

7. **宣布完成：**
   > "Track '<track_id>' 已成功归档到 `archive/YYYY-MM-DD-<track_id>/`。"

---

## 3.0 规范更新逻辑

### 3.1 应用 ADDED Requirements

1. 检查 `codument/specs/<capability>/spec.md` 是否存在
2. 如果不存在，创建新文件并添加基础结构
3. 将 ADDED 部分的需求追加到规范文件

### 3.2 应用 MODIFIED Requirements

1. 在现有规范中找到对应的需求（按标题匹配）
2. 用修改后的内容完全替换原需求
3. 保留所有场景

### 3.3 应用 REMOVED Requirements

1. 在现有规范中找到对应的需求
2. 移除该需求及其所有场景
3. 可选：添加注释说明移除原因

---

## 4.0 参考

- 使用 `codument list` 确认 track ID
- 使用 `codument list --specs` 查看更新后的规范
- 检查归档后 `codument validate --strict` 通过


<ChangeId>
  $ARGUMENTS
</ChangeId>

