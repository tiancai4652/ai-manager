import type { Task, TaskStatus, ReviewResult } from '../models/task.js';
import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger.js';

/**
 * 任务管理器
 * 管理任务的生命周期：创建、更新状态、获取下一个任务
 */
export class TaskManager {
  private tasks: Task[] = [];

  /** 从解析结果创建任务 */
  createTasks(parsedTasks: Array<{
    id: string;
    title: string;
    description: string;
    maxAttempts: number;
  }>): void {
    this.tasks = parsedTasks.map(pt => ({
      id: pt.id,
      title: pt.title,
      description: pt.description,
      status: 'pending' as TaskStatus,
      attempts: 0,
      maxAttempts: pt.maxAttempts,
      instructionHistory: [],
      reviewResults: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }

  /** 获取所有任务 */
  getAll(): Task[] {
    return [...this.tasks];
  }

  /** 获取下一个待执行的任务 */
  getNextPending(): Task | undefined {
    return this.tasks.find(t => t.status === 'pending' || t.status === 'in_progress');
  }

  /** 获取指定任务 */
  getById(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** 更新任务状态 */
  updateStatus(id: string, status: TaskStatus): void {
    const task = this.getById(id);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
      logger.debug(`Task "${task.title}" → ${status}`);
    }
  }

  /** 记录发送的指令 */
  recordInstruction(id: string, instruction: string): void {
    const task = this.getById(id);
    if (task) {
      task.instructionHistory.push(instruction);
      task.attempts++;
      task.updatedAt = new Date();
    }
  }

  /** 记录评审结果 */
  recordReview(id: string, result: ReviewResult): void {
    const task = this.getById(id);
    if (task) {
      task.reviewResults.push(result);
      task.updatedAt = new Date();
    }
  }

  /** 检查任务是否还可以重试 */
  canRetry(id: string): boolean {
    const task = this.getById(id);
    return task ? task.attempts < task.maxAttempts : false;
  }

  /** 获取进度摘要 */
  getProgressSummary(): string {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.status === 'completed').length;
    const failed = this.tasks.filter(t => t.status === 'failed').length;
    const inProgress = this.tasks.filter(t => t.status === 'in_progress').length;
    return `${completed}/${total} 完成, ${inProgress} 执行中, ${failed} 失败`;
  }

  /** 检查所有任务是否都已完成 */
  allDone(): boolean {
    return this.tasks.length > 0 && this.tasks.every(
      t => t.status === 'completed' || t.status === 'failed'
    );
  }
}
