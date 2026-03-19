# Lisan Web UI 构建规范

> 为 Lisan CLI 工具构建可视化执行过程监控界面
> 目标用户：非技术背景的客户，需要直观了解 AI 写作管线的执行过程

---

## 1. 项目概述

### 目标
构建一个独立的 Web 应用，用于：
- 可视化展示 Lisan 的执行过程（Pipeline → Agent → Pass）
- 实时/回放查看每个 Agent 的输入输出
- 展示最终生成的章节内容
- 提供配置管理界面（替代手动编辑 YAML）

### 非目标
- 不提供在线编辑器（章节内容只读预览）
- 不支持多用户协作
- 不提供云端部署（本地运行）

---

## 2. 技术栈

### 前端框架
- **Next.js 15** (App Router)
- **React 19** + TypeScript 5.x
- **shadcn/ui** (Radix UI + Tailwind CSS v4)
- **Zustand** (状态管理)

### 后端 API
- **Next.js API Routes** (读取 Lisan 项目数据)
- **Server-Sent Events (SSE)** (实时流式展示执行过程)

### 数据源
- `.lisan/traces/*.jsonl` - TraceWriter 输出的执行日志
- `.lisan/state.db` - SQLite 状态数据库（实体图谱）
- `chapters/*.md` - 生成的章节文件
- `.lisan/config.yaml` - 项目配置

### 开发工具
- **pnpm** (包管理器，与 Lisan monorepo 一致)
- **Biome** (代码格式化 + Lint)
- **Vitest** (单元测试)

---

## 3. 项目结构

```
lisan-web/
├── app/
│   ├── layout.tsx              # 根布局（shadcn/ui 主题）
│   ├── page.tsx                # 首页（项目列表）
│   ├── projects/
│   │   └── [id]/
│   │       ├── page.tsx        # 项目详情（执行历史）
│   │       └── executions/
│   │           └── [execId]/
│   │               └── page.tsx # 执行详情（时间轴）
│   ├── config/
│   │   └── page.tsx            # 配置管理页
│   └── api/
│       ├── projects/
│       │   └── route.ts        # GET /api/projects
│       ├── executions/
│       │   └── [id]/
│       │       └── route.ts    # GET /api/executions/:id
│       └── stream/
│           └── route.ts        # GET /api/stream (SSE)
├── components/
│   ├── ui/                     # shadcn/ui 组件
│   ├── timeline/
│   │   ├── pipeline-stage.tsx  # Pipeline 阶段卡片
│   │   ├── agent-card.tsx      # Agent 执行卡片
│   │   └── pass-chain.tsx      # Pass 改写链
│   ├── chapter-preview.tsx     # 章节内容预览
│   └── config-editor.tsx       # YAML 配置编辑器
├── lib/
│   ├── lisan-reader.ts         # 读取 Lisan 项目数据
│   ├── jsonl-parser.ts         # 解析 JSONL 追踪日志
│   └── store.ts                # Zustand 全局状态
├── types/
│   └── lisan.ts                # Lisan 数据类型定义
├── public/
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 4. 核心功能模块

### 4.1 项目列表页 (`/`)
**功能**：
- 扫描用户指定的目录，列出所有包含 `.lisan/` 的项目
- 显示项目名称、最后执行时间、章节数量
- 点击进入项目详情页

**数据源**：
- 扫描文件系统，检测 `.lisan/config.yaml` 存在性
- 读取 `.lisan/state.db` 获取统计信息

**UI 组件**：
- `Card` (shadcn/ui) - 项目卡片
- `Badge` - 状态标签（运行中/已完成/错误）

---

### 4.2 执行历史页 (`/projects/[id]`)
**功能**：
- 展示某个项目的所有执行记录（按时间倒序）
- 每条记录显示：执行时间、Pipeline 类型（write/rewrite/plan）、章节号、状态
- 点击进入执行详情页

**数据源**：
- 读取 `.lisan/traces/` 目录下的所有 JSONL 文件
- 按文件名时间戳排序

**UI 组件**：
- `Table` (shadcn/ui) - 执行记录表格
- `Select` - Pipeline 类型筛选器

---

### 4.3 执行详情页 (`/projects/[id]/executions/[execId]`)
**功能**：
- **时间轴布局**：左侧时间线，右侧 Agent 卡片
- **Pipeline 阶段可视化**：Decompose → Plan → Write
- **Agent 执行卡片**：
  - 折叠/展开 prompt（默认折叠）
  - 展示输出内容（Markdown 渲染）
  - Token 统计（input/output/total）
  - 耗时（秒）
- **Pass 改写链**：5 Pass 串行流程，显示每个 Pass 的修改 diff
- **章节内容预览**：最终生成的 Markdown 内容

**数据源**：
- 读取对应的 `.lisan/traces/{timestamp}.jsonl` 文件
- 逐行解析 JSONL，构建执行树

**UI 组件**：
- `Accordion` (shadcn/ui) - 折叠/展开 Agent 卡片
- `Tabs` - 切换 Input/Output/Diff 视图
- `Progress` - Pipeline 进度条
- `CodeBlock` - 代码高亮（使用 `react-syntax-highlighter`）

---

### 4.4 配置管理页 (`/config`)
**功能**：
- 可视化编辑 `.lisan/config.yaml`
- 表单验证（使用 zod schema）
- 保存后自动格式化 YAML

**数据源**：
- 读取 `.lisan/config.yaml`
- 使用 `js-yaml` 解析/序列化

**UI 组件**：
- `Form` (shadcn/ui + react-hook-form)
- `Input` / `Select` / `Textarea` - 表单控件
- `Button` - 保存/重置按钮

---

## 5. 数据流设计

### 5.1 静态数据读取
```typescript
// lib/lisan-reader.ts
export async function getProjects(): Promise<Project[]> {
  // 扫描文件系统，返回项目列表
}

