import { LlmClient } from './llm-client.js';
import type { OutputAnalysis } from '../models/session-state.js';
import type { OutputBuffer } from '../terminal/output-buffer.js';
import { OutputFilter } from '../terminal/output-filter.js';

/**
 * 输出分析器
 * 用 LLM 分析终端输出，判断编码 AI 的当前状态
 */
export class OutputAnalyzer {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  /**
   * 分析终端输出，判断当前状态
   * @param buffer 输出缓冲区
   * @param taskDescription 当前任务的描述（帮助 LLM 理解上下文）
   * @param maxLines 取最近多少行终端输出（默认 30）
   */
  async analyze(buffer: OutputBuffer, taskDescription: string, maxLines = 30): Promise<OutputAnalysis> {
    const recentOutput = OutputFilter.compress(buffer.getRecentLines(maxLines));

    if (recentOutput.trim().length === 0) {
      return {
        state: 'idle',
        summary: '终端无输出',
        detectedIssues: [],
        needsIntervention: false,
      };
    }

    const result = await this.llm.chatJson<OutputAnalysis>({
      system: ANALYZER_SYSTEM_PROMPT,
      user: `## 当前任务\n${taskDescription}\n\n## 终端最近输出\n\`\`\`\n${recentOutput}\n\`\`\``,
      schemaName: 'output_analysis',
      schemaDescription: '分析终端输出，判断编码 AI 的当前状态',
      schema: {
        properties: {
          state: {
            type: 'string',
            enum: ['working', 'waiting_input', 'idle', 'error', 'completed', 'unknown'],
            description: '终端当前状态',
          },
          summary: {
            type: 'string',
            description: '一句话总结终端当前在做什么',
          },
          detectedIssues: {
            type: 'array',
            items: { type: 'string' },
            description: '发现的问题列表',
          },
          needsIntervention: {
            type: 'boolean',
            description: '是否需要人工介入',
          },
          suggestedAction: {
            type: 'string',
            description: '建议的下一步动作',
          },
          suggestedInput: {
            type: 'string',
            description: '如果 waiting_input，这里放建议输入的内容',
          },
        },
        required: ['state', 'summary', 'detectedIssues', 'needsIntervention'],
      },
    });

    return result;
  }
}

const ANALYZER_SYSTEM_PROMPT = `Analyze terminal output from a coding AI (Claude Code). Determine its current state.

States: working | waiting_input | idle | error | completed | unknown
- working: actively processing, progress shown, files being modified
- waiting_input: prompt awaiting response (Y/N, filename, etc.)
- idle: command finished, back at shell prompt
- error: visible errors, crashes, exceptions
- completed: success messages, files created, tests passed
- unknown: cannot determine

Rules:
- Focus on LAST few lines — state is determined by recent output
- Distinguish "still processing" from "finished"
- [y/n] prompts = waiting_input
- Tests passing / files created = completed
- Error/Failed/exception while running = error

needsIntervention=true ONLY for: physical actions, private info (passwords/keys/addresses), dangerous confirmations, environment config that cannot be automated.
needsIntervention=false for: Y/N confirmations, missing deps, compile errors, test failures (brain handles these).

IMPORTANT: summary MUST be in Chinese, under 20 words. Return JSON.`;
