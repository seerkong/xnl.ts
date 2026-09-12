# DEPA 架构吸引子（DEPA Architecture Attractor）

> 这份文档定义一个采用 DEPA 思想（**D**ata / **E**ffect / **P**rocessor / **A**ctor）的项目**应当长期收敛到的稳定结构**。它不是清单、不是路线图、不是允许范围的边界，而是用**少数高层不变量**隐式定义的吸引子：局部实现可以千变万化，整体始终被这些关系拉回同一类形状。像"定义流形的方程"——不预先写出每个合法点，只规定哪些关系必须成立；满足关系的代码自然落进同一结构。
>
> **三层区分**：吸引子本体 = §3 的硬不变量；本文件 = 吸引子的**载体**（可版本化、可审计）；代码 = 吸引子的**瞬时投影**。三者不冲突——问"当前行为如何"以代码为准，问"该收敛到哪"以本文件为准，问"为什么弃某路"以分析/日志为准。

---

## 0. 怎么用这份吸引子

- **它做什么**：规定 DEPA 项目里哪些原语合法、哪些依赖方向合法、哪些 owner 边界不可破、哪些老结构已不属于正确状态空间。它的价值不是描述一切，而是**让错误结构无法合法存续**。
- **它不做什么**：不枚举每个正确实现，不替代代码/类型/测试做"当前行为"的事实源，不充当任务清单。一次违反未必立刻报错，但**持续偏离会腐蚀结构**——吸引子治的是"扰动下的稳定性"，不是"越界即错"的护栏。
- **优先级边界**：技术结构与跨模块规则以本文件为准；单次行为语义以代码/类型/测试为准；持久化 / schema 真相以真实 model/schema 文件为准。
- **判据不是库**：DEPA 的参照实现可以是某些 data-graph / processor / actor / 标准组件库，但判据是**维度与不变量**，不是这些库。任何语言、任何技术栈，只要满足下面的关系，就落在吸引子里。
- **可移植使用**：本文件可作为项目的架构 owner doc，或被项目 `AGENTS.md` / 设计文档引用。设计、开发、重构与 review 都以它作结构判据；遇到业务行为、schema 或兼容性冲突时，保留本文件的方向，同时以对应事实源决定局部实现。
- **owner 不混用**：`data owner` 是某份数据唯一的权威写入者；`owner boundary` 是它的写入与依赖边界；`owner doc` 是承载架构规则的文档。后者不拥有业务数据。

---

## 1. 一句话吸引子（the equation）

一个 DEPA 系统收敛到这组相互定义的关系上：

```text
output = fn(runtime, input, config)        显式函数边界：依赖注入；纯计算保持纯，副作用只经注入契约
output = fn(runtime, selector, invocation, config) 目标寻址入口：闭合选择声明与操作语义分列，runtime 负责解析与调度
runtime = 数据(大部分) + effect 契约(少部分) + actor 依赖(复杂时)   是载体，不写逻辑
data    = topology(schema, authority, relations, lifecycle)  数据语义、裁决权、转换与生命周期显式
output  = projection(authority)            衍生关系单向；需要改变事实时请求 authority transition
process = 数据血缘(D) 串 纯处理器(P)        标准封装；分发用注册表，不用 if/elif 长链
协作    = 同步 command / 异步 message       跨边界、等外部、要调度的走 mailbox
依赖    = 单向无环                          出现环 / 共享可变状态 → 把一节点 actor 化
组织    = capsule                          单入口、internals 隐藏、对外只暴露稳定契约
复杂度  = 由真实需求驱动                     vendor 原语优先，不为"将来可能"堆抽象
```

后面每节把其中一条展开成可判定的形态、信号与排除集。

---

## 2. 基本原语（封闭集）

DEPA 的核心维度与关系词汇保持稳定；事实节点的 `semantic_role`、`authority_model`、生命周期和具体范式标签则是开放集合。系统里每个关键结构应能说明其维度、边界与事实关系；不能说明或与已声明关系冲突，才是漂移信号。事件、投影、snapshot、Signal/Stream 等属于按架构证据出现的词汇，不是所有系统必备的封闭原语。

| 原语 | 是什么 | 维度 |
|------|--------|------|
| **数据节点 data node** | 带结构、语义、角色、authority model 与生命周期的分析对象 | Data |
| **有向关系 relation** | owns/records/restores/projects/replicates/caches/observes/commands 等事实关系 | Data |
| **transition boundary** | 改变 authority 的受控边界；可由事务、repository、API、owner 或消息入口实现 | Data |
| **事件 / 投影 / 快照** | 在相应架构中出现的 record、observation 或 recovery material；角色由证据决定 | Data profile |
| **runtime** | 长生命周期依赖与状态的**数据载体**（D 主 + E 少 + A 时含） | D/E/A |
| **input / config** | 单次调用的 payload / 静态枚举开关 | Effect |
| **selector** | 一次 invocation 的 profile-owned 闭合选择声明；不是直接对象或解析后的目标集合，解析、权限、基数与批处理归 runtime | Data / Processor |
| **invocation** | 一次不可变操作的语义封套：`type`、可选 `kind`、`payload`、metadata；可同步产生，也可被投递 | Data / Processor |
| **核心逻辑 fn** | `fn(runtime, input, config)` 的显式函数边界：纯计算不混 IO；需要副作用时只调用 runtime 中注入的 effect 契约，绝不自行取得具体实现 | Effect |
| **副作用契约 effect** | “怎么产生副作用”的契约/工厂：声明在 runtime、由 support 提供具体实现 | Effect |
| **处理器 / adapter** | outer↔inner 转换的 adapter 是 `data→data` 纯函数；core 是同一封装链中的业务处理器，若需 IO 仅经注入的 effect 契约 | Processor |
| **分发引擎 dispatch** | 枚举 id → handler 的可组合注册表（动态路由时用） | Processor |
| **command / message** | 同步命令（同栈）/ 异步消息（经 mailbox） | Processor / Actor |
| **actor + mailbox** | 单一所有权的并发/解环单元，外部经消息读写 | Actor |
| **capsule** | 单公开入口、internals 隐藏、对外只暴露稳定契约的模块单元 | 组织 |
| **事实角色 fact-role** | 数据节点的 semantic role + authority model + relation | 事实源 |
| **authority owner** | 在声明范围内拥有最终裁决权、汇聚受控 transition 的节点；不是所有值都需要 owner | Data |