export async function getExecutions(projectId: string): Promise<Execution[]> {
  // 读取 .lisan/traces/*.jsonl，返回执行记录
}

export async function getExecutionDetail(projectId: string, execId: string): Promise<ExecutionDetail> {
  // 解析单个 JSONL 文件，构建执行树
}
```

### 5.2 实时流式数据（SSE）
```typescript
// app/api/stream/route.ts
export async function GET(request: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      // 监听 .lisan/traces/ 目录变化
      // 新增 JSONL 行时推送到客户端
    }
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

---

## 6. UI 设计规范

### 6.1 布局
- **侧边栏导航**：项目列表 / 配置管理
- **主内容区**：执行历史 / 执行详情
- **响应式设计**：支持桌面端（1920x1080）和平板端（1024x768）

### 6.2 配色方案
- **主题**：shadcn/ui 默认主题（支持亮色/暗色切换）
- **状态颜色**：
  - 运行中：蓝色 (`blue-500`)
  - 已完成：绿色 (`green-500`)
  - 错误：红色 (`red-500`)
  - 警告：黄色 (`yellow-500`)

### 6.3 交互规范
- **折叠/展开**：默认折叠 prompt，点击展开
- **悬停提示**：Token 统计、耗时等数据显示 Tooltip
- **加载状态**：使用 `Skeleton` (shadcn/ui) 占位符

---

## 7. 开发计划

### Phase 1: 项目初始化（已完成 ✓）
- [x] 使用 `create-next-app` 初始化项目
- [x] 安装 shadcn/ui + Tailwind CSS v4
- [x] 配置 TypeScript + Biome + Vitest
- [x] 创建基础目录结构

### Phase 2: 数据层实现（已完成 ✓）
- [x] 实现 `lisan-reader.ts`（读取项目数据）
- [x] 实现 `jsonl-parser.ts`（解析 JSONL 日志）
- [ ] 编写单元测试（覆盖率 >80%）

### Phase 3: 核心页面开发（已完成 ✓）
- [x] 项目列表页
- [x] 执行历史页
- [x] 执行详情页（时间轴布局）

### Phase 4: 高级功能（待实现）
- [ ] SSE 实时流式展示
- [ ] 配置管理页
- [ ] Pass 改写链 diff 视图

### Phase 5: 优化与测试（待实现）
- [ ] 性能优化（虚拟滚动、懒加载）
- [ ] 端到端测试（Playwright）
- [ ] 文档编写

---

## 8. 部署方案

### 本地运行
```bash
pnpm install
pnpm dev  # 开发模式
pnpm build && pnpm start  # 生产模式
```

### 打包为桌面应用（可选）
- 使用 **Tauri** 或 **Electron** 打包为独立应用
- 内置 Node.js 运行时，无需用户安装依赖

---

## 9. 风险与权衡

### 风险
- **JSONL 文件过大**：单个执行日志可能超过 10MB（长篇小说）
  - **缓解**：使用流式解析，分页加载
- **实时监听文件变化**：Node.js `fs.watch` 在 Windows 上不稳定
  - **缓解**：使用 `chokidar` 库

### 权衡
- **不支持在线编辑**：章节内容只读预览，避免与 CLI 工具冲突
- **不支持多项目并行**：同一时间只能查看一个项目的执行过程

---

## 10. 未来扩展

- **Agent 性能分析**：Token 消耗趋势图、耗时热力图
- **章节质量评分**：基于确定性后验证器的规则检查结果
- **实体图谱可视化**：使用 D3.js 展示角色关系网络
- **多语言支持**：i18n（中文/英文）

---

## 附录：shadcn/ui 组件清单

需要安装的 shadcn/ui 组件：
```bash
npx shadcn@latest add card
npx shadcn@latest add badge
npx shadcn@latest add table
npx shadcn@latest add select
npx shadcn@latest add accordion
npx shadcn@latest add tabs
npx shadcn@latest add progress
npx shadcn@latest add form
npx shadcn@latest add input
npx shadcn@latest add textarea
npx shadcn@latest add button
npx shadcn@latest add skeleton
npx shadcn@latest add tooltip
```
