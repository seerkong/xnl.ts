# Plan XML 规范

本文档定义了 Codument 中 plan.xml 文件的结构和格式规范。

## 概述

plan.xml 是 Codument 中用于追踪变更实现进度的结构化任务文件。它采用 XML 格式，支持：
- 结构化的层级关系（Phase → Task → Subtask）
- 丰富的元数据（优先级、工时、依赖、验收标准）
- 程序友好处理（XPath 查询、Excel 导出）
- 统计汇总（按阶段、优先级）

## 设计原则

1. **固定层级**：Phase → Task → Subtask
2. **属性优先**：元信息（id、name、status、priority）放在属性中
3. **内容描述**：详细描述放在元素的文本内容中
4. **可扩展**：允许增加可选字段，但不得破坏现有字段
5. **枚举收敛**：状态与优先级使用统一枚举

## 完整结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <metadata>
    <track_id>add-user-auth</track_id>
    <track_name>添加用户认证功能</track_name>
    <goal>实现用户登录和注册功能</goal>
    <created_at>2026-01-01T10:00:00Z</created_at>
    <updated_at>2026-01-01T15:30:00Z</updated_at>
    <status>in_progress</status>
    <commit_mode>auto</commit_mode>
  </metadata>

  <milestones>
    <milestone id="M1" name="基础认证">
      <target_date>2026-01-15</target_date>
      <deliverables>完成登录注册基础功能</deliverables>
    </milestone>
  </milestones>

  <phases>
    <phase id="P1" name="基础设施" milestone="M1">
      <goal>搭建认证基础架构</goal>
      <estimated_days>5</estimated_days>
      <tasks>
        <task id="T1.1" name="创建用户数据模型" status="DONE" priority="P0"
              estimated_days="2" commit="a1b2c3d">
          定义 User 模型，包含用户名、密码哈希、邮箱等字段
          <dependencies></dependencies>
          <owner>dev-team</owner>
          <acceptance_criteria>
            <criterion id="T1.1-AC1" checked="true">User 模型包含必要字段</criterion>
            <criterion id="T1.1-AC2" checked="true">数据库迁移脚本正常执行</criterion>
          </acceptance_criteria>
          <tech_stack>
            <item>TypeScript</item>
            <item>Prisma ORM</item>
          </tech_stack>
          <references>
            <ref>codument/specs/user-model/spec.md</ref>
            <ref>src/models/user.ts:15</ref>
          </references>
          <subtasks>
            <subtask id="T1.1.1" name="编写测试用例" status="DONE" estimated_hours="2"/>
            <subtask id="T1.1.2" name="实现 User 模型" status="DONE" estimated_hours="4"/>
          </subtasks>
        </task>
        <task id="T1.2" name="配置数据库连接" status="IN_PROGRESS" priority="P0"
              estimated_days="1">
          配置数据库连接池，支持连接复用和自动重连
          <dependencies>T1.1</dependencies>
          <acceptance_criteria>
            <criterion id="T1.2-AC1" checked="false">连接池正常工作</criterion>
          </acceptance_criteria>
          <subtasks>
            <subtask id="T1.2.1" name="编写连接测试" status="DONE" estimated_hours="1"/>
            <subtask id="T1.2.2" name="实现连接池" status="IN_PROGRESS" estimated_hours="3"/>
          </subtasks>
        </task>
        <task id="T1.3" name="实现 JWT 验证" status="TODO" priority="P1"
              estimated_days="2">
          实现 JWT token 的生成、验证和刷新机制
          <dependencies>T1.2</dependencies>
          <acceptance_criteria>
            <criterion id="T1.3-AC1" checked="false">Token 生成和验证正常</criterion>
            <criterion id="T1.3-AC2" checked="false">Token 刷新机制工作</criterion>
          </acceptance_criteria>
        </task>
      </tasks>
      <gate_criteria>
        <criterion>所有 P0 任务完成</criterion>
        <criterion>测试覆盖率 >80%</criterion>
        <criterion>无阻塞性 Bug</criterion>
      </gate_criteria>
    </phase>

    <phase id="P2" name="API 端点" milestone="M1">
      <goal>实现认证相关 API</goal>
      <estimated_days>3</estimated_days>
      <tasks>
        <task id="T2.1" name="登录接口" status="TODO" priority="P0" estimated_days="1">
          POST /api/auth/login 接口，验证用户凭证并返回 token
          <dependencies>T1.3</dependencies>
          <acceptance_criteria>
            <criterion id="T2.1-AC1" checked="false">正确凭证返回 token</criterion>
            <criterion id="T2.1-AC2" checked="false">错误凭证返回 401</criterion>
          </acceptance_criteria>
        </task>
        <task id="T2.2" name="注册接口" status="TODO" priority="P0" estimated_days="1">
          POST /api/auth/register 接口，创建新用户账户
          <dependencies>T1.3</dependencies>
          <acceptance_criteria>
            <criterion id="T2.2-AC1" checked="false">成功创建用户</criterion>
            <criterion id="T2.2-AC2" checked="false">重复邮箱返回错误</criterion>
          </acceptance_criteria>
        </task>
      </tasks>
      <gate_criteria>
        <criterion>所有 API 端点通过集成测试</criterion>
        <criterion>API 文档已更新</criterion>
      </gate_criteria>
    </phase>
  </phases>

  <validations>
    <validation id="V1" name="用户认证流程验证" status="TODO">
      验证完整的登录-操作-登出流程
      <checks>
        <check name="登录返回有效 token">测试登录接口返回 JWT</check>
        <check name="token 可访问受保护资源">使用 token 访问需认证的 API</check>
        <check name="无效 token 被拒绝">验证过期或伪造 token 被拒绝</check>
      </checks>
    </validation>
  </validations>

  <risks>
    <risk id="R1" name="密码存储安全风险" level="high">
      <impact>高</impact>
      <probability>低</probability>
      <mitigation>使用 bcrypt 加盐哈希，定期安全审计</mitigation>
    </risk>
  </risks>

  <summary>
    <total_phases>2</total_phases>
    <total_tasks>5</total_tasks>
    <total_subtasks>4</total_subtasks>
    <total_estimated_days>8</total_estimated_days>
    <completed>1</completed>
    <in_progress>1</in_progress>
    <todo>3</todo>
    <blocked>0</blocked>
    <by_priority>
      <p0 count="4" days="5"/>
      <p1 count="1" days="2"/>
    </by_priority>
  </summary>
