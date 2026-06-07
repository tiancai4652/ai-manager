# AI Manager 使用文档

## 它是什么

AI Manager 是一个 **AI 编码任务的自动监督者**。

你在用 Claude Code 或 CodeX 开发时，通常需要反复告诉它做什么、检查结果、发现错误再让它改。AI Manager 把这个"你盯着它干活"的过程完全自动化：

1. 你说出需求（可以很粗略）
2. AI Manager 和你讨论，把模糊的地方问清楚
3. 生成需求文档，你确认无误（可反复修改）
4. 自动拆成子任务，你确认执行计划
5. 逐个派发给 Claude Code / CodeX，实时监控输出
6. 遇到问题自动处理，做不完自动重试
7. 全部完成后通知你，需求文档和执行计划都保存在 `.aimanager/` 目录

---

## 安装

```bash
# 克隆项目
cd ai-manager

# 安装依赖
npm install

# 编译
npm run build
```

编译后的可执行文件在 `dist/` 目录。

---

## 前置条件

### 1. Claude Code（推荐，一步到位）

如果你已经安装了 Claude Code 并且在终端里能用 `claude` 命令，**不需要任何额外配置**。AI Manager 会通过 `claude -p` 调用来做分析和决策，直接复用你终端里的登录状态。

```bash
# 确认已安装
claude --version

# 如果没装
npm install -g @anthropic-ai/claude-code
```

### 2. 编码 AI

你至少需要安装一个编码 AI 工具：

- **Claude Code**（默认）: `npm install -g @anthropic-ai/claude-code`
- **CodeX**: `npm install -g @openai/codex`

### 3. Node.js >= 18

### 可选：Anthropic API Key

如果你没有 Claude Code 但有 Anthropic API Key，也可以用直接调 API 的方式：

```bash
# 环境变量
export ANTHROPIC_API_KEY=sk-ant-xxxxx

# 或者写入配置
node dist/index.js config set apiKey sk-ant-xxxxx
node dist/index.js config set brainMode api
```

---

## 快速开始

### 直接运行（零配置）

```bash
# 最简单的用法 — 需求可以很粗略，会引导你细化
# 未指定目录时自动创建 ./ai-manager-workspace/<时间戳>
node dist/index.js run "做一个网站"

# 指定工作目录（推荐）
node dist/index.js run "创建一个 Express REST API" --dir /path/to/my-project

# 指定模型
node dist/index.js run "做一个 Todo App" --model claude-sonnet-4-20250514

# 跳过讨论，直接执行（需求已经写得很清楚时用）
node dist/index.js run "用 Express + TypeScript 创建 REST API" -y

# 查看运行时详情
node dist/index.js run "..." --debug
```

### 修改已有项目

当 `--dir` 指向已有项目时，AI Manager 自动进入 **修改模式**，扫描项目结构和源代码，让 LLM 精准定位到现有代码做修改：

```bash
# 指向已有项目 → 自动检测，进入修改模式
node dist/index.js run "给登录接口加上验证码" --dir /path/to/existing-project

# 你会看到：
# 📂 检测到已有项目 (18 项)
# 🔧 修改模式：在已有项目上工作
```

修改模式下，AI Manager 会：
- **扫描项目上下文**：目录树、package.json、配置文件、关键源码、已有 README
- **精准规划任务**：LLM 知道项目结构，生成的任务是"修改 routes/auth.ts 的 POST /login"而不是"初始化项目"
- **精准生成指令**：指令引用实际文件路径和代码位置，而非从零开始
- **保护已有文档**：不会覆盖已有的 README.md

### 三种需求输入方式

除了命令行参数，还支持交互式输入和需求文档：

```bash
# 方式 1: 命令行直接写（适合简短需求）
node dist/index.js run "给 CLI 添加一个 version 命令" --dir /path/to/project

# 方式 2: 先进项目，再聊需求（推荐）
#         不写 requirement 参数，会弹出交互式输入框
node dist/index.js run --dir /path/to/project
# → 💬 请描述你的需求
# → 📂 项目: /path/to/project
# → 📦 项目名: my-project
# → 输入需求描述，支持多行。连续两次回车结束输入。
# → >

# 方式 3: 甩需求文档（适合复杂需求）
node dist/index.js run --req-doc ./requirements.md --dir /path/to/project
# → 📄 已加载需求文档: requirements.md (1234 字)
```

