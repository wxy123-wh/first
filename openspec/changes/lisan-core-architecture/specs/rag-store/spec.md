## ADDED Requirements

### Requirement: 向量 + BM25 混合检索
系统 SHALL 支持向量检索和 BM25 关键词检索的混合模式，默认使用 hybrid 模式。

#### Scenario: 混合检索角色设定
- **WHEN** 以角色名为 query 调用 `store.search({ text: "卡列尔", mode: "hybrid" })`
- **THEN** 返回向量相似度和 BM25 关键词匹配的合并结果，按综合分数排序

#### Scenario: 纯向量检索
- **WHEN** 调用 `store.search({ mode: "vector" })`
- **THEN** 仅使用向量相似度排序返回结果

### Requirement: 三层渐进式读取
系统 SHALL 为每个文档维护 L0（摘要）、L1（概览）、L2（全文）三层内容，支持按层读取。

#### Scenario: L0 快速判断
- **WHEN** 调用 `store.getById(id)` 后读取 `metadata.abstract`
- **THEN** 返回约 200 字的一句话摘要，用于快速判断是否需要读取完整内容

#### Scenario: L1 结构概览
- **WHEN** 读取 `metadata.overview`
- **THEN** 返回 1-2KB 的结构化概览，包含文档的主要结构和关键信息

### Requirement: 文档 upsert
系统 SHALL 支持文档的插入和更新，以 `id` 为唯一键。

#### Scenario: 新文档写入
- **WHEN** 调用 `store.upsert([doc])` 且 `doc.id` 不存在
- **THEN** 文档写入向量库，embedding 自动生成

#### Scenario: 已有文档更新
- **WHEN** 调用 `store.upsert([doc])` 且 `doc.id` 已存在
- **THEN** 覆盖原文档，重新生成 embedding

### Requirement: 按类型过滤检索
系统 SHALL 支持按文档类型过滤检索结果。

#### Scenario: 只检索设定文档
- **WHEN** 调用 `store.search({ filter: { type: ["setting"] } })`
- **THEN** 只返回 `metadata.type === "setting"` 的文档
