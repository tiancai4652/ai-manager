import { z } from 'zod/v4';

/**
 * 任务状态
 */
export type TaskStatus =
  | 'pending'       // 等待执行
  | 'in_progress'   // 执行中
  | 'reviewing'     // 质量评审中
  | 'completed'     // 已完成
  | 'failed'        // 失败（重试耗尽）
  | 'blocked';      // 被阻塞（需要人工介入）

/**
 * 质量评审结果
 */
export interface ReviewResult {
  passed: boolean;
  /** 0-10 分 */
  score: number;
  issues: string[];
  /** 如果不通过，建议的修复指令 */
  suggestedFix?: string;
}

/**
 * 单个任务
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** 已尝试次数 */
  attempts: number;
  /** 最大重试次数 */
  maxAttempts: number;
  /** 发送过的指令历史 */
  instructionHistory: string[];
  /** 评审结果历史 */
  reviewResults: ReviewResult[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Zod schema for validating LLM-generated task plans
 */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  maxAttempts: z.number().default(3),
});

export const TaskPlanSchema = z.object({
  tasks: z.array(TaskSchema),
});