### 你会看到什么

运行 `aimanager run "做一个 Todo App"` 后，AI Manager **不会马上开始写代码**，而是先和你讨论需求：

```
🎯 AI Manager v0.1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 需求: 做一个 Todo App
📂 目录: ./ai-manager-workspace/20260604-093000
🤖 Agent: claude-code
🧠 Brain: glm-5.1 (auto)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 需求讨论
──────────────────────────────────
你的需求: 做一个 Todo App
──────────────────────────────────

  当前理解: 用户想创建一个 Todo 应用，但技术栈、功能范围、存储方式都不明确。

  ❓ 需要确认几个问题:
     1. 前端用什么框架？React / Vue / 原生 JS？
     2. 需要后端吗？还是纯前端用 localStorage 存数据？
     3. 需要哪些功能？只 CRUD？还是要分类、优先级、截止日期？

  💬 你的回答:
  > React + 纯前端 + localStorage，只要增删改查和标记完成

  当前理解: React Todo App，localStorage 存储，功能有增删改查和标记完成。

  ✅ 需求已经足够清晰。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 完善后的需求文档:
──────────────────────────────────
## 项目概述
用 React + TypeScript 创建一个 Todo App...
## 技术栈
- React + TypeScript + Vite
- localStorage 存储
──────────────────────────────────

  请确认需求文档:
    [Y] 确认无误，继续
    [E] 我有补充或修改
    [Q] 取消退出
  > y

  📄 需求文档已保存: .aimanager/requirement.md

🧠 解析任务计划...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 执行计划:
  1. 初始化 React 项目
     用 Vite 创建 React + TypeScript 项目，安装依赖
  2. 实现 Todo 数据模型和状态管理
     定义 Todo 类型，用 useState 管理列表，实现增删改查和标记完成
  3. 构建 Todo UI 组件
     TodoInput, TodoItem, TodoList 组件，支持添加/删除/完成切换
  4. 编写测试
     组件渲染测试和交互测试
  5. 验证整体功能
     npm run dev 启动，手动验证所有功能
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  确认开始执行? [Y/n]
  > y

🚀 启动编码 AI 终端会话...

🔄 执行中 — 1/5 完成 — 45s
  │ 正在创建 TodoList.tsx...
  │ 添加删除和完成切换逻辑...

✅ 任务完成! 5/5 完成 — 3m 22s
```

按 `Ctrl+C` 可随时暂停。

---

## 命令参考

### `run` — 执行任务

```bash
node dist/index.js run [requirement] [选项]
```

| 参数 | 说明 |
|------|------|
| `[requirement]` | **可选**。需求描述，可以很粗略。不提供则交互式输入 |
| `-d, --dir <path>` | 工作目录。指向已有项目时自动进入修改模式；未指定时新建 |
| `-a, --agent <type>` | 编码 AI 类型：`claude-code`（默认）或 `codex` |
| `-m, --model <model>` | 大脑 LLM 模型，如 `claude-sonnet-4-20250514`、`claude-opus-4-8` |
| `-r, --req-doc <path>` | 需求文档路径（`.md` / `.txt`），适合复杂需求 |
| `-y, --yes` | 跳过需求讨论和计划确认，直接开始执行 |
| `--debug` | 调试模式，显示详细日志 |

**示例**：

```bash
# 简单任务
node dist/index.js run "创建一个 package.json 和 index.ts，输出 hello world"

# 复杂需求
node dist/index.js run "用 React + TypeScript 做一个 Todo App，要求：
  - 添加/删除/标记完成
  - 数据存 localStorage
  - 有过滤功能（全部/未完成/已完成）
  - 响应式布局
  - 写单元测试"

# 指定目录和 Agent
node dist/index.js run "实现用户注册登录 API" \
  --dir ~/projects/my-api \
  --agent codex
```

