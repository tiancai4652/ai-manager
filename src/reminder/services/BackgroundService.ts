import { watchFile, unwatchFile, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReminderStorage, DEFAULT_REMINDERS_PATH } from '../storage/ReminderStore.js';
import { Scheduler, toReminderType } from './Scheduler.js';
import { NotifierService } from './Notifier.js';
import { TrayService } from './TrayService.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * 后台提醒服务
 *
 * 整合调度器、通知服务和系统托盘。
 * - 托盘右键菜单：查看提醒 / 暂停恢复 / 退出
 * - 热重载：配置文件变更自动重新加载
 * - 主进程关闭后托盘继续运行
 */
export class BackgroundService {
  private storage: ReminderStorage;
  private scheduler: Scheduler;
  private notifierService: NotifierService;
  private trayService: TrayService;
  private configPath: string;
  private paused = false;

  constructor(configPath?: string) {
    this.configPath = configPath ?? DEFAULT_REMINDERS_PATH;
    this.storage = new ReminderStorage(this.configPath);
    this.scheduler = new Scheduler();
    this.notifierService = new NotifierService({ appName: 'ai-manager' });

    this.trayService = new TrayService({
      onViewReminders: () => this.viewReminders(),
      onTogglePause: () => this.togglePause(),
      onExit: () => this.shutdown(),
    });
  }

  /** 启动后台服务 */
  async start(): Promise<void> {
    // 1. 绑定通知到调度器
    this.notifierService.bindScheduler(this.scheduler);

    // 2. 加载并注册提醒
    this.loadAndSchedule();

    // 3. 启动热重载
    this.startWatcher();

    // 4. 启动系统托盘
    await this.trayService.start();
    this.updateTooltip();

    console.log('[BackgroundService] 提醒服务已启动');
    console.log(`  配置文件: ${this.configPath}`);
    console.log(`  活跃任务: ${this.scheduler.count}`);
  }

  /** 加载提醒并注册到调度器 */
  private loadAndSchedule(): void {
    this.storage.reload();
    const enabled = this.storage.getEnabled();
    this.scheduler.cancelAll();

    let ok = 0;
    for (const r of enabled) {
      try {
        this.scheduler.scheduleReminder(r);
        ok++;
      } catch (err) {
        console.warn(`  跳过无效提醒 ${r.id}: ${(err as Error).message}`);
      }
    }
    console.log(`  加载 ${enabled.length} 条提醒，注册 ${ok} 个任务`);
    this.updateTooltip();
  }

  /** 查看提醒（控制台输出） */
  private viewReminders(): void {
    const reminders = this.storage.getAll();
    if (reminders.length === 0) {
      console.log('\n  暂无提醒记录。\n');
      return;
    }
    console.log(`\n  共 ${reminders.length} 条提醒:`);
    console.log('  ─────────────────────────────');
    for (const r of reminders) {
      const status = r.enabled ? '✔' : '✘';
      const repeatText = r.repeat ?? '单次';
      console.log(`  [${status}] ${r.id}  ${r.message}  (${repeatText})`);
    }
    console.log();
  }

  /** 暂停/恢复切换 */
  private togglePause(): boolean {
    this.paused = !this.paused;
    if (this.paused) {
      this.scheduler.cancelAll();
      console.log('[BackgroundService] 提醒已暂停');
    } else {
      this.loadAndSchedule();
      console.log('[BackgroundService] 提醒已恢复');
    }
    this.updateTooltip();
    return this.paused;
  }

  /** 更新托盘提示 */
  private updateTooltip(): void {
    const count = this.paused ? 0 : this.scheduler.count;
    this.trayService.updateTooltip(count);
  }

  /** 启动文件监视（热重载） */
  private startWatcher(): void {
    let lastMtime = 0;
    try { lastMtime = statSync(this.configPath).mtimeMs; } catch { /* ignore */ }

    let timer: ReturnType<typeof setTimeout> | null = null;

    watchFile(this.configPath, { interval: 2000 }, () => {
      try {
        const mtime = statSync(this.configPath).mtimeMs;
        if (mtime !== lastMtime) {
          lastMtime = mtime;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (!this.paused) {
              console.log('[BackgroundService] 配置已变更，重新加载...');
              this.loadAndSchedule();
            }
          }, 500);
        }
      } catch { /* ignore */ }
    });
  }

  /** 完整退出 */
  async shutdown(): Promise<void> {
    console.log('[BackgroundService] 正在退出...');
    this.scheduler.cancelAll();
    this.notifierService.unbindScheduler();
    unwatchFile(this.configPath);
    await this.trayService.stop();
    console.log('[BackgroundService] 已退出');
    process.exit(0);
  }
}
