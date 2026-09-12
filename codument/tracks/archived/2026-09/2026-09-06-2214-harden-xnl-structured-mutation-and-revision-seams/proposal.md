# 原生结构编辑与 revision 公共接缝

本 Track 为通用结构编辑建立原生对象数组、稳定 identity、前置值验证和多文件 revision 的可执行契约。消费者复用 XNL 的 diffNodes/dryRunMutations 与 revisioned VFS/VCS 接缝，不另写结构 mutation 引擎。

覆盖 A01/A02/A05/A06/C03/C12 的通用部分：结构值 roundtrip、同一节点重排后修改、嵌套 expected value、失败 batch 隔离、多文件原子 CAS、stale 拒绝和 checkpoint 对 live authority 的只读边界。实体集合规范化、跨文档领域 ID 校验、业务命令和正式组织持久化属于消费者。

实现以现有公开接口 conformance 优先；只有失败 fixture 证明现有实现违反契约时才改通用运行时代码。验收包括 core/vfs/vcs 回归、构建、独立 tarball Node.js/Bun 消费。本 Track 由已批准 Mission 连续执行，manual commit；不执行 npm 发布。