### `model` — 选择模型

```bash
# 交互式选择（推荐，列出所有可用模型让你选）
node dist/index.js model

# 列出所有模型（不进入交互，只显示列表）
node dist/index.js model list

# 直接设置模型 ID
node dist/index.js model set glm-5-turbo
```

交互式选择示例：

```
$ node dist/index.js model

可用模型:

  1. glm-4.5       (GLM-4.5)
  2. glm-4.5-air   (GLM-4.5-Air)
  3. glm-4.6       (GLM-4.6)
  4. glm-4.7       (GLM-4.7)
  5. glm-5         (GLM-5)
  6. glm-5-turbo   (GLM-5-Turbo)
> 7. glm-5.1       (GLM-5.1)          ← 当前

  请选择 [1-7]: 6
✅ 已设置模型: glm-5-turbo (GLM-5-Turbo)
```

模型列表从 Anthropic API 动态拉取，无 API key 时使用内置列表。选中的模型保存在配置中，后续 `run` 会自动使用。也可以用 `--model` 参数临时覆盖。

### `config` — 管理配置

```bash
# 查看所有配置
node dist/index.js config list

# 查看单个配置
node dist/index.js config get brainModel

# 修改配置
node dist/index.js config set maxRetries 5
node dist/index.js config set analysisInterval 5000
```

---

## 配置项

配置文件位置：`~/.aimanager/config.json`

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agentType` | string | `claude-code` | 默认编码 AI 类型 |
| `apiKey` | string | — | Anthropic API Key（也可用环境变量） |
| `maxRetries` | number | `3` | 单个任务最大重试次数 |
| `analysisInterval` | number | `3000` | 输出分析间隔（毫秒），越小反应越快但 API 调用越多 |
| `taskTimeout` | number | `300000` | 单任务超时（毫秒），默认 5 分钟 |
| `brainModel` | string | `glm-5.1` | "大脑"用的 LLM 模型（可通过 `aimanager model` 交互选择） |
| `brainMode` | string | `auto` | "大脑"调用方式，见下文 |
| `terminalCols` | number | `120` | 伪终端列数 |
| `terminalRows` | number | `40` | 伪终端行数 |
| `logLevel` | string | `info` | 日志级别：`debug` / `info` / `warn` / `error` |

### 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key，优先级高于配置文件 |

### brainMode 详解

`brainMode` 控制 AI Manager 的"大脑"（分析终端输出、生成指令、质量评审）用什么方式调用 LLM：

| 值 | 行为 |
|----|------|
| `auto`（默认） | 优先用 `claude -p`（复用你终端的 Claude Code 登录），没装 Claude Code 时回退到直接调 API |
| `claude-cli` | 强制用 `claude -p`，需要已安装并登录 Claude Code |
| `api` | 强制直接调 Anthropic API，需要设置 `apiKey` 或 `ANTHROPIC_API_KEY` |

**推荐**：保持默认 `auto`，什么都不用配。只要终端里 `claude` 能用，AI Manager 就能工作。

---

## 工作原理

```
┌──────────────────────────────────────────────────────┐
│  你: "做一个网站"  （需求可以很粗略）                    │
└──────────────────────┬───────────────────────────────┘
                       │
               ┌───────▼────────┐
               │ ① 需求讨论      │  ← LLM 问你: 框架? 功能? 存储?
               │   (多轮对话)    │     你回答，或说 "开始" 跳过
               └───────┬────────┘
                       │
               ┌───────▼────────┐
               │ ② 需求文档确认  │  ← 展示完善后的需求文档
               │   [Y]确认       │     [E]补充修改（可反复）
               │   → 保存到文件   │     [Q]取消
               └───────┬────────┘
                       │
               ┌───────▼────────┐
               │ ③ 需求解析      │  ← LLM 拆解为有序子任务
               └───────┬────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │ ④ 展示执行计划，你确认 [Y/n]              │
    │    → 保存计划到 .aimanager/plan.md        │
    └──────────────────┬──────────────────────┘
                       │
          ┌────────────▼────────────┐
          │ ⑤ 逐个执行任务:          │
          │                          │
          │  生成指令 → 发送到编码 AI  │  ← node-pty 伪终端
          │  监控输出 → 分析状态       │  ← LLM 实时分析
          │     ├─ working → 等待     │
          │     ├─ waiting → 自动回答 │
          │     ├─ error → 自动修复   │
          │     └─ idle → 检查完成    │
          │  质量评审                  │
          │     ├─ 通过 → 下一个任务   │
          │     └─ 不通过 → 自动重试   │
          └────────────┬─────────────┘
                       │
               ┌───────▼────────┐
               │ ⑥ 全部完成      │
               │   → 通知你      │
               │   → 文档已归档   │
               └────────────────┘
