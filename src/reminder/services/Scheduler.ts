import { EventEmitter } from 'node:events';
import nodeCron, { type ScheduledTask } from 'node-cron';
import type { Reminder } from '../models/Reminder.js';

// ─── 类型 ────────────────────────────────────────────────

export type ReminderType = 'once' | 'daily' | 'weekly' | 'custom';

export interface TriggerPayload {
  remindId: string;
  message: string;
  type: ReminderType;
  triggeredAt: string;
}

// ─── 辅助 ────────────────────────────────────────────────

/** Reminder.repeat → Scheduler 内部类型 */
export function toReminderType(repeat?: string): ReminderType {
  if (!repeat || repeat === 'none' || repeat === 'never') return 'once';
  if (repeat === 'daily') return 'daily';
  if (repeat === 'weekly') return 'weekly';
  return 'custom';
}

/** 将 Reminder 转为 cron 表达式 */
function toCron(type: ReminderType, time: string, repeat?: string): string {
  switch (type) {
    case 'once': {
      const d = new Date(time);
      return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
    }
    case 'daily': {
      const d = new Date(time);
      return `${d.getMinutes()} ${d.getHours()} * * *`;
    }
    case 'weekly': {
      const d = new Date(time);
      return `${d.getMinutes()} ${d.getHours()} * * ${d.getDay()}`;
    }
    case 'custom':
      return repeat ?? '';
  }
}

// ─── Scheduler ───────────────────────────────────────────

/**
 * 定时提醒调度器
 *
 * 基于 node-cron，通过 EventEmitter 广播 'trigger' 事件，
 * 与 Notifier 等消费者解耦。
 */
export class Scheduler extends EventEmitter {
  private activeTasks = new Map<string, ScheduledTask>();

  /** 注册一条提醒 */
  scheduleReminder(reminder: Reminder): void {
    // 已存在则先移除
    if (this.activeTasks.has(reminder.id)) {
      this.activeTasks.get(reminder.id)!.destroy();
      this.activeTasks.delete(reminder.id);
    }

    const type = toReminderType(reminder.repeat);
    const expression = toCron(type, reminder.time, reminder.repeat);
    const isOnce = type === 'once';

    if (!expression || !nodeCron.validate(expression)) {
      this.emit('error', new Error(`无效 cron 表达式: "${expression}"`), reminder.id);
      return;
    }

    const task = nodeCron.schedule(
      expression,
      (ctx) => {
        const payload: TriggerPayload = {
          remindId: reminder.id,
          message: reminder.message,
          type,
          triggeredAt: ctx.dateLocalIso,
        };
        try {
          this.emit('trigger', payload);
        } catch (err) {
          this.emit('error', err as Error, reminder.id);
        }
      },
      { name: `remind_${reminder.id}`, maxExecutions: isOnce ? 1 : undefined },
    );

    // 单次任务自动销毁
    if (isOnce) {
      task.once('execution:finished', () => {
        task.destroy();
        this.activeTasks.delete(reminder.id);
        this.emit('destroyed', reminder.id);
      });
    }

    this.activeTasks.set(reminder.id, task);
  }

  /** 移除一条任务 */
  unschedule(remindId: string): void {
    const task = this.activeTasks.get(remindId);
    if (task) { task.destroy(); this.activeTasks.delete(remindId); }
  }

  /** 清空所有任务 */
  cancelAll(): void {
    for (const task of this.activeTasks.values()) task.destroy();
    this.activeTasks.clear();
  }

  get count(): number {
    return this.activeTasks.size;
  }
}
