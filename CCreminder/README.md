# CCReminder — Windows 桌面定时提醒

一个基于 Electron 的 Windows 桌面提醒工具，常驻系统托盘，支持单次和循环定时提醒，到时弹出 Windows 原生通知。

## 功能特性

- ✅ **系统托盘常驻** — 最小化到托盘，不占任务栏
- ✅ **单次提醒** — 指定日期时间，触发一次后自动删除
- ✅ **循环提醒** — 支持每天、每周、每小时重复
- ✅ **Windows 原生通知** — 通过 node-notifier 弹出系统通知气泡
- ✅ **图形化管理界面** — Electron 窗口管理提醒的增删改查
- ✅ **数据本地存储** — 提醒数据保存在 `config/reminders.json`

## 安装

### 前置条件

- Node.js >= 18
- npm

### 开发运行

```bash
cd CCreminder
npm install
npm start
```

### 打包为 EXE

```bash
# 打包安装程序（输出到 dist/ 目录）
npm run build

# 仅打包目录版（不生成安装包）
npm run build:dir
```

打包后在 `dist/` 目录找到 `CCReminder Setup.exe`，双击安装即可。

## 使用方法

### 启动

```bash
npm start
```

启动后程序自动最小化到系统托盘（右下角图标区域）。

### 托盘菜单

右键点击托盘图标：

| 菜单项 | 说明 |
|--------|------|
| 打开管理窗口 | 打开提醒管理界面，添加/删除/查看提醒 |
| 暂停提醒 | 暂停所有提醒通知 |
| 退出 | 关闭程序 |

### 添加提醒

1. 右键托盘图标 → 打开管理窗口
2. 填写标题、消息内容
3. 选择触发时间
4. 选择重复模式：单次 / 每天 / 每周 / 每小时
5. 点击添加

### 提醒数据格式

提醒保存在 `config/reminders.json`，格式示例：

```json
[
  {
    "id": "a1b2c3d4",
    "title": "喝水",
    "message": "该喝水了！保持水分摄入",
    "time": "2026-06-04T10:00:00.000Z",
    "repeat": "daily",
    "enabled": true
  },
  {
    "id": "e5f6g7h8",
    "title": "会议提醒",
    "message": "下午3点产品评审会议",
    "time": "2026-06-04T07:00:00.000Z",
    "repeat": null,
    "enabled": true
  }
]
```

**repeat 取值**：

| 值 | 说明 |
|----|------|
| `null` | 单次提醒，触发后删除 |
| `"daily"` | 每天重复 |
| `"weekly"` | 每周重复（同星期几） |
| `"hourly"` | 每小时重复 |

## 项目结构

```
CCreminder/
├── src/
│   ├── main.js              # Electron 主进程入口
│   ├── preload.js           # 预加载脚本（IPC 桥接）
│   ├── tray.js              # 系统托盘管理
│   ├── scheduler.js         # 定时调度器（cron）
│   ├── notifier.js          # Windows 通知发送
│   ├── data/
│   │   ├── reminders.js     # 提醒数据存储（编译后）
│   │   └── reminders.ts     # 提醒数据模型（源码）
│   └── windows/
│       ├── reminders.html   # 管理界面
│       └── reminders.js     # 管理界面渲染逻辑
├── config/
│   └── reminders.json       # 提醒数据文件
├── resources/
│   ├── icon.png             # 应用图标
│   └── tray-icon.png        # 托盘图标
├── package.json
└── tsconfig.json
```

## 技术栈

- **Electron** — 桌面应用框架
- **cron** — 定时任务调度
- **node-notifier** — Windows 系统通知
- **TypeScript** — 数据模型层
- **electron-builder** — 打包为 Windows 安装程序
