import notifier from 'node-notifier';
import type { Scheduler, TriggerPayload } from './Scheduler.js';

// ─── 类型 ────────────────────────────────────────────────

export interface NotifierConfig {
  appName?: string;
  icon?: string;
  sound?: boolean;
}

// ─── Notifier 类型声明（node-notifier 无内建类型）────────

// 利用运行时 duck typing，不做严格声明导入
// notifier.notify / notifier.on 在运行时可用

// ─── NotifierService ─────────────────────────────────────

/**
 * Windows 桌面通知服务
 *
 * 封装 node-notifier，通过 bindScheduler() 与调度器联动。
 */
export class NotifierService {
  private config: Required<Pick<NotifierConfig, 'appName' | 'sound'>> & { icon?: string };
  private boundScheduler: Scheduler | null = null;
  private triggerHandler: ((p: TriggerPayload) => void) | null = null;
  private errorHandler: ((err: Error, id: string) => void) | null = null;

  constructor(config: NotifierConfig = {}) {
    this.config = {
      appName: config.appName ?? 'ai-manager',
      sound: config.sound ?? true,
      icon: config.icon,
    };
  }

  /** 发送一条系统通知 */
  notify(title: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const opts: Record<string, unknown> = {
        title,
        message,
        appID: this.config.appName,
        sound: this.config.sound,
      };
      if (this.config.icon) opts.icon = this.config.icon;

      (notifier as any).notify(opts, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 绑定调度器，自动推送触发通知 */
  bindScheduler(scheduler: Scheduler): void {
    if (this.boundScheduler) this.unbindScheduler();
    this.boundScheduler = scheduler;

    this.triggerHandler = (payload) => {
      this.notify('提醒', payload.message).catch((err) => {
        console.error(`[Notifier] 发送失败 (id=${payload.remindId}): ${err.message}`);
      });
    };
    this.errorHandler = (err, id) => {
      console.error(`[Notifier] 调度错误 (id=${id}): ${err.message}`);
    };

    scheduler.on('trigger', this.triggerHandler);
    scheduler.on('error', this.errorHandler);
  }

  /** 解除绑定 */
  unbindScheduler(): void {
    if (!this.boundScheduler) return;
    if (this.triggerHandler) this.boundScheduler.off('trigger', this.triggerHandler);
    if (this.errorHandler) this.boundScheduler.off('error', this.errorHandler);
    this.boundScheduler = null;
    this.triggerHandler = null;
    this.errorHandler = null;
  }
}
