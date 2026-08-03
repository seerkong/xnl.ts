# 项目级 Attractor

---

## 什么是 Attractor

Attractor（吸引子）是系统无论如何变化，都会持续向着其靠拢的方向性力量。不是从 A 到 B 的路径规范，而是在目标和路径周围，持续吸引和引导如何走的力量。

---

## XNL Identity

- Element `#id` 是跨树快照对齐节点、检测 move 和稳定引用的 identity key，
  不是普通可更新 payload。
- Identity-aware diff 不生成 `#id` 字段 update；严格 mutation/authoring 入口
  也必须拒绝直接 element ID 字段 mutation。
- 需要新 identity 时，以旧节点 delete 与新节点 add 表达结构替换，并由上层
  领域 policy 判断该替换是否允许。
- 通用 XNL 可以允许无 identity 节点；要求所有可编辑节点有 identity 的约束
  必须由显式 strict policy 开启，不能隐式破坏普通 XNL。
