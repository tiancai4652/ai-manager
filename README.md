# AI Manager

> AI 编码任务监督者 — 自主管理 Claude Code / CodeX 完成复杂任务
>
> 内置 **CCreminder** 定时提醒子系统 — Windows 桌面通知 + 系统托盘

---

## 目录

- [它解决什么问题？](#它解决什么问题)
- [安装](#安装)
- [AI Manager 使用说明](#ai-manager-使用说明)
- [CCreminder 提醒子系统](#ccreminder-提醒子系统)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [开发](#开发)
- [License](#license)

---

## 它解决什么问题？

使用 Claude Code 或 CodeX 做产品时，你需要多轮对话：
1. 告诉它做什么
2. 等它做完，检查结果
3. 发现问题，再告诉它修改
4. 重复...

**AI Manager** 把这个过程自动化：你只需要一次性说清楚需求，它会：
- 自动拆解任务
- 控制编码 AI 的终端会话
- 实时分析输出，判断状态
- 遇到问题自动修复
- 完成后做质量评审
- 只在全部完成或真正卡住时才通知你

## 安装

```bash
# 克隆项目
git clone <repo-url>
cd ai-manager

# 安装依赖
npm install

# 编译
npm run build

# 初始化提醒配置（首次使用）
cp config/reminders.json.example reminders.json
```

> **配置文件说明：** `config/reminders.json.example` 是示例模板，包含完整的字段注释。
> 复制到项目根目录重命名为 `reminders.json` 即可使用。该文件已在 `.gitignore` 中排除，不会被提交。

## AI Manager 使用说明

### 设置 API Key

```bash
# 方式1: 环境变量
export ANTHROPIC_API_KEY=sk-ant-...

# 方式2: 配置命令
aimanager config set apiKey sk-ant-...
```

### 运行任务

```bash
# 基本用法
aimanager run "创建一个 Express REST API，有用户 CRUD 和 JWT 认证"

# 指定工作目录
aimanager run "创建一个 React Todo App" --dir /path/to/project

# 使用 CodeX
aimanager run "实现一个计算器" --agent codex

# 调试模式
aimanager run "..." --debug
```

### 配置

```bash
# 查看配置
aimanager config list

# 修改配置
aimanager config set maxRetries 5
aimanager config set analysisInterval 5000
aimanager config set brainModel claude-sonnet-4-20250514
```

---

## CCreminer 提醒子系统

CCreminder 是集成在 AI Manager 中的 Windows 桌面定时提醒工具，支持：

- ⏰ **定时提醒** — 单次、每天、每周、自定义 cron 表达式
- 🔔 **系统通知** — Windows 原生桌面弹窗（node-notifier）
- 📌 **系统托盘** — 后台运行，右键菜单控制
- 🔄 **热重载** — 修改配置文件后自动生效，无需重启

### 命令一览

```bash
# 添加提醒
aimanager add -m "提醒内容"                        # 立即生效的单次提醒
aimanager add -m "喝水" -t "2026-06-05T09:00"      # 指定时间
aimanager add -m "晨会" -t "2026-06-05T09:00" -r daily   # 每天重复
aimanager add -m "周会" -t "2026-06-08T10:00" -r weekly  # 每周重复
aimanager add -m "站会" -r "0,30 9 * * 1-5"              # 自定义 cron

# 查看提醒
aimanager list                  # 查看全部
aimanager list --enabled        # 只看已启用的
aimanager list --search 喝水     # 按关键词搜索

# 删除提醒（支持 ID 前缀匹配）
aimanager delete rmd_940a

# 启动前台服务
aimanager start                 # 默认开启热重载
aimanager start --no-watch      # 禁用热重载
aimanager start -f /path/to.json  # 指定配置文件
```

### 系统托盘

通过 `start.bat` 启动托盘服务，程序最小化到系统托盘后台运行：

```
双击 start.bat 打开交互菜单：
  [1] 后台运行 (最小化到系统托盘)
  [2] 前台运行 (命令行模式)
  [3] 设置开机自启动
  [4] 取消开机自启动
  [0] 退出
```

也支持命令行参数直接执行：

```cmd
start.bat /background    :: 后台静默启动（用于开机自启）
start.bat /autostart     :: 静默设置开机自启动
```

**托盘右键菜单：**

| 菜单项 | 功能 |
|--------|------|
| 查看提醒 | 控制台输出所有提醒列表 |
| 暂停提醒 / 恢复提醒 | 切换暂停状态，文字动态切换 |
| 退出 | 停止调度器 → 关闭通知 → 退出托盘 |

### 配置文件说明

提醒数据存储在项目根目录的 `reminders.json` 中：

```json
{
  "version": 1,
  "reminders": [
    {
      "id": "rmd_940aaea82e3c",
      "message": "该喝水了！",
      "time": "2026-06-05T09:00:00.000Z",
      "repeat": "daily",
      "enabled": true,
      "createdAt": "2026-06-04T13:10:42.000Z",
      "updatedAt": "2026-06-04T13:10:42.000Z"
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，自动生成 |
| `message` | string | 提醒内容 |
| `time` | string | ISO 8601 时间 |
| `repeat` | string | 重复规则（见下表） |
| `enabled` | boolean | 是否启用 |

**repeat 可选值：**

| 值 | 说明 |
|----|------|
| _(不填)_ | 单次提醒，触发后自动销毁 |
| `daily` | 每天固定时间 |
| `weekly` | 每周同一天固定时间 |
| `monthly` | 每月同一天固定时间 |
| `yearly` | 每年同月同日 |
| `weekdays` | 工作日（周一至周五） |
| _cron 表达式_ | 标准 5 段，如 `0,30 9-17 * * 1-5` |

---

## 项目结构

```
ai-manager/
├── assets/                        # 图标资源
│   ├── icon.ico                   # Windows 托盘图标 (ICO)
│   ├── icon.png                   # 备选图标 (PNG)
│   └── tray-icon.py               # 图标生成脚本
├── config/
│   └── reminders.json.example     # 提醒配置示例模板
├── src/
│   ├── index.ts                   # 主入口 (CLI + --tray 模式)
│   ├── cli/
│   │   └── commands.ts            # AI Manager CLI 命令
│   ├── core/                      # AI 编排核心
│   │   ├── orchestrator.ts
│   │   ├── task-manager.ts
│   │   └── plan-parser.ts
│   ├── terminal/                  # PTY 终端控制
│   │   ├── pty-session.ts
│   │   ├── output-buffer.ts
│   │   └── input-writer.ts
│   ├── brain/                     # LLM 大脑模块
│   │   ├── llm-client.ts
│   │   ├── output-analyzer.ts
│   │   ├── instruction-generator.ts
│   │   └── quality-reviewer.ts
│   ├── models/                    # AI Manager 数据模型
│   ├── utils/                     # 工具函数
│   └── reminder/                  # ✨ CCreminer 提醒子系统
│       ├── index.ts               # 独立 CLI 入口
│       ├── tray.ts                # 托盘服务入口
│       ├── models/
│       │   └── Reminder.ts        # 提醒数据接口
│       ├── storage/
│       │   └── ReminderStore.ts   # JSON 文件存储
│       ├── services/
│       │   ├── Scheduler.ts       # 定时调度 (node-cron)
│       │   ├── Notifier.ts        # 桌面通知 (node-notifier)
│       │   ├── TrayService.ts     # 系统托盘 (systray2)
│       │   └── BackgroundService.ts # 后台服务编排
│       ├── cli/
│       │   └── commands.ts        # 提醒 CLI 命令
│       └── types/
│           └── node-notifier.d.ts # 类型声明
├── start.bat                      # Windows 启动脚本
├── reminders.json                 # 提醒数据 (.gitignored)
├── package.json
└── tsconfig.json
```

## 技术栈

### AI Manager 核心
- **node-pty** — 伪终端控制（让编码 AI 以为在跟真人交互）
- **@anthropic-ai/sdk** — Claude API（大脑：分析、决策、评审）
- **commander** — CLI 框架
- **TypeScript** — 全栈类型安全

### CCreminer 提醒子系统
- **node-cron** — 定时任务调度
- **node-notifier** — Windows 桌面通知
- **systray2** — 系统托盘图标 + 右键菜单

## 开发

```bash
npm run dev run "test task"    # 开发模式运行 AI Manager
npm run build                  # 编译 TypeScript
node dist/index.js --tray      # 启动托盘服务（开发调试）
```

## License

MIT