---

## 3. 硬不变量（the invariants）

吸引子的"方程"就是下面这组高层不变量。它们少而硬：局部怎么写都行，但这些关系不能破。结构性的几条给出语言中立的形态对照（`✅` 收敛态 / `❌` 排除态）。

### I1 · 数据与逻辑分离
核心逻辑能写成 `output = fn(runtime, input, config)`，依赖全显式、不读全局/单例/`this`，副作用经注入的契约发生。

```text
❌ core 读隐式全局、直接 IO
   function handleChat(req) {
     const db = getGlobalDb()                 // 隐式全局
     logger.info("creating")                  // 隐式全局
     return db.users.create(req.body)         // 直接 IO 写在 core
   }
✅ 依赖注入、副作用只经契约（纯计算仍保持纯）
   function createUser(runtime, input, config) {     // fn(runtime,input,config)
     runtime.logger.info("creating")          // 注入的契约
     return runtime.db.users.create(input.data)       // 注入的 effect 契约
   }
```

### I2 · runtime 是数据载体
runtime 只装数据与依赖引用，**不写业务方法**。它是 Data（大部分）+ Effect 契约（少部分）+ Actor 依赖（复杂时）三维的共同展开，不专属某一维。

```text
❌ runtime 容器内嵌业务方法（数据与逻辑混在一起，无法单测/替换）
   OrderRuntime { orderDb, paymentClient, runCheckout(cart){ ...扣款扣库存写单... } }
✅ runtime 纯数据；逻辑外置成以 runtime 为首参的函数
   OrderRuntime  { orderDb, paymentClient }
   runCheckout(runtime, cart, config) -> Receipt { ... }
```

### I3 · 参数归位
长生命周期/共享/跨步骤状态 → `runtime`；单次 payload → `input`；单次静态枚举/开关 → `config`。
破：稳定依赖（registry/client/session）偷渡进 input/config；函数对象塞进 config；config 重复 runtime 已有字段（两处真源必漂移）。

交互式、目标寻址入口使用 `fn(runtime, selector, invocation, config)`：`selector` 是闭合选择声明，只说明“对谁做”，`invocation` 只说明“做什么”，二者不互塞；runtime 解析 selector、做可见性/权限/基数/排序/批处理，config 不承载动态消息调度。解析后的 targets 仅存在于 runtime 内部。`invocation` 可以被同步调用；只有跨 actor/mailbox 投递时才是 `message`。

**前端简例（选中表格行后批量改角色）**：UI 只把选中项转换成 profile selector，并产生 `invocation`；handler 把解析、授权和批处理交给 runtime，返回结构化结果。

```ts
async function bulkEditUsers(runtime, selector, invocation, config) {
  return runtime.selectors.authorizeResolveAndBatch({
    selector,                                     // { byRefs: ["users://row/42"] }，不是 DOM/行对象
    invocation,                                      // { type: 'users.bulk-edit', payload: { patch } }
    config,                                          // { mode: 'best-effort', maxConcurrency: 8 }
    perform: (rows) => runtime.effects.users.applyRolePatch(rows, invocation.payload.patch),
  });
}

// output = { applied: { updated: [...] }, rejected: [{ ref, reason }] }
```

```text
❌ 稳定依赖偷渡进 input、函数对象塞 config
   input  = { userQuery, dbClient }            // dbClient 长生命周期 → 该进 runtime
   config = { onDone: () => {...} }            // 函数对象 → 是 effect 契约，该进 runtime
✅ 各归其位
   runtime = { dbClient, onDone }              // 长生命周期依赖 + 副作用契约
   input   = { userQuery }                     // 单次 payload
   config  = { mode: "fast" }                  // 静态枚举 / 开关
```

### I4 · 副作用契约与编排分离
effect 以契约/工厂声明在 runtime，编排在 factory/bootstrap，core 只调注入的契约。package 层以 `contract | logic | support | adapter | capsule | shell` 表达首要职责：logic 与 support 都依赖公开 contract，logic 不 import 具体 support，capsule/shell 才在公开边界组装所需 closure；完整判据见 [`fa/protocols/package-role-protocol.md`](fa/protocols/package-role-protocol.md)。
破：contract 文件里写副作用编排；core 直接 import 具体 support；应用级 registry 只经全局变量传；package 名的 role 与实际职责不一致。

```text
❌ 契约 + 编排 + 具体实现糊在一起
   class PaymentContract { charge(a){ new StripeClient(KEY).charge(a) } }  // 三者混进契约
✅ 契约声明 / 编排在 bootstrap / core 只调契约
   interface PaymentEffect { charge(a): Promise<Receipt> }   // 契约：怎么产生
   runtime.payment = makeStripePayment(cfg)                  // 编排：在 bootstrap 组装
   // core: await runtime.payment.charge(a)                  // core 只调注入的契约
```

### I5 · 单一 authority owner + 受控 transition + 衍生不反写
一份当前真相只有一个 authority owner；事件、signal、mutation、dispatch、action、recovery 可以是多个受控 transition 入口，但不能绕过 owner 形成第二真相。投影/缓存/视图只读来源；历史通过追加补偿或新版本纠正；当前状态尽量能从声明的记录或 transition 重建。

```text
❌ 投影反写源 / 两个半真源同时生效
   cache.set(id, v); writeBackToLog(v)        // 投影绕过 owner 回写来源
✅ 单 owner + 多个受控入口
   owner.dispatch({ type: "OrderPaid", id }) // command 进入唯一 owner
   owner.state = transition(owner.state, event) // owner 内部应用 transition
```

### I6 · 标准封装：数据血缘(D) 与处理器(P) 分列
一段调用从 outer 进、回 outer 出，是**一条显式数据血缘**被**一组处理器**串起来——转换处理器是 `data→data` 的纯函数；core 遵守 I1/I4 的注入 effect 边界。数据是名词、处理器是逻辑，**两块分开**，绝不在同一格 / 同一无差别箭头链里混（详见 §7）。
破：把 `Outer Input → Transform → Core → Outer Output` 这种数据名词与逻辑动词混排，当成"流程图"。

### I7 · 受控分发
动态路由用枚举 id → adapter 注册表，新增策略不改已有代码；逻辑固定（Sequence/Selector/Condition）不套分发。

