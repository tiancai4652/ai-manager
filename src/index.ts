#!/usr/bin/env node
import { createProgram } from './cli/commands.js';
import { BackgroundService } from './reminder/services/BackgroundService.js';

// ─── 检查是否以托盘模式启动 ──────────────────────────────
// 用法: node dist/index.js --tray
// 或通过 start.bat /background 间接调用
if (process.argv.includes('--tray')) {
  const service = new BackgroundService();
  service.start().catch((err) => {
    console.error('[ai-manager] 托盘服务启动失败:', err.message);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[ai-manager] 未捕获异常:', err.message);
  });
} else {
  // ─── 正常 CLI 模式 ────────────────────────────────────
  const program = createProgram();
  program.parse();
}
