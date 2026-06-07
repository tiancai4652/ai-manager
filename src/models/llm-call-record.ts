/**
 * LLM 调用记录
 *
 * 记录每次大脑 LLM 调用的详细信息，
 * 用于运行分析、token 优化和成本估算。
 * 保存到 .aimanager/run-report.json 和 run-report.md
 */

/** 单次 LLM 调用记录 */
export interface LLMCallRecord {
  /** ISO 时间戳 */
  timestamp: string;
  /** 调用类型: 普通对话 or 结构化 JSON */
  type: 'chat' | 'chatJson';
  /** 调用用途（如 '生成指令', '输出分析', '质量评审'） */
  purpose: string;
  /** 使用的模型 */
  model: string;
  /** 调用方式: claude-cli or api */
  mode: string;
  /** 耗时 (ms) */
  durationMs: number;
  /** 输入字符数 (system + user prompt) */
  inputChars: number;
  /** 输出字符数 */
  outputChars: number;
  /** 估算 token 数 */
  estimatedTokens: number;
  /** 调用是否成功 */
  success: boolean;
  /** 失败时的错误信息 */
  error?: string;
}

/** 运行报告 */
export interface RunReport {
  /** 报告唯一 ID */
  id: string;
  /** 用户需求 */
  requirement: string;
  /** 开始时间 (ISO) */
  startedAt: string;
  /** 结束时间 (ISO) */
  completedAt: string;
  /** 总用时 (ms) */
  totalDurationMs: number;
  /** 所有 LLM 调用记录 */
  llmCalls: LLMCallRecord[];
  /** 汇总统计 */
  summary: {
    totalCalls: number;
    totalEstimatedTokens: number;
    totalInputChars: number;
    totalOutputChars: number;
    avgCallDurationMs: number;
    byPurpose: Record<string, { calls: number; tokens: number; avgMs: number }>;
  };
}
