import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Reminder, ReminderStore } from '../models/Reminder.js';

const DEFAULT_STORE: ReminderStore = { reminders: [], version: 1 };

/** 项目根目录 */
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '..', '..', '..', '..');

/** 默认存储路径: 项目根/reminders.json */
export const DEFAULT_REMINDERS_PATH = resolve(PROJECT_ROOT, 'reminders.json');

/**
 * JSON 文件提醒存储
 *
 * 提供加载、保存、增删改查操作。
 * 文件不存在时自动创建默认空存储。
 */
export class ReminderStorage {
  private filePath: string;
  private store: ReminderStore;

  constructor(filePath: string = DEFAULT_REMINDERS_PATH) {
    this.filePath = resolve(filePath);
    this.store = this.load();
  }

  // ─── 读取 ────────────────────────────────────────

  getAll(): Reminder[] {
    return [...this.store.reminders];
  }

  getById(id: string): Reminder | undefined {
    return this.store.reminders.find((r) => r.id === id);
  }

  getEnabled(): Reminder[] {
    return this.store.reminders.filter((r) => r.enabled);
  }

  search(keyword: string): Reminder[] {
    const lower = keyword.toLowerCase();
    return this.store.reminders.filter((r) =>
      r.message.toLowerCase().includes(lower),
    );
  }

  get count(): number {
    return this.store.reminders.length;
  }

  // ─── 写入 ────────────────────────────────────────

  add(input: { message: string; time: string; repeat?: string; enabled?: boolean }): Reminder {
    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: `rmd_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      message: input.message,
      time: input.time,
      repeat: input.repeat,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.reminders.push(reminder);
    this.persist();
    return reminder;
  }

  remove(id: string): boolean {
    const idx = this.store.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.store.reminders.splice(idx, 1);
    this.persist();
    return true;
  }

  update(id: string, patch: Partial<Pick<Reminder, 'message' | 'time' | 'repeat' | 'enabled'>>): Reminder | null {
    const r = this.store.reminders.find((r) => r.id === id);
    if (!r) return null;
    if (patch.message !== undefined) r.message = patch.message;
    if (patch.time !== undefined) r.time = patch.time;
    if (patch.repeat !== undefined) r.repeat = patch.repeat;
    if (patch.enabled !== undefined) r.enabled = patch.enabled;
    r.updatedAt = new Date().toISOString();
    this.persist();
    return r;
  }

  toggle(id: string): Reminder | null {
    const r = this.store.reminders.find((r) => r.id === id);
    if (!r) return null;
    r.enabled = !r.enabled;
    r.updatedAt = new Date().toISOString();
    this.persist();
    return r;
  }

  /** 重新从文件加载（热重载用） */
  reload(): void {
    this.store = this.load();
  }

  // ─── 持久化 ──────────────────────────────────────

  private load(): ReminderStore {
    try {
      if (!existsSync(this.filePath)) {
        return this.write({ ...DEFAULT_STORE });
      }
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as ReminderStore;
      if (!Array.isArray(data.reminders)) {
        console.warn('[ReminderStorage] 配置缺少 reminders 数组，使用默认空列表');
        return { ...DEFAULT_STORE };
      }
      return data;
    } catch (err) {
      console.warn(`[ReminderStorage] 加载失败 (${(err as Error).message})，使用默认空列表`);
      return { ...DEFAULT_STORE };
    }
  }

  private persist(): void {
    this.write(this.store);
  }

  private write(data: ReminderStore): ReminderStore {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }
}
