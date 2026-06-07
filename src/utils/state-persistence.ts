import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStatus, ReviewResult } from '../models/task.js';

/**
 * 可序列化的任务状态快照
 */
export interface TaskSnapshot {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  instructionHistory: string[];
  reviewResults: ReviewResult[];
}

/**
 * 可序列化的运行状态
 */
export interface RunState {
  /** 运行 ID */
  id: string;
  /** 用户需求 */
  requirement: string;
  /** 工作目录 */
  workingDir: string;
  /** 编码 AI 类型 */
  agentType: 'claude-code' | 'codex';
  /** 大脑模型 */
  brainModel: string;
  /** 任务快照列表 */
  tasks: TaskSnapshot[];
  /** 当前任务索引 */
  currentTaskIndex: number;
  /** 运行状态 */
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  /** 创建时间 (ISO) */
  startedAt: string;
  /** 最后保存时间 (ISO) */
  savedAt: string;
  /** 需求文档路径 */
  requirementDocPath?: string;
}

/**
 * 状态持久化工具
 *
 * 将运行状态保存到 .aimanager/state.json，支持断点续跑。
 */
export class StatePersistence {
  private statePath: string;

  constructor(workingDir: string) {
    const dir = join(workingDir, '.aimanager');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.statePath = join(dir, 'state.json');
  }

  /** 保存当前运行状态 */
  save(state: RunState): void {
    state.savedAt = new Date().toISOString();
    try {
      writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // 状态保存失败不影响主流程
    }
  }

  /** 读取上次的状态 */
  load(): RunState | null {
    if (!existsSync(this.statePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf-8'));
      return raw as RunState;
    } catch {
      return null;
    }
  }

  /** 标记运行完成 */
  markCompleted(): void {
    const state = this.load();
    if (state) {
      state.status = 'completed';
      this.save(state);
    }
  }

  /** 标记运行失败 */
  markFailed(): void {
    const state = this.load();
    if (state) {
      state.status = 'failed';
      this.save(state);
    }
  }

  /** 标记运行中断 */
  markInterrupted(): void {
    const state = this.load();
    if (state) {
      state.status = 'interrupted';
      this.save(state);
    }
  }

  /** 状态文件路径 */
  get path(): string {
    return this.statePath;
  }

  /** 是否存在可恢复的状态 */
  canResume(): boolean {
    const state = this.load();
    if (!state) return false;
    return state.status === 'running' || state.status === 'interrupted' || state.status === 'failed';
  }
}