```text
❌ if/elif 字符串分发（加一种类型就改这块）
   if (t==="create") return handleCreate(x)
   else if (t==="update") return handleUpdate(x) ...
✅ 枚举 id → adapter 注册表（新增不改已有代码）
   registry.get(t)(x)                          // 未知 id 显式报错，不静默回退
```

### I8 · command / message 边界
同步、可立即返回、同调用栈的走 command；跨 actor、等外部、需 timeout/retry/cancel/priority 的走 message（经 mailbox）。
破：跨边界协作写成同步直调（丢掉排队/调度/恢复）；纯本地同步逻辑硬塞进消息队列绕一圈。

```text
❌ 跨边界、要等外部，却同步直调
   const r = otherActor.handleNow(req)         // 丢掉排队 / 超时 / 恢复能力
✅ command（同栈同步）/ message（跨边界异步）
   reducer(state, cmd)                          // 同步 command：可立即返回
   mailbox.send({ type:"DoWork", req })         // 异步 message：经 mailbox，可 timeout/retry
```

### I9 · 依赖单向无环
模块/包/数据/控制各层依赖图都应是有向无环图。

```text
❌ 隐式 DI 藏环：A import B，B 靠 service locator / 延迟注入反取 A —— 编译器看不见环
✅ 本质环 → 把一节点 actor 化：A 向 B 发 message，依赖回到单向 A → B，环替换成显式异步边界
```

### I10 · capsule 组织
模块对外只有一个稳定入口，internals 隐藏不可外部 import，对外只暴露 public types。

```text
✅ capsule 形态
   order/
     core_logic        # 唯一对外入口 run_order(input, config) -> OrderOutput
     adapter_registry  # 枚举 id → adapter 布线
     internals/        # 私有实现，外部不可 import
     types             # 对外稳定契约（OrderInput / OrderOutput）
   外部只 import { run_order, OrderInput, OrderOutput }；多 capsule 依赖呈单向链 A → B → C
```

### I11 · 避免过度设计
复杂度由当前真实需求驱动，vendor/标准库已有原语优先。
破：同构却套空壳透传 adapter；只有一个实现的策略表/抽象基类；"以防万一"无人用的开关；手搓已有的调度/序列化/重试/状态机。

### I12 · 观测优先于猜测
每个"X 有问题 / 这样改"的论断都要能指向证据（代码 `path:line` / 运行现象 / 测试）；缺证据时不盲猜——先在可观测基座上加观测点 / sink、记录证据，再分析修复，而非临时 print 或用"通常/应该"替代。

### I13 · 框架中立、做机制不做特例
底层设计保持通用，不为单个业务场景破坏通用性——**做机制，不做特例**。问题表面只在某个 app/场景出现时，优先找**通用根因**（runtime / provider / prompt 组装 / 持久化 / 协议管线），而非给那个场景打补丁。
破：为达成一次验证而限制工具列表 / 硬编码业务名 / 压某请求的上下文 / 改某 provider 行为；为单个 app 在底层加特例分支。

---

## 4. 四维的收敛形态（D / E / P / A）

> **为什么切成这四维**：一段处理逻辑要回答四个相互独立的问题——数据怎么组织（结构、authority、转换、关系和生命周期是否明确）、副作用怎么隔离（依赖能否显式注入、逻辑能否纯化）、处理怎么标准（封装是否同构、分发是否受控）、协作怎么解耦（跨边界是否经显式消息、共享状态归谁）。四个问题彼此正交，所以拆成四维分别判，避免“一处对了就以为整体对了”。
>
> 四维**正交**：一段代码可以某维符合、另一维违反，各判各的（例：`fn(runtime,input,config)` 干净【Effect 符合】，但分发硬编码成一长串 if-else【Processor 违反】）。

### Data — 数据一等公民
- **收敛形态**：结构与语义先于操作；关键事实的 authority model、owner、transition、relation 与 lifecycle 可解释；衍生关系单向，不绕过 authority boundary。
- **符合信号**：存在可定位的 schema/type/contract；写入/转换边界清楚；record/recovery/cache/view 的角色与方向可追踪；一致性、恢复和失效语义与需求相称。
- **违反信号**：多个独立 authority；下游反写来源；关系未声明；一致性承诺与实现冲突；关键结构只能从散落逻辑猜测。
- **可选 profile**：有 canonical event authority 时追加 EventSourcedStateProfile；有响应式运行时图时追加 ReactiveDataGraphProfile。未激活一律 `NOT_APPLICABLE`。

### Effect — 副作用与逻辑分离
- **收敛形态**：`output = fn(runtime, input, config)`；依赖经 runtime 显式注入；副作用契约声明在 runtime、真正 IO 在 support；logic 与 support 都依赖公开 contract，logic 不直接依赖具体 support。
- **符合信号**：签名一眼看全部依赖；runtime 可换 mock 来测；core 只调注入的契约；config 为 null 或纯静态值。
- **违反信号**：core 读全局/单例/环境变量、现 new client、直接 IO；契约与编排糊在一起；`runtime: { everything: any }` 巨型上下文。

### Processor — 标准封装与受控分发
- **收敛形态**：所有组件走同一条封装流程（D 血缘 + P 处理器分列，core 是"读入恰好是 (runtime,input,config)"的业务处理器，副作用边界遵守 I1/I4）；动态路由用可组合分发引擎；command/message 边界清晰。
- **符合信号**：组件同构、执行路径可预测；core 不做路径解析/错误包装等框架关注点；新增路由不改已有代码。
- **违反信号**：执行路径各异；硬编码 if/elif 分发；core 处理框架关注点；同步伪装异步或异步硬塞同步。

### Actor — 异步通信与解环
- **收敛形态**：依赖图出现本质环、或多模块共享可变状态时，把一节点定义成 actor，用声明的 command/message ingress 协作；单一所有权，投递、调度与 lifecycle 语义明确；selective receive 等能力只按需求采用。
- **符合信号**：共享态收进单一 owner，外部经消息读写；timeout/retry/cancel/priority 走 message；调度（fiber/task）与身份（actor）分离。
- **违反信号**：并发任务直接 mutate 共享对象；满屏裸锁糊共享状态替代消息；用隐式 DI 藏循环依赖。
- actor 首先为**打断环、显式化共享状态所有权**而用，并发只是顺带。

---

## 5. 事实角色与 authority 边界（state-truth 结构）

