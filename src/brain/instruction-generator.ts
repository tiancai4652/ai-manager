import { LlmClient } from './llm-client.js';
import type { OutputAnalysis } from '../models/session-state.js';
import type { Task } from '../models/task.js';

/**
 * 指令生成结果
 */
export interface Instruction {
  /** 要发送到终端的内容 */
  content: string;
  /** 发送后等待时间 (ms) */
  waitFor: number;
}

/**
 * 指令生成器
 * 根据当前任务和终端状态，生成下一步要发送给编码 AI 的指令
 *
 * 使用纯文本而非 JSON 返回，避免长文本在 JSON 中被截断或转义错误
 */
export class InstructionGenerator {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  /**
   * 为新任务生成初始指令
   */
  async generateInitialInstruction(task: Task): Promise<Instruction> {
    const raw = await this.llm.chat({
      system: INSTRUCTOR_SYSTEM_PROMPT,
      user: `请为以下任务生成发送给 Claude Code 的指令：\n\n## 任务标题\n${task.title}\n\n## 任务描述\n${task.description}`,
      maxTokens: 2048,
    });
    return this.parseInstruction(raw);
  }

  /**
   * 根据输出分析结果，生成响应指令
   */
  async generateResponse(params: {
    task: Task;
    analysis: OutputAnalysis;
    recentOutput: string;
  }): Promise<Instruction> {
    const { task, analysis, recentOutput } = params;

    const raw = await this.llm.chat({
      system: INSTRUCTOR_SYSTEM_PROMPT,
      user: `## 当前任务\n${task.title}: ${task.description}\n\n## 终端状态\n${analysis.state}\n\n## 分析摘要\n${analysis.summary}\n\n## 终端最近输出\n\`\`\`\n${recentOutput}\n\`\`\`\n\n${analysis.suggestedAction ? `## 建议动作\n${analysis.suggestedAction}` : ''}\n\n请生成适当的响应指令。如果编码 AI 在等待确认，回复 Y；如果在等待更多信息，给出补充说明。`,
      maxTokens: 2048,
    });
    return this.parseInstruction(raw);
  }

  /**
   * 根据质量评审不通过的结果，生成修复指令
   */
  async generateFixInstruction(params: {
    task: Task;
    issues: string[];
    suggestedFix?: string;
  }): Promise<Instruction> {
    const { task, issues, suggestedFix } = params;

    const raw = await this.llm.chat({
      system: INSTRUCTOR_SYSTEM_PROMPT,
      user: `## 任务\n${task.title}: ${task.description}\n\n## 发现的问题\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n${suggestedFix ? `## 修复建议\n${suggestedFix}` : ''}\n\n请生成修复指令，让编码 AI 修正上述问题。指令要具体、可操作。`,
      maxTokens: 2048,
    });
    return this.parseInstruction(raw);
  }

  /**
   * 解析纯文本响应为 Instruction
   * 格式: 第一行是 WAIT:数字，其余是 CONTENT
   * 或者纯文本（没有 WAIT 行时默认 3000ms）
   */
  private parseInstruction(raw: string): Instruction {
    const lines = raw.trim().split('\n');
    let waitFor = 3000;
    let contentLines: string[] = [];

    for (const line of lines) {
      const waitMatch = line.match(/^WAIT\s*[:：]\s*(\d+)/i);
      if (waitMatch) {
        waitFor = parseInt(waitMatch[1], 10);
        continue;
      }
      // 跳过 "CONTENT:" 前缀行
      if (line.match(/^CONTENT\s*[:：]\s*/i)) {
        contentLines.push(line.replace(/^CONTENT\s*[:：]\s*/i, ''));
        continue;
      }
      contentLines.push(line);
    }

    const content = contentLines.join('\n').trim();
    if (!content) {
      // 如果解析失败，把整个 raw 当作指令
      return { content: raw.trim(), waitFor };
    }
    return { content, waitFor };
  }
}

const INSTRUCTOR_SYSTEM_PROMPT = `你是一个编码任务指令生成专家。你的任务是为 Claude Code 生成精确的指令。

## 原则

1. 指令要具体明确，包含所有必要上下文
2. 一次一个任务
3. 简洁高效，直接说目标
4. 用中文写指令
5. **不要包含任何代码**（编码 AI 会自己写）

## 输出格式

严格按以下格式输出（第一行是等待时间，后面是指令内容）：

WAIT: 毫秒数（简单2000，中等5000，复杂8000）
具体的指令文本，可以多行描述要做什么。`;