</plan>
```

## 元素说明

### `<plan>` - 根元素

plan.xml 的根元素为 `<plan>`。Track 的唯一标识符在 `<metadata><track_id>...</track_id></metadata>` 中声明。

### `<confirm>` - 确认提示标记（可选）

用于让流程在特定阶段或任务执行前/后暂停并等待确认。支持人工确认或 AI 评审确认。

- **可放置位置**：`<phase>` 或 `<task>` 节点下
- **行为定义**：见 `codument/std/protocols.md`
- **可用协议**：`yield-human-confirm`、`yield-ai-confirm`
- **when**：`before` | `after` | `both`
- **status**：`TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED` | `CANCELLED`
- **ai-agent**：仅 `yield-ai-confirm` 需要，指定 subagent 名称
- **数量限制**：每个 `<phase>` 或 `<task>` 最多一个 `<confirm>`
- **顺序规则**：若 phase 与 task 同时配置，执行顺序为：phase-before → task-before → task-after → phase-after
- **重试规则**：若 confirm 未通过（人或 AI），必须修复后重新 review，直至 `status=DONE` 才能继续

**示例：**
```xml
<phase id="P1" name="基础设施">
  <goal>搭建认证基础架构</goal>
  <confirm protocol="yield-human-confirm" when="after" status="TODO" />
  <tasks>
    ...
  </tasks>
</phase>

