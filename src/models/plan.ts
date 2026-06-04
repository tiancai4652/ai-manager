import type { Task } from './task.js';

/**
 * 执行计划整体状态
 */
export type PlanStatus =
  | 'planning'   // 正在解析需求、分解任务
  | 'executing'  // 正在执行任务
  | 'completed'  // 全部完成
  | 'failed'     // 整体失败
  | 'paused';    // 用户暂停

/**
 * 执行计划：用户需求的完整分解
 */
export interface Plan {
  id: string;
  /** 用户原始需求文本 */
  userRequirement: string;
  /** 任务列表（有序执行） */
  tasks: Task[];
  /** 当前执行到的任务索引 */
  currentTaskIndex: number;
  /** 整体状态 */
  status: PlanStatus;
  /** 工作目录 */
  workingDir: string;
  /** 使用的编码 AI 类型 */
  agentType: 'claude-code' | 'codex';
  startedAt: Date;
  completedAt?: Date;
}
