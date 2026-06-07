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
   * 为新任务生成初始指令（含 NEED_HUMAN 协议）
   */
  async generateInitialInstruction(task: Task, contextBlock?: string): Promise<Instruction> {
    const raw = await this.llm.chat({
      system: INSTRUCTOR_BASE_PROMPT + NEED_HUMAN_PROTOCOL,
      user: `请为以下任务生成发送给 Claude Code 的指令：\n\n## 任务标题\n${task.title}\n\n## 任务描述\n${task.description}${contextBlock ?? ''}`,
      maxTokens: 2048,
    });
    return this.parseInstruction(raw);
  }

  /**
   * 根据输出分析结果，生成响应指令（无需 NEED_HUMAN 协议，节省 token）
   */
  async generateResponse(params: {
    task: Task;
    analysis: OutputAnalysis;
    recentOutput: string;
    contextBlock?: string;
  }): Promise<Instruction> {
    const { task, analysis, recentOutput, contextBlock } = params;

    const raw = await this.llm.chat({
      system: INSTRUCTOR_BASE_PROMPT,
      user: `## 当前任务\n${task.title}: ${task.description}\n\n## 终端状态\n${analysis.state}\n\n## 分析摘要\n${analysis.summary}\n\n## 终端最近输出\n\`\`\`\n${recentOutput}\n\`\`\`\n\n${analysis.suggestedAction ? `## 建议动作\n${analysis.suggestedAction}` : ''}${contextBlock ?? ''}\n\n请生成适当的响应指令。如果编码 AI 在等待确认，回复 Y；如果在等待更多信息，给出补充说明。`,
      maxTokens: 2048,
    });
    return this.parseInstruction(raw);
  }

  /**
   * 根据质量评审不通过的结果，生成修复指令（含 NEED_HUMAN 协议）
   */
  async generateFixInstruction(params: {
    task: Task;
    issues: string[];
    suggestedFix?: string;
    contextBlock?: string;
  }): Promise<Instruction> {
    const { task, issues, suggestedFix, contextBlock } = params;

    const raw = await this.llm.chat({
      system: INSTRUCTOR_BASE_PROMPT + NEED_HUMAN_PROTOCOL,
      user: `## 任务\n${task.title}: ${task.description}\n\n## 发现的问题\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n${suggestedFix ? `## 修复建议\n${suggestedFix}` : ''}${contextBlock ?? ''}\n\n请生成修复指令，让编码 AI 修正上述问题。指令要具体、可操作。`,
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

/** 指令生成核心规则（每次调用都使用） */
const INSTRUCTOR_BASE_PROMPT = `Generate instructions for Claude Code. Rules:
1. Specific, include necessary context
2. One task per instruction
3. Concise, state the goal directly
4. MUST output in Chinese
5. NO code (the coding AI writes its own code)

Output: first line WAIT:ms (simple=2000, medium=5000, complex=8000), then instruction text in Chinese.`;

/** 人工介入协议（仅在初始指令和修复指令时附加） */
const NEED_HUMAN_PROTOCOL = `

## 人工介入
遇到以下情况输出 [NEED_HUMAN]原因[/NEED_HUMAN]：需物理操作、私有信息(密码/key/地址)、权限认证、危险确认、环境依赖。
代码错误、依赖缺失、测试失败等自行处理，不算人工介入。`;
