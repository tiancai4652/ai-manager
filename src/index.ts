#!/usr/bin/env node
import { createProgram } from './cli/commands.js';
// NOTE: shebang line preserved by tsc — required for `npm link` / global install
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

  // 全局崩溃保护：捕获未处理的异常，友好退出而非直接崩
  process.on('uncaughtException', (err) => {
    console.error(`\n❌ 未预期的错误: ${err instanceof Error ? err.message : err}`);
    console.error('   请尝试重新运行，或提交 issue 反馈此问题。');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`\n❌ 未处理的异步错误: ${reason instanceof Error ? reason.message : reason}`);
    console.error('   请尝试重新运行，或提交 issue 反馈此问题。');
    process.exit(1);
  });

  const program = createProgram();
  program.parse();
}