<task id="T1.1" name="创建用户数据模型" status="TODO" priority="P0">
  定义 User 模型结构并实现基本 CRUD 操作
  <confirm protocol="yield-ai-confirm" ai-agent="codument-code-review" when="after" status="TODO" />
  <subtasks>
    ...
  </subtasks>
</task>
```

### `<metadata>` - 元数据

| 元素 | 必需 | 说明 |
|------|------|------|
| `track_name` | 是 | Track 的可读名称 |
| `goal` | 是 | Track 的目标描述 |
| `created_at` | 是 | 创建时间，ISO 8601 格式 |
| `updated_at` | 是 | 最后更新时间，ISO 8601 格式 |
| `status` | 是 | 状态：new, in_progress, completed, cancelled |
| `commit_mode` | 是 | 提交模式：auto（自动提交+Git Notes）, manual（手动提交） |

### `<milestones>` - 里程碑列表（可选）

包含一个或多个 `<milestone>` 元素。

### `<milestone>` - 里程碑

| 属性/元素 | 必需 | 说明 |
|-----------|------|------|
| `id` 属性 | 是 | 里程碑 ID，格式 M1, M2, ... |
| `name` 属性 | 是 | 里程碑名称 |
| `<target_date>` | 是 | 目标日期 |
| `<deliverables>` | 是 | 交付物描述 |

### `<phases>` - 阶段列表

包含一个或多个 `<phase>` 元素。

### `<phase>` - 阶段

| 属性/元素 | 必需 | 说明 |
|-----------|------|------|
| `id` 属性 | 是 | 阶段 ID，格式 P1, P2, ... |
| `name` 属性 | 是 | 阶段名称 |
| `milestone` 属性 | 否 | 关联里程碑 ID |
| `<goal>` | 是 | 阶段目标 |
| `<estimated_days>` | 否 | 预估工时（天） |
| `<tasks>` | 是 | 任务列表 |
| `<gate_criteria>` | 否 | 阶段门控标准 |

### `<task>` - 任务

| 属性 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 任务 ID，格式 T1.1, T1.2, ... |
| `name` | 是 | 任务名称（简短） |
| `status` | 是 | 状态：TODO, IN_PROGRESS, DONE, BLOCKED, CANCELLED |
| `priority` | 是 | 优先级：P0（紧急）, P1（高）, P2（中） |
| `estimated_days` | 否 | 预估工时（天） |
| `commit` | 否 | 完成时的 commit SHA（DONE 后填写） |
| `blocker` | 否 | 阻塞原因（BLOCKED 时填写） |

**任务内容（text content）**：任务的详细描述，说明具体要做什么。

**子元素**：

| 元素 | 必需 | 说明 |
|------|------|------|
| `<dependencies>` | 否 | 依赖任务 ID，多个用逗号分隔 |
| `<owner>` | 否 | 负责人 |
| `<acceptance_criteria>` | 否 | 验收标准列表 |
| `<tech_stack>` | 否 | 技术栈列表 |
| `<references>` | 否 | 参考资料列表 |
| `<subtasks>` | 否 | 子任务列表 |

### `<acceptance_criteria>` - 验收标准

```xml
<acceptance_criteria>
  <criterion id="T1.1-AC1" checked="false">验收标准描述</criterion>
</acceptance_criteria>
```

| 属性 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 验收标准 ID，格式 T1.1-AC1 |
| `checked` | 是 | 是否已验证：true/false |

### `<subtask>` - 子任务

**子任务使用自闭合标签，所有信息放在属性中**：

```xml
<subtask id="T1.1.1" name="子任务名称" status="TODO" estimated_hours="2"/>
```

| 属性 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 子任务 ID，格式 T1.1.1, T1.1.2, ... |
| `name` | 是 | 子任务名称 |
| `status` | 是 | 状态：TODO, IN_PROGRESS, DONE, BLOCKED, CANCELLED |
| `estimated_hours` | 否 | 预估工时（小时） |

### `<gate_criteria>` - 阶段门控标准

```xml
<gate_criteria>
  <criterion>所有 P0 任务完成</criterion>
  <criterion>测试覆盖率 >80%</criterion>
