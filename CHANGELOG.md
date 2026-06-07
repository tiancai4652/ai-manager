# Changelog

## v0.3.0 (2026-06-07)

### 新功能

- **快速状态预判** — 正则零 token 预判 working/completed/idle 状态，高置信度时跳过 LLM 调用（减少 33% 输出分析调用）
  - Claude Code spinner 动画词检测（Shimmying/Gusting/Actualizing 等）
  - 完成检测：Cogitated for Ns + 回到提示符 / wrote/created 文件
  - 空闲检测：连续 3+ 空提示符
- **断点续跑 `aimanager resume`** — 从中断处恢复执行
  - 运行状态自动保存到 `.aimanager/state.json`
  - 每个任务完成后保存进度 + 每 3 个分析周期定期保存
  - 跳过已完成任务，重置失败任务允许重试
  - 支持多个可恢复运行交互选择
- **智能退避** — 连续 working 时加大分析间隔（3s → 5s → 8s），状态变化立刻回退
- **零 token 快速确认** — Y/N 提示本地正则匹配直接回复，跳过 LLM
- **`aimanager` 全局命令** — npm link 后直接用 `aimanager` 命令

### 实测数据

| 任务 | 用时 | LLM 调用 | Token | 快速预判 |
|------|------|---------|-------|---------|
| hello world | 60s | 9 | 4.5K | - |
| HTTP 服务器 | 1m48s | 8 | 4.4K | 5 次命中 |
| Express+SQLite (5 tasks) | 8m53s | 23 | 18.3K | 多次命中 |
| 断点续跑 (4 tasks, 中断后恢复) | - | - | - | ✅ 跳过已完成任务 |

---

## v0.2.0 (2026-06-07)

### 新功能

- **运行日志系统** — 每次大脑 LLM 调用自动记录耗时、字符数、估算 token
  - 运行结束生成 `run-report.json`（结构化数据）+ `run-report.md`（可读报告）
  - 按用途分类汇总：任务解析 / 生成指令 / 输出分析 / 质量评审 / 生成文档
- **`aimanager log` 命令** — 查看历史运行报告
  - 自动扫描当前目录和 ai-manager-workspace
  - `-v` 显示每次 LLM 调用明细
- **LLM 交互实时展示** — spinner 行显示累计调用次数和 token（如 `🧠 12 ~7.7K tokens`）
- **零 token 快速确认** — 正则扫描 `[Y/n]` 等确认提示，直接回复跳过 LLM 调用
- **智能退避** — 连续 working 时逐步加大分析间隔（3s → 5s → 8s），状态变化时立刻回退

### Token 优化

- **终端输出预过滤 (OutputFilter)** — 去噪/去重/压缩测试块，保留关键行
- **源码签名模式** — 用 API 签名替代完整源码注入，减少 ~75% 上下文
- **Schema 缓存** — LlmClient 缓存已渲染的 schema JSON，避免重复序列化
- **Schema 精简** — 递归移除 description 字段
- **System Prompt 压缩** — 英文重写 + 强制中文输出，减少 20-56%
- **增量分析** — 终端输出无变化时跳过 LLM 调用

### 改进

- `aimanager` 命令全局可用（`npm link`）
- 交互式模型选择 (`aimanager model`)
- 完善项目结构文档和文件树

### 实测数据

| 指标 | 简单任务 (hello world) | 中等任务 (CLI 工具) |
|------|----------------------|-------------------|
| 用时 | 60s | 1m 38s |
| LLM 调用 | 9 次 | 13 次 |
| 估算 Token | 4.5K | 8.4K |

---

## v0.1.0-beta (2026-06-05)

### 初始版本

- 需求讨论 + 文档确认 + 归档
- 自动任务拆解和执行计划展示
- PTY 终端控制 Claude Code / CodeX
- 实时输出分析和状态判断
- 质量评审 + 自动重试
- NEED_HUMAN 关键词协议
- 人工介入暂停/恢复
- 全局崩溃保护
- 项目完成后自动生成 README
- CCreminer 定时提醒子系统