"谁是某份数据的 authority、哪些关系允许写入"是最容易腐蚀、也最承重的结构。吸引子要求每个关键数据节点能被标注 role/model/relation，并明确 owner。

事实节点不再被强行排成固定七级阶梯。每个节点标注 `semantic_role`、`authority_model`、`authority owner` 和有向 `relation`；常见角色包括 current authority、historical record、runtime control、recovery material、derived observation。

```text
current_authority ──records──▶ historical_record
       │                           │
       ├──projects──▶ derived_observation
       └──commands◀── surface / recovery / action
historical_record ──replays/restores──▶ current_authority
```

**边界规则**（破任一即结构漂移）：
- **单一 authority owner**：多个物理写点或 transition 入口不等于多个 owner；多个独立 owner 同时决定同一真相才是冲突。
- **衍生不反写**：derived observation 只能通过 command/event 请求 owner transition，不直接覆盖来源。
- **恢复边界显式**：checkpoint/journal/record 只有在声明的 recovery/control 关系中参与 live；不能暗中成为第二 authority。
- **记录规则服从声明语义**：若 record 被声明为不可变历史，则用补偿记录、新版本或受控 ref transition 纠正；普通 mutable authority 不因允许 update 而违反。
- **UI 只发命令**：surface/observation 通过 command/message 请求 owner，不直接写事实。

**worked 例**："这个订单流程是否在跑？" → 读 runtime control owner 的 live state；不读 checkpoint/journal 的 mtime、存在性或末尾记录来猜测。checkpoint 只有在声明的 recovery relation 中恢复 owner，不能悄悄成为第二 control authority。

---

## 6. runtime 的收敛形态

runtime **没有唯一正确形状**——丰俭由人，按业务复杂度在谱系上取一点。吸引子约束的是**不变量**，不是层数/字段名。下面用同一个业务（订单/结算服务）从薄到厚示范。

**形态谱系**（可叠加）：
- **A 最小扁平**：几把显式依赖平铺。`OrderRuntime { orderDb, clock, logger }`
- **B 角色分组**：按角色与生命周期聚合——副作用契约 / 配置 / 外部上下文(请求级只读) / 内部上下文(跨步骤可变) / 数据快照(immutable+mutable)。新增子字段不破坏签名。
- **C 跨域嵌套**：一个域 runtime 内嵌另一个域 runtime（单向）。`WriteRuntime { read: ReadRuntime, orderDb, eventLog }`
- **D 响应式衍生**：private 可写源 + public 只读投影，外部只拿 public 只读流。
- **E 领域分面/组合根**：多领域分面 + 归属表（谁有权写哪块）；组合根**只是 carrier**，自己不放业务逻辑。

B 形态（最常见的中等复杂度）具体长这样——字段按角色与生命周期聚合，新增依赖往对应聚合里加子字段、签名不变：

```text
OrderRuntime {
  effects:  { makePaymentClient, makeInventoryClient }   // 副作用契约 / factory（进程级）
  options:  { maxRetries, currency }                     // 静态配置（默认值，便于演进）
  outerCtx: frozen  { tenantId, callerId, requestedAt }  // 外部上下文：请求级只读
  innerCtx: mutable { reservedStock, attempt }           // 内部上下文：跨步骤可变
  snapshot: { catalog: frozen, cart: mutable }           // 数据镜像：不可变 + 可变分开
}
```

**跨形态不变量**（A–E 都必须成立）：
1. 数据不放逻辑（容器里不写执行方法）。
2. 显式注入（无隐式全局自取）。
3. 三参数归位（runtime / input / config）。
4. 可变 / 不可变分清（frozen 外部上下文 vs 可变内部上下文，别互塞）。
5. 衍生是衍生、不是第二真源（public 投影/快照可重建、源真唯一）。
6. 可演进（聚合字段扩展不破坏签名；但不为"将来可能"提前堆复杂度）。

> 选形态看业务复杂度，不看"标准答案"：依赖成堆还在扁平平铺 / 可变与不可变混在一起 → 往 B/D 升；三五个依赖却套五层聚合、没订阅需求却引入响应式层 → 往 A/B 降。

---

## 7. 标准组件流程（canonical processing shape）

一段逻辑从 outer 边界进、回 outer 边界出。**数据与处理器两块分列、绝不同格**：

**数据血缘（D · 只有数据，名词）**
```text
outer{runtime · input · config}  →  derived  →  inner{runtime · input · config}
   →  inner output  →  outer output
```

**处理器（P · 只有逻辑；转换处理器为纯 `data→data`，core 的副作用边界遵守 I1）**

| 处理器 | 读入（D） | 产出（D） |
|--------|-----------|-----------|
| outer_derived | outer runtime/input/config | derived |
| inner_runtime | outer runtime/input/config + derived | inner runtime |
| inner_input | outer runtime/input/config + derived | inner input |
| inner_config | outer runtime/input/config + derived | inner config |
| core_logic（业务） | inner runtime/input/config | inner output |
| output | outer runtime/input/config + derived + inner output | outer output |

- **core_logic 无结构特殊性**：它只是"读入恰好是 (runtime,input,config) 规范三元组"的那个处理器；`output=fn(runtime,input,config)` 讲的就是 P(fn) 与 D 分离，封装流程把这套分离重复几次、串成显式血缘。
- **outer/inner 分层**：除 core 是内层业务逻辑，其余处理器在外层处理框架级关注点（解析、错误包装、可观测）；core 若需 IO，只能调用注入的 effect 契约（I1/I4）。
- **adapter 唯一存在理由**：outer 与 inner runtime 结构不一致时承载转换；同构强造空壳 adapter 是过度设计。
- **压扁信号**：inner_runtime/input/config 三处理器整段缺失、outer 直接灌进一个大对象方法里现取现算——module 范围最常见的"未封装"。

### 权威参照实现（协议不走样，实现可适配）

下面是标准封装的**通用、可复用参照实现**。它钉死的是**协议**——六个语义阶段都显式存在、顺序固定（`outer{runtime,input,config}` 进，逐步算出 `derived → innerRuntime → innerInput → innerConfig → innerOutput → outerOutput`），数据(D)与处理器(P)分列。这条协议是不走样的那部分；**实现形态可以按语言 / 场景 / 领域适配**（见代码后「适配与边界」）。它是一段**可复用的通用原语**——项目里已有等价实现就直接用、不要重造，也不强制非得长成这个签名。

