# 控制论循环协议

Mission 规划与执行共用本协议。`plan-mission` / `impl-mission` 只引用，不复述正文。XNL 字段协议仍只在 `std/spec/mission-xnl-spec.md`。

mission 不是「算一个答案」，而是当控制器：把**实际态**持续收敛到用户意图的**期望态**，期间期望态还可能漂移。四个角色是职责，不是四个必须同时在线的进程。

规划期（`plan-mission`）主要由 **MissionPlanner** 把期望态写出来；执行期（`impl-mission`）进入闭环。缺下面任一要素，就不要当 mission 硬跑。

```text
期望态 ──┐     mission.xnl DAG、proposal 成功判据、design 控制目标
         ▼
        ┌──> 读「实际态 vs 期望态」的差 ──> 做一次幂等收敛动作 ──┐
        │      MissionReconciler              MissionApplier    │
        │                                                      ▼
        └──────────── 观测新的实际态 / 漂移 <───────────────────┘
                      MissionObserver
                 收敛：实际态 = 期望态 → 收口
                 期望态变了 → MissionPlanner 修订期望，再进入循环
```

## 四要素（缺一不成控制论）

1. **期望态**
   声明式目标：「要收敛成什么样」，不是命令式步骤。写在 `proposal.md` 成功判据、`design.md` 控制目标、`mission.xnl` DAG。由 **MissionPlanner** 产出或修订。

2. **实际态**
   被驱动系统的当前真实状态：mission 文件、真实 track、测试、reports、用户新约束。控制器**读它**、不臆测、不拿聊天记录当真源。由 **MissionObserver** 读取。

3. **收敛动作**
   把实际态往期望态推一步的写入；**幂等**——先看当前态、只补差、已对的跳过。由 **MissionApplier** 执行，并在同一动作里做能证伪它的验证。

4. **反馈 / 漂移**
   观测实际态变化。两类漂移要分开：用户改了目标 → 改期望态（MissionPlanner）；仓库 / track / 测试被改 → 当实际态（MissionObserver），不要覆盖用户目标。

两条纪律：

- **看状态、不看事件**：每轮读**当前**实际态投影决定下一步，而不是记「上一步发生了什么」。这样可重跑、可中断续跑、可穿插。
- **幂等**：同样的期望态 + 同样的实际态 → 同样的动作与结果。已达成的不重做。

## 四个角色

写入 `mission.xnl` 的默认 ActorSet；每个 Actor 的 `<Description>` 写本 mission 的具体工作方式，角色名不要自造。

| 角色 | 它干什么 |
|---|---|
| `MissionPlanner` | 把用户意图补全成声明式期望态；计划失效时修订 DAG |
| `MissionObserver` | 读实际态与漂移，反馈给调和 |
| `MissionReconciler` | 比较期望 vs 实际，判 ready / drift / blocked / completed |
| `MissionApplier` | 幂等执行叶子操作，并在动作内验证 |

顺序：Observer → Reconciler →（ready 则）Applier → Observer。Planner 只在建档或计划失效时上场。不要在观察阶段改代码或 DAG，不要在应用阶段凭记忆改期望态。
