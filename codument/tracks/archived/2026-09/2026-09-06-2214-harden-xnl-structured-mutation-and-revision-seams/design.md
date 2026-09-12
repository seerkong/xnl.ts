# 设计与接入

Data 为原生 XnlNode、XnlMutationBatch、authority-qualified VfsRevision 与 checkpoint receipt。diffNodes 产生结构提案；dryRunMutations 在隔离副本上验证 identity 与可用 valueBefore。VFS authority 承担 CAS；VCS 仅保存快照历史，不通过 checkout 隐式回写 live authority。

AST 中有序数组必须保序，稳定 identity 重排应生成 move。实体集合是否无序由调用者规范化决定，通用库不得假定所有 body/array 都是集合。严格入口须传 verifyValueBefore=true；identityPolicy=require-elements 仅在全部元素已分配 identity 的文档使用。valueBefore 是字段前置条件，不能替代 authority revision。

测试通过公共包入口构建两份具有原生规则对象/数组的文档，验证 deep diff 和末项 stale 拒绝；VFS 中两个文件的一次变更必须经同一个 CAS 线性化。checkpoint receipt 分别保留 liveRevision 和 commitId，checkout 只影响编辑工作树。

保持已有工作树内容。包不因增加 conformance 测试而任意改版本；如发现运行时修复则给出版本候选并验证 dist/tarball。实际 conformance 发现数据丢失缺口，新增 stringifyLiteral 公共纯函数，已通过 modeling delta 记录其 IO；稳定接入知识在本文件自包含记录。


## 实测接入结论

- core 0.1.13 候选修复 scalar diff 缺 expected value、move 在前序删除后 expected value 失真、原生类型替换被漏掉、quoted key 路径、prototype own-property 处理与 JSON escape 解析。
- `stringifyLiteral(value, {sortKeys:true})` 是显式数据编码入口；`XNL.stringify` 保留 AST 含义。类型名相似但不具完整 AST 结构的对象按普通数据处理。完全模拟 AST 结构的对象仍与 AST 结构不可区分，消费者不能把 literal serialization 成功当作任意 AST-like payload 的 identity-aware 编辑保证。
- `diffNodes(base,target)` 后调用 `dryRunMutations(base, mutations, {verifyValueBefore:true})`，再让外部 authority 做 revision CAS。业务实体集合排序仍由消费者定义。
- `applyRevisionedVfsMutations(authority,{base,mutations,mutationOptions})` 提交整个工作区；`RevisionedRepositoryAdapter.checkpoint(revision,message)` 保存精确 live snapshot，`Repository.checkout` 只更新编辑工作树。
- tarball 的 workspace 依赖已转换为版本；未发布候选在隔离 consumer 中以 tarball overrides 安装闭包，不依赖 workspace source。core 0.1.13、collab-core 0.1.2、vfs 0.1.3、vcs 0.1.2，npm 发布不在本次授权。