```

### 关键概念

- **需求讨论 + 文档确认**：AI Manager 不会拿到需求就开干。先和你多轮对话澄清需求，然后生成需求文档让你确认。你可以反复补充修改（输入 `E`），直到满意后才保存并继续
- **需求文档归档**：所有讨论结果自动保存在 `<工作目录>/.aimanager/requirement.md`，执行计划保存在 `.aimanager/plan.md`，方便后续回溯
- **PTY 伪终端**：用 `node-pty` 创建一个真实的终端环境，编码 AI 完全不知道它是被程序控制的
- **大脑 LLM**：一个独立的 Claude 调用，专门负责"看"终端输出并做出决策。默认通过 `claude -p` 复用你终端的登录，零配置。可通过 `--model` 切换模型
- **权限自动处理**：Claude Code 在执行时会自动批准文件读写和命令执行权限（通过 `--dangerously-skip-permissions`），不会因为权限弹窗卡住
- **质量评审**：任务完成后，先做快速检查（文件是否存在），再做 LLM 深度审查（代码质量、功能完整性）

---

## 常见问题

### Q: 支持 Windows 吗？

完全支持。

- **终端控制**：使用 `node-pty`，Windows 上通过 ConPTY 工作
- **大脑调用**：通过 stdin 管道传递 prompt 给 `claude --print`，不依赖 shell 引号，中文和多行内容都能正确处理
- 编码 AI 会被启动在一个 Windows 伪终端中

### Q: 默认工作目录是什么？

- **指定了 `--dir` 且目录有文件**：使用你指定的目录，自动进入 **修改模式**
- **指定了 `--dir` 但目录为空/不存在**：使用你指定的目录，进入 **新建模式**
- **未指定**：自动在当前目录下创建 `./ai-manager-workspace/<时间戳>`（如 `./ai-manager-workspace/20260604-093000`），进入新建模式

所有生成的文件（代码、需求文档、执行计划）都在这个目录下。建议每次都用 `--dir` 指定明确的项目目录。

### Q: Claude Code 的权限弹窗怎么办？

AI Manager 自动处理。启动 Claude Code 时会加上 `--dangerously-skip-permissions` 参数，自动批准所有文件读写和命令执行请求，不会因为权限确认卡住自动化流程。

如果你对安全性有顾虑，可以在 `orchestrator.ts` 中移除该参数，此时遇到权限请求会由输出分析器检测并自动回复 `y`。

### Q: 需求文档保存在哪里？

所有文档保存在 `<工作目录>/.aimanager/` 下：

```
your-project/
└── .aimanager/
    ├── requirement.md    # 需求文档（经讨论确认后的最终版）
    ├── plan.md           # 执行计划（任务拆解）
    └── execution.log     # 执行日志（大脑交互、状态判断、指令发送）
