#!/usr/bin/env node

/**
 * 后台托盘服务入口
 *
 * 独立运行时启动系统托盘 + 调度器。
 * 用法: node dist/reminder/tray.js
 */

import { BackgroundService } from './services/BackgroundService.js';

const service = new BackgroundService();
service.start().catch((err) => {
  console.error('[tray] 启动失败:', err.message);
  process.exit(1);
});

// 阻止进程退出（托盘在后台运行）
process.on('uncaughtException', (err) => {
  console.error('[tray] 未捕获异常:', err.message);
});
