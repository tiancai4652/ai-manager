/**
 * 提醒数据模型
 */

/** 提醒重复模式 */
export type RepeatMode = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | string;

/** 提醒数据接口 */
export interface Reminder {
  /** 唯一标识符 */
  id: string;
  /** 提醒内容文本 */
  message: string;
  /** 提醒触发时间 (ISO 8601 字符串) */
  time: string;
  /** 重复规则 (可选, 不设置则为单次) */
  repeat?: RepeatMode;
  /** 是否启用 (默认 true) */
  enabled: boolean;
  /** 创建时间 (ISO 8601) */
  createdAt: string;
  /** 最后更新时间 (ISO 8601) */
  updatedAt: string;
}

/** 持久化存储结构 */
export interface ReminderStore {
  reminders: Reminder[];
  version: number;
}