代码中的 `Std*Adapter` 是以下协议角色的示例命名；本表是其唯一语义锚点，不要求照抄 Java 泛型或接口名。六步都必须有可指认的实现；同构时可用显式 identity/null adapter，但不可静默省略阶段。

| 角色 | 语义签名（输入 → 输出） | 透传 / 空值何时合法 |
|------|-------------------------|----------------------|
| `StdOuterComputedAdapter` | `(outerRuntime, outerInput, outerConfig) → derived` | 没有额外衍生值且后续阶段接受 `null` 时，显式返回 `null` |
| `StdInnerRuntimeAdapter` | `(outerRuntime, outerInput, outerConfig, derived) → innerRuntime` | outer/inner runtime 同构时，显式 identity 透传 |
| `StdInnerInputAdapter` | `(outerRuntime, outerInput, outerConfig, derived) → innerInput` | outer/inner input 同构时，显式 identity 透传 |
| `StdInnerConfigAdapter` | `(outerRuntime, outerInput, outerConfig, derived) → innerConfig` | outer/inner config 同构时，显式 identity 透传 |
| `StdInnerLogic` | `(innerRuntime, innerInput, innerConfig) → innerOutput` | 不可省略；副作用规则遵守 I1/I4 |
| `StdOuterOutputAdapter` | `(outerRuntime, outerInput, outerConfig, derived, innerOutput) → outerOutput` | 形状同构时可显式 identity 透传，但仍保留输出阶段 |

```java
public class StdRunComponentLogic {
    public static <TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TOuterOutput,
            TInnerRuntime, TInnerInput, TInnerConfig, TInnerOutput>
    TOuterOutput runByFuncStyleAdapter(
            TOuterRuntime outerRuntime,
            TOuterInput outerInput,
            TOuterConfig outerConfig,
            StdOuterComputedAdapter<TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived>
                    outerDerivedAdapter,
            StdInnerRuntimeAdapter<TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TInnerRuntime>
                    innerRuntimeAdapter,
            StdInnerInputAdapter<TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TInnerInput>
                    innerInputAdapter,
            StdInnerConfigAdapter<TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TInnerConfig>
                    innerConfigAdapter,
            StdInnerLogic<TInnerRuntime, TInnerInput, TInnerConfig, TInnerOutput>
                    coreLogicAdapter,
            StdOuterOutputAdapter<TOuterRuntime, TOuterInput, TOuterDerived, TOuterConfig, TInnerOutput, TOuterOutput>
                    outputAdapter
    ) {
        // ① 基于输入衍生出额外输入
        TOuterDerived outerDerived = outerDerivedAdapter
                .stdMakeOuterComputed(outerRuntime, outerInput, outerConfig);
        // ② 内部实现的上下文（构造 inner runtime）
        TInnerRuntime innerRuntime = innerRuntimeAdapter
                .stdMakeInnerRuntime(outerRuntime, outerInput, outerConfig, outerDerived);
        // ③ 将外部封装入参转换为内部实现入参
        TInnerInput innerInput = innerInputAdapter
                .stdMakeInnerInput(outerRuntime, outerInput, outerConfig, outerDerived);
        // ④ 内部实现的配置
        TInnerConfig innerConfig = innerConfigAdapter
                .stdMakeInnerConfig(outerRuntime, outerInput, outerConfig, outerDerived);
        // ⑤ 调用内部逻辑，返回内部实现结果（core 只拿 runtime/input/config）
        TInnerOutput innerOutput = coreLogicAdapter
                .stdInnerLogic(innerRuntime, innerInput, innerConfig);
        // ⑥ 将内部结果转换为外部结果
        TOuterOutput outerOutput = outputAdapter
                .stdMakeOuterOutput(outerRuntime, outerInput, outerConfig, outerDerived, innerOutput);
        return outerOutput;
    }

    // 默认 helper：不需要转换时显式用 null/identity 透传，而不是省略该步
    public static <TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived>
    TOuterDerived stdMakeNullOuterComputed(
            TOuterRuntime outerRuntime, TOuterInput outerInput, TOuterConfig outerConfig) {
        return null;
    }

    public static <TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TInnerRuntime>
    TInnerRuntime stdMakeIdentityInnerRuntime(
            TOuterRuntime outerRuntime, TOuterInput outerInput,
            TOuterConfig outerConfig, TOuterDerived outerDerived) {
        return (TInnerRuntime) outerRuntime;
    }

    public static <TOuterRuntime, TOuterInput, TOuterConfig, TOuterDerived, TInnerConfig>
    TInnerConfig stdMakeIdentityInnerConfig(
            TOuterRuntime outerRuntime, TOuterInput outerInput,
            TOuterConfig outerConfig, TOuterDerived outerDerived) {
        return (TInnerConfig) outerConfig;
    }
}
```

**协议层盯三件事**（这部分不走样）：① 六个语义阶段都**显式存在**——不准"少接一步"压扁；② 六步顺序**固定不可调换**；③ 不需要转换的步骤用**显式透传**（`stdMakeNull*/stdMakeIdentity*` 或自定义透传 adapter），而不是把这步删掉——"显式空转换"合规、"压扁省略"是 §9 排除态。

**适配与边界**（这部分可变，按需调整）：
- **复用优先**：这是通用可复用原语，项目里已有等价封装就直接用、**不要重造**（呼应 I11 vendor 原语优先）；也不是必须照此签名实现。
- **强类型语言**：常按场景做专用封装**抹平泛型**——把那一长串 `TOuter*/TInner*` 在具体场景里固化成实参类型，对外暴露简洁签名。
- **弱类型语言**：常**精简掉不必要的 adapter 参数**（用默认 / 显式透传 adapter 顶上），只留真正需要转换的那几个。
- **领域定制**：业务特殊时，可在**保持上面协议语义**的前提下定制流程——按领域特性增减自定义 adapter 类型（如多一个领域校验 / 投影阶段）。变的是 adapter 的种类与数量，不变的是"显式分阶段、D/P 分列、不压扁"。

---

## 8. 合法依赖方向与 owner 边界

吸引子的"方程"很大一部分是**方向**。下面这些方向不可逆。

