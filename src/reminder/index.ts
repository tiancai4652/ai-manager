#!/usr/bin/env node

/**
 * CCreminde — Windows 桌面定时提醒工具
 *
 * 作为 ai-manager 的独立子系统集成。
 * 可独立运行，也可被主程序导入。
 *
 * 用法:
 *   node dist/reminder/index.js add -m "喝水" -t "2026-06-05T09:00" -r daily
 *   node dist/reminder/index.js list
 *   node dist/reminder/index.js delete <id>
 *   node dist/reminder/index.js start
 */

import { Command } from 'commander';
import { registerReminderCommands } from './cli/commands.js';

const program = new Command();

program
  .name('ccreminder')
  .description('Windows 桌面定时提醒工具 (ai-manager 子系统)')
  .version('1.0.0');

// 注册 add / list / delete / start 四个命令
registerReminderCommands(program);

program.parse(process.argv);

// 无参数时显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
