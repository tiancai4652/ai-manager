import { watchFile, unwatchFile, statSync } from 'node:fs';
import { Command } from 'commander';
import { ReminderStorage, DEFAULT_REMINDERS_PATH } from '../storage/ReminderStore.js';
import { Scheduler, toReminderType } from '../services/Scheduler.js';
import { NotifierService } from '../services/Notifier.js';

// ─── 格式化工具 ──────────────────────────────────────────

function fmtTime(time: string): string {
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

function fmtRepeat(repeat?: string): string {
  if (!repeat || repeat === 'none' || repeat === 'never') return '单次';
  const map: Record<string, string> = {
    daily: '每天', weekly: '每周', monthly: '每月',
    yearly: '每年', weekdays: '工作日',
  };
  return map[repeat] ?? `自定义 (${repeat})`;
}

// ─── 注册 reminder 子命令 ────────────────────────────────

export function registerReminderCommands(program: Command): void {
  const storage = new ReminderStorage();

  // ─── reminder add ────────────────────────────────
  program
    .command('add')
    .description('添加一条提醒')
    .requiredOption('-m, --message <text>', '提醒内容')
    .option('-t, --time <datetime>', '提醒时间 (ISO 格式)', new Date().toISOString())
    .option('-r, --repeat <rule>', '重复规则 (none/daily/weekly/monthly/yearly/weekdays 或 cron)', 'none')
    .action((opts) => {
      const r = storage.add({
        message: opts.message,
        time: opts.time,
        repeat: opts.repeat === 'none' ? undefined : opts.repeat,
      });
      console.log('\n  已添加提醒:');
      console.log(`    ID:      ${r.id}`);
      console.log(`    内容:    ${r.message}`);
      console.log(`    时间:    ${fmtTime(r.time)}`);
      console.log(`    重复:    ${fmtRepeat(r.repeat)}`);
      console.log(`    状态:    已启用\n`);
    });

  // ─── reminder list ───────────────────────────────
  program
    .command('list')
    .description('查看所有提醒')
    .option('-e, --enabled', '只显示已启用的提醒', false)
    .option('-s, --search <keyword>', '按关键词搜索')
    .action((opts) => {
      const reminders = opts.search
        ? storage.search(opts.search)
        : opts.enabled
          ? storage.getEnabled()
          : storage.getAll();

      if (reminders.length === 0) {
        console.log('  暂无提醒记录。\n');
        return;
      }

      console.log(`\n  共 ${reminders.length} 条提醒:`);
      console.log('  ─────────────────────────────────────────────');
      for (const r of reminders) {
        const status = r.enabled ? '✔' : '✘';
        console.log(`  [${status}] ${r.id}`);
        console.log(`      内容: ${r.message}`);
        console.log(`      时间: ${fmtTime(r.time)}`);
        console.log(`      重复: ${fmtRepeat(r.repeat)}`);
        console.log();
      }
    });

  // ─── reminder delete ─────────────────────────────
  program
    .command('delete')
    .description('删除一条提醒')
    .argument('<id>', '提醒 ID (支持前缀匹配)')
    .action((id: string) => {
      const all = storage.getAll();
      const matched = all.filter((r) => r.id.startsWith(id));

      if (matched.length === 0) {
        console.log(`  未找到 ID 以 "${id}" 开头的提醒。\n`);
        return;
      }
      if (matched.length > 1) {
        console.log('  匹配到多个提醒，请提供更精确的 ID:');
        for (const r of matched) console.log(`    ${r.id}  ${r.message}`);
        console.log();
        return;
      }

      const target = matched[0];
      if (storage.remove(target.id)) {
        console.log(`  已删除: ${target.id} - ${target.message}\n`);
      }
    });

  // ─── reminder start ──────────────────────────────
  program
    .command('start')
    .description('启动提醒服务 (前台运行，支持热重载)')
    .option('-f, --file <path>', '配置文件路径', DEFAULT_REMINDERS_PATH)
    .option('--no-watch', '禁用配置热重载')
    .action((opts) => {
      const scheduler = new Scheduler();
      const notifierService = new NotifierService({ appName: 'ai-manager' });

      notifierService.bindScheduler(scheduler);

      function loadAndSchedule(): void {
        storage.reload();
        const enabled = storage.getEnabled();
        scheduler.cancelAll();

        let ok = 0;
        for (const r of enabled) {
          try {
            const type = toReminderType(r.repeat);
            // custom 类型：repeat 本身就是 cron 表达式
            if (type === 'custom' && r.repeat) {
              // 需要调整 schedule 参数
              const adjusted = { ...r, repeat: r.repeat };
              scheduler.scheduleReminder(adjusted);
            } else {
              scheduler.scheduleReminder(r);
            }
            ok++;
          } catch (err) {
            console.warn(`  跳过无效提醒 ${r.id}: ${(err as Error).message}`);
          }
        }
        console.log(`  已加载 ${enabled.length} 条提醒，注册 ${ok} 个定时任务`);
      }

      console.log('\n  CCreminde 服务已启动');
      console.log(`  配置文件: ${opts.file}`);
      loadAndSchedule();

      // 热重载
      if (opts.watch) {
        let lastMtime = 0;
        try { lastMtime = statSync(opts.file).mtimeMs; } catch { /* ignore */ }

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        watchFile(opts.file, { interval: 1000 }, () => {
          try {
            const mtime = statSync(opts.file).mtimeMs;
            if (mtime !== lastMtime) {
              lastMtime = mtime;
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                console.log('\n  [热重载] 配置文件已变更，重新加载...');
                loadAndSchedule();
              }, 300);
            }
          } catch { /* ignore */ }
        });

        console.log('  热重载: 已启用');
      }

      console.log('\n  按 Ctrl+C 停止服务\n');

      process.on('SIGINT', () => {
        console.log('\n  正在停止...');
        scheduler.cancelAll();
        notifierService.unbindScheduler();
        unwatchFile(opts.file);
        process.exit(0);
      });
    });
}