- **authority → observation**（单向）：projection/cache/view 不绕过 authority boundary 反写来源。事件溯源 profile 中，这可具体化为 canonical events → projection。
- **package role 依赖纪律**：contract 是稳定底座；logic 与 support 都依赖公开 contract，logic 不直接 import 具体 support；adapter 只触两侧公开面；capsule/shell 在更外层组装且不触 internals。package role/name 的完整矩阵见 [`fa/protocols/package-role-protocol.md`](fa/protocols/package-role-protocol.md)。
- **outer → inner**（adapter）：可复用组件对调用域无感知；inner 绝不反向 import outer-domain 模块。
- **capsule 间单向无环**：A 的入口只 import B 的入口 + B 的 public types，链 `A → B → C` 无回边；触对方 `internals` 是红灯。
- **跨域 runtime 嵌套单向**：写侧内嵌读侧，读侧绝不回指写侧。
- **本质环 → actor**：切不掉的环把一节点 actor 化、改发消息，把环替换成显式异步边界，而不是用隐式 DI 把环藏进编译器看不见的地方。

> **包依赖图就是架构 harness**：用包之间的依赖关系把上面这些方向**显式化、可机检**——架构同构性长在包结构里，避免一个包内长出混乱依赖。新增包、或改动包间依赖，按架构变更严格 review。

---

## 9. 被排除出合法状态空间的结构

吸引子最重要的动作不是列"对的"，而是**把错的排除出合法状态空间**——下面这些结构即使"能跑"，也已不属于正确结构，发现即漂移、应被收敛掉，而非当成一种合法变体保留。按维度分组。

```text
两个最典型的排除态：
❌ runtime 万能袋   runtime = { everything: any }       // 谁都能摸出任意东西，依赖不可见
❌ 多个半真源       内存权威 + 磁盘快照 都被当源同时生效   // 必然漂移，无法判定谁对
```

**Data**：结构/语义/authority 只能靠猜 · 多个独立裁决者并存 · 绕过 transition boundary 读写 · projection/cache 反写来源 · 一致性/恢复/lifecycle 承诺与实现冲突。仅在相应 profile 激活时，才把破坏 canonical event history 或 reactive graph lifecycle 计入追加违反。

**Effect**：core 直接 IO / 现 new client · 副作用契约与编排糊在一起 · 隐式全局依赖 · 应用级 registry 只经全局变量传 · contract 模块 import 重型副作用实现。

**Processor**：if/elif 字符串分发 · 未知 id 静默回退/返回 None · command/message 混用 · 可复用组件对调用域有感知（import outer-domain 分支）· core 处理路径解析/错误码映射等框架关注点。

**Actor**：并发任务直接 mutate 共享对象 · 用裸锁糊共享状态替代消息 · 调度与身份纠缠 · 消息 contract/delivery/lifecycle 未声明或实现不符 · 用隐式 DI 藏环。

**事实源边界**：checkpoint 读取影响 live 控制 · journal 字段驱动下一步 · UI 状态反向驱动主循环 · 文件 mtime/存在性当运行状态 · 投影反写源 · 快照夹带单次 payload。

**分层**：长生命周期对象藏 input/config · 函数对象塞 config · config 重复 runtime 字段 · 业务逻辑写在 runtime 方法里 · 外部 import 触 internals · contract/logic 反向依赖或同契约两处重复定义。

**过度设计**：空壳 adapter · 只有一个实现的策略表 · 无人用的"以防万一"开关 · 复杂度由"将来可能"驱动 · 自造已有 vendor 原语。

> 这些是“排除集”——审查/收敛时拿它逐条比对，命中即记一条带 evidence locator 的现象（代码用 `path:line`，其他载体用 API/schema/DDL、trace、文档 section 或复现步骤），归到对应维度，定方向后再排序落地。

---

## 10. 架构设计：把系统拉回吸引子

架构工作不是"一次画对终态"，而是**一轮轮把偏离的轨迹收敛回吸引子**。一次收敛沿这条脉络走，可在三种范围复用（系统间 / 模块包级 / 同模块级）：

1. **第一性提问**：从一个反复出现/难根治的**表象**穿透到**事实源边界问题**（谁是真源、谁在反写、有没有多个半真源），先出问题清单——不先加 guardrail。
2. **事实源边界**：为每个关键节点标注 role/model/owner/relation，区分 transition 入口与 physical write，做 authority conflict/backwrite 检查，把"嫌疑"变成"判定"。
3. **证据盘点**：每个"X 有问题"的论断都落成带 `path:line` 的证据——节点→等级→owner、读写路径、包边界、事故。
4. **设计收敛**：把每个问题映射到结构图（控制面/数据面/扩展面 × 平台/领域/应用层级），产出处置决策 + vendor 原语映射 + 候选改造边界。
5. **切片建议**：从收敛候选里筛**第一批可立即落地**的改造，每条可独立执行、可验收，给依赖顺序与**非目标**（不做什么）。超范围的发现登记 backlog，不就地展开。
6. **贯穿原则**：观测优先 · 可验证 · 框架中立 · 避免过度设计——贯穿①–⑤。

> 关键纪律：**范围与深度受控**——不一次吞掉巨型项目，每次显式声明范围（系统间/包/模块）与深度；**建议不等于改造**——产出方向与依赖顺序，是否落地、怎么落地是另一步。

**收敛 micro 例**（一个臃肿 HTTP 入口 → 三层并列 capsule）：

```text
现状：HTTP router 里塞满 —— 构造 OuterCtx、直接 controller.create、手拼 stream + 协议形状、手包响应
  问题（定级/定向）：传输逻辑与业务编排纠缠（Effect 违反）；无单入口、平铺（I10）；协议形状散落（分层）
目标：web_entry → app_core → engine_capsule  三层 capsule，依赖单向
  web_entry      : 只做 HTTP input/transport output 适配（框架级关注点）
  app_core       : 传输无关的应用编排  run_app_core(input, config)
  engine_capsule : OuterRuntime → EngineRuntime 底层适配  run_engine(input, config)
切片：先抽 app_core（核心编排归位）→ 再下沉协议 output adapter → 最后 web_entry 只剩 HTTP 适配
```

---

## 11. 编码：怎么写才落在吸引子里

吸引子是方向，落键是局部动作。**纠偏发生在写之前**：在下面时机自检，命中"排除集"就改，再往下写。