</gate_criteria>
```

阶段完成前必须满足所有门控标准。

### `<validations>` - 验收验证

包含一个或多个 `<validation>` 元素，用于定义功能验收标准。

### `<validation>` - 验证项

| 属性 | 必需 | 说明 |
|------|------|------|
| `id` | 是 | 验证 ID，格式 V1, V2, ... |
| `name` | 是 | 验证名称 |
| `status` | 是 | 状态：TODO, PASSED, FAILED |

**子元素**：

| 元素 | 必需 | 说明 |
|------|------|------|
| `<checks>` | 否 | 检查项列表 |

### `<risks>` - 风险登记（可选）

```xml
<risks>
  <risk id="R1" name="风险描述" level="high">
    <impact>高</impact>
    <probability>中</probability>
    <mitigation>缓解措施</mitigation>
  </risk>
</risks>
```

| 属性/元素 | 必需 | 说明 |
|-----------|------|------|
| `id` 属性 | 是 | 风险 ID，格式 R1, R2, ... |
| `name` 属性 | 是 | 风险名称 |
| `level` 属性 | 是 | 风险等级：high, medium, low |
| `<impact>` | 是 | 影响程度 |
| `<probability>` | 是 | 发生概率 |
| `<mitigation>` | 是 | 缓解措施 |

### `<summary>` - 统计摘要

| 元素 | 说明 |
|------|------|
| `total_phases` | 阶段总数 |
| `total_tasks` | 任务总数 |
| `total_subtasks` | 子任务总数 |
| `total_estimated_days` | 总预估天数 |
| `completed` | 已完成任务数 |
| `in_progress` | 进行中任务数 |
| `todo` | 待处理任务数 |
| `blocked` | 阻塞任务数 |
| `by_priority` | 按优先级统计 |

## 状态值

### Track 状态
- `new` - 新建，尚未开始
- `in_progress` - 进行中
- `completed` - 已完成
- `cancelled` - 已取消

### 任务/子任务状态
- `TODO` - 待处理
- `IN_PROGRESS` - 进行中
- `DONE` - 已完成
- `BLOCKED` - 被阻塞
- `CANCELLED` - 已取消

### 验证状态
- `TODO` - 待验证
- `PASSED` - 验证通过
- `FAILED` - 验证失败

### 优先级
- `P0` - 必须完成（影响核心功能）
- `P1` - 重要（非关键路径但重要）
- `P2` - 可选（有则更好）

### 提交模式
- `auto` - 自动提交模式：任务完成后自动 commit 并附加 Git Notes
- `manual` - 手动提交模式：用户自行控制提交时机

## ID 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| Track ID | `<动词>-<名词>` | `add-user-auth`, `fix-login-bug` |
| 里程碑 | M{序号} | M1, M2, M3 |
| 阶段 | P{序号} | P1, P2, P3 |
| 任务 | T{阶段}.{任务} | T1.1, T2.3 |
| 子任务 | T{阶段}.{任务}.{子任务} | T1.1.1, T1.1.2 |
| 验收标准 | T{任务ID}-AC{序号} | T1.1-AC1, T2.3-AC2 |
| 验证 | V{序号} | V1, V2, V3 |
| 风险 | R{序号} | R1, R2, R3 |

## TDD 任务模式

当 workflow.md 指定 TDD 流程时，每个功能任务应拆分为：

```xml
<task id="T1.1" name="实现用户模型" status="TODO" priority="P0" estimated_days="2">
  定义 User 模型结构并实现基本 CRUD 操作
  <acceptance_criteria>
    <criterion id="T1.1-AC1" checked="false">测试覆盖率 >80%</criterion>
    <criterion id="T1.1-AC2" checked="false">所有测试通过</criterion>
  </acceptance_criteria>
  <subtasks>
    <subtask id="T1.1.1" name="编写测试用例" status="TODO" estimated_hours="2"/>
    <subtask id="T1.1.2" name="实现功能（通过测试）" status="TODO" estimated_hours="4"/>
    <subtask id="T1.1.3" name="重构优化" status="TODO" estimated_hours="1"/>
  </subtasks>
