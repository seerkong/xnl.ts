---
description: Validate track or spec format
allowed-tools: All
---
# codument validate - 验证命令

**描述：** 验证规范和任务文件格式

---

# codument validate - 验证命令

**描述：** 验证规范和任务文件格式

---

## 1.0 系统指令

你是 Codument 规范驱动开发框架的 AI 代理助手。当前任务是验证 track 或 spec 的格式是否正确。

---

## 2.0 验证流程

### 2.1 确定验证目标

1. **解析参数：**
   - 如果提供了 `[item]`，验证特定 track 或 spec
   - 如果未提供，进入批量验证模式

2. **识别类型：**
   - 如果 `item` 存在于 `codument/tracks/`，验证为 track
   - 如果 `item` 存在于 `codument/specs/`，验证为 spec
   - 如果两者都存在或都不存在，使用 `--type` 参数消歧

### 2.2 验证 Track

对于 track 目录 `codument/tracks/<track_id>/`：

#### 2.2.1 结构验证

- [ ] `metadata.json` 存在且格式正确
- [ ] `spec.md` 存在
- [ ] `plan.xml` 存在且 XML 格式有效

#### 2.2.2 metadata.json 验证

```json
{
  "track_id": "必需，字符串",
  "type": "必需，feature|bug|chore|refactor 之一",
  "status": "必需，new|in_progress|completed|cancelled 之一",
  "created_at": "必需，ISO 8601 格式",
  "updated_at": "必需，ISO 8601 格式",
  "description": "必需，字符串"
}
```

#### 2.2.3 spec.md 验证

- [ ] 至少包含一个增量操作部分：
  - `## ADDED Requirements`
  - `## MODIFIED Requirements`
  - `## REMOVED Requirements`
  - `## RENAMED Requirements`
- [ ] 每个 `### Requirement:` 至少有一个 `#### Scenario:`
- [ ] Scenario 格式正确（使用 `#### Scenario:`，不是列表项）
- [ ] 需求使用规范性语言（SHALL/MUST）

#### 2.2.4 plan.xml 验证

- [ ] XML 格式良好（可解析）
- [ ] 包含 `<plan>` 根元素
- [ ] 包含 `<metadata>` 部分，包括 track_id、track_name、goal、status
- [ ] 包含 `<phases>` 部分
- [ ] 每个 `<phase>` 有 id 和 name 属性
- [ ] 每个 `<task>` 有 id、name、status、priority 属性（status: TODO|IN_PROGRESS|DONE|BLOCKED|CANCELLED）
- [ ] status 值有效：TODO|IN_PROGRESS|DONE|BLOCKED

### 2.3 验证 Spec

对于 spec 目录 `codument/specs/<capability>/`：

#### 2.3.1 结构验证

- [ ] `spec.md` 存在

#### 2.3.2 spec.md 验证

- [ ] 包含 `# <能力名称>` 一级标题
- [ ] 至少包含一个 `### Requirement:` 部分
- [ ] 每个需求至少有一个 `#### Scenario:`
- [ ] Scenario 格式正确
- [ ] 需求使用规范性语言

### 2.4 严格模式 (--strict)

使用 `--strict` 参数时执行额外检查：

#### Track 额外检查

- [ ] proposal.md 存在（如果是新 track）
- [ ] proposal.md 包含必需部分：背景、变更内容、影响范围
- [ ] design.md 格式正确（如果存在）
- [ ] 所有 Scenario 的 WHEN/THEN 格式正确
- [ ] 无重复的需求名称
- [ ] 任务 ID 唯一且符合命名规范

#### Spec 额外检查

- [ ] 无重复的需求名称
- [ ] 所有需求有唯一标识符
- [ ] design.md 存在且格式正确（如果能力复杂）

### 2.5 输出格式

#### 验证通过

```
✓ codument/tracks/add-user-auth/
  ✓ metadata.json - 有效
  ✓ spec.md - 有效 (3 个需求, 5 个场景)
  ✓ plan.xml - 有效 (2 个阶段, 8 个任务)

验证通过！
```

#### 验证失败

```
✗ codument/tracks/add-user-auth/
  ✓ metadata.json - 有效
  ✗ spec.md - 错误
    - 第 15 行: Requirement "User Login" 缺少 Scenario
    - 第 28 行: Scenario 格式错误，应使用 "#### Scenario:" 而非 "- Scenario:"
  ✓ plan.xml - 有效

验证失败！请修复以上错误后重试。
```

### 2.6 批量验证

当未指定 `[item]` 时：

1. 列出所有 `codument/tracks/` 下的 tracks
2. 列出所有 `codument/specs/` 下的 specs
3. 依次验证每个项目
4. 汇总结果：

```
批量验证结果:

Tracks:
  ✓ add-user-auth
  ✓ update-payment-flow
  ✗ fix-login-bug (2 个错误)

Specs:
  ✓ auth
  ✓ payment

总计: 4 通过, 1 失败
```

---

## 3.0 参考

### 常见错误及修复

| 错误 | 原因 | 修复 |
|------|------|------|
| "Requirement must have at least one scenario" | 需求下没有场景 | 添加 `#### Scenario:` 部分 |
| "Invalid scenario format" | 场景格式错误 | 使用 `#### Scenario: 名称` 格式 |
| "Invalid XML format" | plan.xml 语法错误 | 检查 XML 标签闭合 |
| "Missing required field in metadata" | metadata.json 缺少字段 | 添加所需字段 |
| "Track must have at least one delta" | spec.md 没有增量操作 | 添加 ADDED/MODIFIED/REMOVED 部分 |



<ChangeId>
  $ARGUMENTS
</ChangeId>