| 你正要做… | 一眼问自己 | 落回哪条不变量 |
|---|---|---|
| 写带依赖的 handler/service | 能写成 `fn(runtime,input,config)` 吗？依赖都注入了吗？ | I1 · I3 · I4 |
| 设计/扩张 runtime | 往里塞方法了吗？这依赖归 runtime 还是 input/config？ | I2 · I3 |
| 接请求/组件执行流 | core 自己去 outer 掏字段了吗？runtime 在 core 内 new 了吗？ | I6 · §7 |
| 处理前端 intent、选中目标或 ECS 批量操作 | 把 type/payload/refs 全塞进 input 了吗？直接传/缓存 UI/ECS 对象了吗？每个 handler 自己写权限和批循环了吗？ | I3 · I7 · I8 |
| 加分发/路由 | 写成 if/elif 长链了吗？固定逻辑硬套分发了吗？ | I7 |
| 管状态/决定谁写谁 | 这份数据的 authority owner 是谁？入口是否经 owner？投影反写上游了吗？能按声明路径恢复吗？ | I5 · §5 |
| 判数据真源/能否反写 | 在用快照/journal/mtime 判 live 吗？投影回写了吗？ | I5 · §5 |
| 依赖成环/共享可变状态 | 在用隐式 DI 藏环吗？该 actor 化吗？ | I9 |
| 跨并发/异步协作 | 该 command 还是 message？涉及 timeout/retry 吗？ | I8 |
| 组织模块 | 单入口了吗？internals 隐藏了吗？依赖单向吗？ | I10 |
| 新建、拆分、重命名 package | basename 最后一词是闭合 role 吗？declared role 与 observed role 一致吗？adapter 在执行适配的一方吗？发布策略是否另行裁决？ | I4 · I10 · [package role 协议](fa/protocols/package-role-protocol.md) |
| 想加抽象/框架/开关 | 有第二实现吗？vendor 有原语吗？这开关有人用吗？ | I11 |

**常驻反射**（不用查表就该守）：

- `output = fn(runtime, input, config)`：依赖全显式注入，不读全局/单例/`this`；副作用经契约、真正 IO 在 support。
- 前端/ECS/actor/批处理用 `output = fn(runtime, selector, invocation, config)`：selector 是 profile-owned closed union，invocation 是操作语义；runtime 负责解析、权限与批处理；跨 actor 才把 invocation 投递为 message。
- runtime 是数据载体、不写业务方法；长生命周期/共享 → runtime，单次 payload → input，静态枚举/开关 → config。
- 数据 authority 与 transition 边界明确；衍生不绕过 authority 反写；持久化、恢复与生命周期按需求声明。
- 标准封装 + 注册表分发；固定逻辑不套分发/空壳 adapter。
- 同步 command / 异步 message（跨 actor、等外部、要 timeout/retry/cancel/priority 的走 mailbox）。
- 依赖成环或共享可变状态：不靠隐式 DI 藏环，把一节点 actor 化、改发消息。
- 别过度设计：vendor 原语优先；没有第二实现就不抽象；以防万一的开关不加。

**file-in / file-out**：重要输入/结论落文件，不只留对话；按职责分类（架构规则 → 本文件/owner doc；研究 → 分析；缺陷诊断 → bug；手测发现 → testing）。窗口是临时上下文，文件才是仓库记忆。

---

## 12. 测试：保护吸引子、不固化实现

DEPA 的结构让测试天然好写；但测试本身也会**沿实现时序腐蚀**，反过来阻碍结构演进。吸引子对测试的约束：

- **测行为/契约，不测实现时序**：测试钉在"对外可观测行为/契约"上，不钉在旧实现的内部时序。一次去掉局部状态镜像就崩一片测试，往往不是一片 bug，而是**测试早已与旧实现耦合**——这是测试漂移，要修测试结构，不是回退重构。

```text
❌ 测试钉在实现时序上（脆性，重构必崩）
   expect(spy).toHaveBeenNthCalledWith(3, ...)   // 第几次调用、内部顺序
✅ 测试钉在对外行为/契约上
   expect(result).toEqual(expectedOutput)         // 同输入得同输出，内部怎么变都行
```

- **core 即 `fn(mockRuntime, input, config)`**：I1 让核心逻辑可用 mock runtime 单测，不连真实库/网络；副作用经契约 mock，断言"调了哪个契约"。这是 DEPA 可测性的根。

```text
✅ 用 mock runtime 单测 core，断言副作用契约被调用
   runtime = { db:{ users:{ create: mock() } }, logger:{ info: mock() } }
   out = await createUser(runtime, { data }, null)
   assert runtime.db.users.create.calledWith(data)
```

- **contract / support 分离 → 对契约测**：core 只依赖契约，测试注入 mock 契约；support 单独测；不让 core 测试里出现真实数据库/HTTP。
- **把不变量当成测试性质**：authority 边界、衍生不反写、声明的一致性/恢复承诺、依赖单向无环——都是可断言的结构性质，值得有针对性的守护。事件重放只在 EventSourcedStateProfile 激活时成为必测性质。

```text
✅ 结构性质测试
   assert writes_go_through(authorityBoundary)             // authority transition 受控
   assert no_backwrite(observation -> authority)           // 衍生不反写
   assert no_import(capsuleA -> capsuleB.internals)         // 依赖不触 internals

✅ EventSourcedStateProfile 激活时追加
   assert fold(reducer, replay(events)) == currentState     // 声明的重放承诺成立
```

- **adapter / runtime 构造要覆盖**：outer→inner 字段映射、config 传递、output 透传、runtime 构造（尤其 registry 加载与下传）都要测——封装流程最易错处。
- **删旧前先用回归守住旧行为**：替换旧 OO/旧 wrapper 时，先用回归测试钉住旧行为；再按职责把旧对象归位到 runtime 数据、纯计算 core、effect support、adapter 或 capsule，最后删除旧壳。
- **流程慢就建 test harness**：完整跑一遍验证很慢时，建一套专属测试工具/夹具支持未来同类问题。可测试性本身是代码质量指标——DOP + 四层分离写出来的代码天然好测。
- **测试数据与测试代码分离**：当测试数据多、体积大时，把测试数据分离到一个**专门目录**，与测试逻辑分开——便于复用、维护与版本管理，不要把大块 fixture 内联进测试代码。具体放哪按项目约定（如 `tests/resources/` 之类），规则是"分离"，位置不强制。
- **三级验证阶梯**：验"做了没"逐级加深——**存在性**（目标产物/函数/测试确实存在、不是空壳）→ **实质性**（它真做了该做的事、断言真行为而非占位）→ **连通性**（与上下游真接通、端到端跑得通，不是孤立通过）。只过存在性就报完成，是最常见的假完成。
- **生成 ≠ 验收**：AI 同一上下文会同时产出代码、类型、测试、完成总结——若理解有偏，全部"证据"会一致偏向同一方向（自验证陷阱）。**完成判定必须回到 live 仓库**，由 fresh session / 独立审计重判，而非实现者自报 `- [x]`。
- **测试是度量，不是真源**：`test/lint/typecheck/build` 把高频显式偏离下推到机器层，是**度量**；它们护当前行为，不定义结构。结构方向以本文件为准。