```

这些文件可以加入 Git 追踪，方便团队回溯需求讨论过程。

### Q: 修改已有项目和新建项目有什么区别？

| | 新建模式 | 修改模式 |
|--|---------|---------|
| **触发条件** | 目录为空/不存在，或未指定 `--dir` | `--dir` 指向有文件的目录 |
| **项目扫描** | 不扫描 | 扫描目录树、package.json、配置文件、源码、README |
| **需求讨论** | 通用问题（技术栈？功能？） | 针对性问题（"已有 Express Router，继续用？"） |
| **任务规划** | 从零开始（初始化项目 → 搭建框架 → …） | 精确定位（修改 routes/auth.ts → 添加验证码逻辑 → …） |
| **指令生成** | 通用指令 | 引用实际文件路径和代码位置 |
| **README** | 自动生成 | 不覆盖已有文档 |

### Q: 一个任务大概消耗多少 Token？

取决于需求复杂度。简单任务（"创建 hello world"）约 10k-30k Token，中等任务约 50k-100k。大部分 Token 消耗在"大脑"的分析调用上。

### Q: 如果编码 AI 卡住了怎么办？

AI Manager 有多层保护：
1. **状态检测**：如果编码 AI 等待输入，自动提供回答
2. **错误恢复**：检测到错误时自动生成修复指令
3. **质量评审**：完成后自动检查，不通过就重试
4. **重试上限**：默认最多 3 次，可配置
5. **人工介入**：如果"大脑"判断无法自动处理，会暂停并通知你
6. **Ctrl+C**：你随时可以手动中止

### Q: 需求描述怎么写效果最好？

- **具体明确**：说清楚用什么技术、要什么功能
- **包含验收标准**：比如"要有测试"、"要能通过 `npm start` 运行"
- **一次一个主题**：不要把不相关的需求混在一起
- **可以多行**：用换行列出具体要点

好的示例：
```
"用 Express + TypeScript 创建 REST API：
 - GET /users 返回用户列表
 - POST /users 创建用户
 - JWT 认证中间件
 - 用 SQLite 存数据
 - 写集成测试
 - 启动命令 npm start"
```

不好的示例：
```
"做一个网站"  ← 太模糊
```

### Q: 可以不用 Claude Code，用其他编码 AI 吗？

目前支持 `claude-code` 和 `codex` 两种。通过 `--agent` 参数切换：

```bash
node dist/index.js run "..." --agent codex
```

### Q: 编码 AI 需要的 API Key 怎么配？

编码 AI 的 API Key 是它自己的事，不是 AI Manager 管的：
- Claude Code 需要你提前登录好（`claude` 命令首次运行时会引导登录）
- CodeX 需要 `OPENAI_API_KEY` 环境变量

AI Manager 默认通过 `claude -p` 复用 Claude Code 的登录状态，不需要额外的 API Key。如果想用直接调 API 的方式，才需要设置 `ANTHROPIC_API_KEY`。

---

## 开发

```bash
# 开发模式（用 tsx 直接运行 TypeScript）
npm run dev -- run "test task"

# 编译
npm run build

# 运行编译后版本
node dist/index.js run "test task"
```

---

## 项目文件结构

```
ai-manager/
├── doc/                             # 文档
├── src/
│   ├── index.ts                     # 入口
│   ├── cli/
│   │   └── commands.ts              # CLI 命令（run / model / config）
│   ├── core/
│   │   ├── orchestrator.ts          # 核心编排循环
│   │   ├── task-manager.ts          # 任务管理
│   │   ├── plan-parser.ts           # 需求解析（支持新建/修改模式）
│   │   ├── project-scanner.ts       # 项目扫描（目录树/源码/配置）
│   │   └── requirement-discusser.ts # 需求讨论 + 文档确认 + 归档
│   ├── terminal/
│   │   ├── pty-session.ts           # PTY 终端封装
│   │   ├── output-buffer.ts         # 输出缓冲
│   │   └── input-writer.ts          # 输入注入
│   ├── brain/
│   │   ├── llm-client.ts            # LLM 客户端（claude-cli / api 双模式）
│   │   ├── output-analyzer.ts       # 输出分析
│   │   ├── instruction-generator.ts # 指令生成（支持项目上下文注入）
│   │   └── quality-reviewer.ts      # 质量评审
│   ├── models/
│   │   ├── plan.ts                  # 执行计划模型
│   │   ├── task.ts                  # 任务模型
│   │   ├── session-state.ts         # 会话状态模型
│   │   └── project-context.ts       # 项目上下文模型（新建/修改模式）
│   └── utils/                       # 工具函数
├── dist/                            # 编译输出
├── package.json
└── tsconfig.json
```
