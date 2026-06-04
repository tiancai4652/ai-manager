/**
 * 终端会话状态枚举
 * 表示被控制的编码 AI (Claude Code / CodeX) 当前的状态
 */
export type SessionState =
  | 'working'        // 正在执行任务（输出中）
  | 'waiting_input'  // 等待用户输入（提示符闪烁）
  | 'idle'           // 空闲（命令执行完毕，回到 shell）
  | 'error'          // 出现错误
  | 'completed'      // 任务完成
  | 'unknown';       // 无法判断

/**
 * 终端输出分析结果
 */
export interface OutputAnalysis {
  state: SessionState;
  /** 终端当前在做什么（一句话总结） */
  summary: string;
  /** 发现的问题列表 */
  detectedIssues: string[];
  /** 是否需要人工介入 */
  needsIntervention: boolean;
  /** 建议的下一步动作 */
  suggestedAction?: string;
  /** 如果 waiting_input，这里放需要回答的内容 */
  suggestedInput?: string;
}

/**
 * 终端会话配置
 */
export interface TerminalConfig {
  /** 要启动的命令，如 'claude' 或 'codex' */
  command: string;
  /** 命令参数 */
  args: string[];
  /** 工作目录 */
  cwd: string;
  /** 终端列数 */
  cols: number;
  /** 终端行数 */
  rows: number;
  /** 环境变量 */
  env?: Record<string, string>;
}