---

## 13. 常见误读（保留"为什么不那样"）

吸引子的一部分记忆是"哪条路被证伪了"。下面是 DEPA 实践中反复出现、需要主动纠正的误读：

- **把 runtime 归给 Effect 一维**：runtime 是 D（主）+ E（少）+ A（复杂时）的共同展开，不专属 Effect。它首先是数据载体。
- **把标准组件流程画成 D/P 混格**：`Outer Input → Transform → Core → Outer Output` 把数据名词与逻辑动词当同类节点串一行，正是它要反对的三段式心智——必须数据血缘(D)与处理器(P)分列。
- **把 runtime 当成必须长成某固定层数**：不是；丰俭由人，判不变量不判形状。
- **把 actor 当并发工具**：actor 首先为打断环、显式化共享状态所有权而用，并发是顺带。
- **为"标准/可扩展"而过度设计**：标准封装、分发引擎、adapter 都只在有实际转换/动态路由需求时用；为固定逻辑套壳本身是违反。
- **把吸引子当护栏**：护栏答"什么不能做、越界即错"；吸引子答"长期该收敛到哪、持续偏离才腐蚀"。把吸引子降格成更严的护栏，就丢了它处理"扰动下稳定性"的核心能力。
- **把文档完成当代码正确**：owner doc 写了正确行为，也不替代回到 live 仓库验证；真正闭合要回到代码/测试/审计证据。

---

## 14. 吸引子与 harness

吸引子定方向，harness 把轨迹持续拉回方向。三类 harness 与本文件的关系：

- **本文件（owner doc）** = 吸引子的载体：结构方程、合法方向、排除集。
- **编码期纠偏清单**（§11 的触发表/反射）= 写前自检、命中排除集即改的执行 harness。
- **扫描分析**（§10 的收敛脉络）= 从现状到改造建议的分析 harness，产物落结构化文档。
- **测试 / 类型 / lint / 审计** = 度量与独立验收：生成与验收分离，完成回 live 仓库重判。

真正的回路不是"定义一次吸引子、永远执行 harness"，而是：**定义吸引子 → 扩张 → 纠偏 → 修订吸引子 → 再扩张**。当实践证明某个结构切分更稳（如把一个臃肿层拆成几层并列 capsule、把一个本质环 actor 化），吸引子本身被修订得更精确，然后在新基线上继续扩张。

> 新吸引子的定义（新的概念切分、边界重定义）通常需要人先提出——AI 擅长在既定吸引子周围快速扩张与收敛，但不会在高速迭代里自行演化出新吸引子。把这份架构判断**外化成可版本化、可审计、可继承的文件**，正是本文件存在的意义。

---

## 附录：术语对照

| 术语 | 含义（一句话） |
|------|----------------|
| **DEPA** | Data / Effect / Processor / Actor 四维 + 标准化组件协议 + 事实源边界 的架构思想 |
| **吸引子 attractor** | 系统长期被反复拉回的稳定结构；用少数不变量隐式定义，非清单非边界 |
| **harness** | 把轨迹持续拉回吸引子的机制：纠偏清单、扫描分析、测试/类型/审计 |
| **owner doc / data owner** | 前者是承载架构规则的可版本化文档；后者是某份数据唯一的权威写入者，二者不可混为一谈 |
| **runtime** | 长生命周期依赖与状态的数据载体（D 主 + E 少 + A 时含），不写业务逻辑 |
| **fn(runtime,input,config)** | 显式依赖的函数边界：纯计算不混 IO；需要副作用时只调用 runtime 中注入的 effect 契约 |
| **fn(runtime,selector,invocation,config)** | 交互式、目标寻址处理边界：closed selector 声明选择，invocation 说明操作，runtime 解析/授权/批处理，message 仅是跨 actor 的投递形态 |
| **invocation** | 一次不可变处理请求的语义封套：`type`、可选 `kind`、`payload` 与 metadata；可同步调用或异步投递 |
| **selector** | 一次 invocation 的 profile-owned 闭合选择声明；不等于直接对象或 resolved targets，不能与 invocation payload 重复持有 |
| **effect contract / support** | contract 声明可调用的副作用能力；support 提供具体 DB、网络、文件等实现并经 runtime 注入。core 依赖前者，不直接 import 后者 |
| **package role** | package basename 的最后一词，闭合集为 `contract | logic | support | adapter | capsule | shell`；描述首要架构职责，不等同于 public/private 或发布策略 |
| **数据血缘(D) / 处理器(P)** | 封装流程里"数据名词链"与"逻辑纯函数"两块，分列、绝不同格 |
| **事实角色 / authority model** | 数据节点承担的语义角色 / 它拥有当前真相的机制与边界 |
| **authority owner** | 决定当前真相的唯一 owner；transition 入口和 physical write 不等同于 owner |
| **衍生不反写** | 投影/缓存/视图通过 command/event 请求 owner，不直接覆盖来源 |
| **capsule** | 单入口、internals 隐藏、对外只暴露稳定契约的模块单元 |
| **command / message** | 同步命令（同栈）/ 异步消息（经 mailbox） |
| **actor** | 单一所有权的解环/并发单元；环或共享可变状态时把一节点 actor 化 |
| **selective receive** | actor 从 mailbox 中按消息类型、相关性或优先级选择下一条可处理消息的能力，不等同于任意共享内存读取 |
| **DOP** | Data-Oriented Programming：数据与逻辑分离，runtime 保持数据载体，业务逻辑以外部函数接收显式数据与依赖 |
| **排除集** | 已不属于合法状态空间的老结构；发现即漂移，应收敛掉 |