</task>
```

## 阶段门控协议

每个阶段完成时，必须验证 `<gate_criteria>` 中的所有标准：

1. **自动检查**：运行测试、检查覆盖率、Lint 检查
2. **生成验证报告**：列出所有检查项及结果
3. **确认（可选）**：仅当 `<phase>` 下存在 `<confirm protocol="yield-human-confirm" .../>` 或 `<confirm protocol="yield-ai-confirm" .../>` 且 when 包含 `after` 时，执行确认
4. **创建检查点**（auto 模式）：`git commit -m "checkpoint: Phase P1 complete"`
5. **附加 Git Notes**（auto 模式）：记录验证报告

## 验证规则

1. **必需元素**：metadata、phases、至少一个 phase、至少一个 task
2. **ID 唯一性**：所有 ID 在文件内必须唯一
3. **依赖有效性**：dependencies 中的 ID 必须存在
4. **状态一致性**：父元素状态应反映子元素状态
5. **时间格式**：使用 ISO 8601 格式
6. **XML 格式**：必须是格式良好的 XML

## XPath 查询示例

```xpath
# 获取所有未完成的任务
//task[@status='TODO']

# 获取所有 P0 优先级任务
//task[@priority='P0']

# 获取特定阶段的所有任务
//phase[@id='P1']/tasks/task

# 统计已完成的子任务数量
count(//subtask[@status='DONE'])

# 获取有依赖的任务
//task[dependencies != '']

# 获取特定里程碑下的阶段
//phase[@milestone='M1']

# 获取所有未通过的验收标准
//criterion[@checked='false']
```

## 示例：最小 plan.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <metadata>
    <track_name>修复登录 Bug</track_name>
    <goal>修复用户无法登录的问题</goal>
    <created_at>2026-01-01T10:00:00Z</created_at>
    <updated_at>2026-01-01T10:00:00Z</updated_at>
    <status>new</status>
    <commit_mode>manual</commit_mode>
  </metadata>

  <phases>
    <phase id="P1" name="修复">
      <goal>定位并修复 Bug</goal>
      <tasks>
        <task id="T1.1" name="复现问题" status="TODO" priority="P0">
          在本地环境复现登录失败的问题，记录错误日志
          <acceptance_criteria>
            <criterion id="T1.1-AC1" checked="false">问题已复现</criterion>
          </acceptance_criteria>
        </task>
        <task id="T1.2" name="编写回归测试" status="TODO" priority="P0">
          编写测试用例覆盖登录失败的场景
          <dependencies>T1.1</dependencies>
          <acceptance_criteria>
            <criterion id="T1.2-AC1" checked="false">测试覆盖失败场景</criterion>
          </acceptance_criteria>
        </task>
        <task id="T1.3" name="修复 Bug" status="TODO" priority="P0">
          根据错误日志定位问题并修复
          <dependencies>T1.2</dependencies>
          <acceptance_criteria>
            <criterion id="T1.3-AC1" checked="false">所有测试通过</criterion>
          </acceptance_criteria>
        </task>
      </tasks>
      <gate_criteria>
        <criterion>所有测试通过</criterion>
        <criterion>回归测试覆盖修复场景</criterion>
      </gate_criteria>
    </phase>
  </phases>

  <validations>
    <validation id="V1" name="登录功能验证" status="TODO">
      验证登录功能正常工作
      <checks>
        <check name="正常登录">使用正确的用户名密码可以登录</check>
        <check name="错误提示">使用错误密码显示正确的错误信息</check>
      </checks>
    </validation>
  </validations>

  <summary>
    <total_phases>1</total_phases>
    <total_tasks>3</total_tasks>
    <completed>0</completed>
    <in_progress>0</in_progress>
    <todo>3</todo>
    <blocked>0</blocked>
  </summary>
</plan>
```
