import { LlmClient } from './llm-client.js';
import type { OutputAnalysis } from '../models/session-state.js';
import type { OutputBuffer } from '../terminal/output-buffer.js';

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
   */
  async analyze(buffer: OutputBuffer, taskDescription: string): Promise<OutputAnalysis> {
    const recentOutput = buffer.getRecentLines(80);

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

const ANALYZER_SYSTEM_PROMPT = `你是一个终端输出分析专家。你的任务是分析一个编码 AI（如 Claude Code）的终端输出，判断它当前的状态。

## 状态定义

- **working**: 正在执行任务。特征：输出正在进行中，有进度信息，文件正在被创建/修改
- **waiting_input**: 等待用户输入。特征：出现提示符等待回答（如 Y/N 选择、要输入文件名等）
- **idle**: 空闲。特征：命令执行完毕，回到 shell 提示符，等待新命令
- **error**: 出现错误。特征：有明显的错误信息、红色错误输出、进程崩溃
- **completed**: 任务完成。特征：编码 AI 输出了完成信息、所有文件已创建
- **unknown**: 无法判断

## 分析要点

1. 关注最后的几行输出——状态通常由最近的输出决定
2. 注意区分"还在处理中"和"已经完成"
3. Claude Code 在等待权限确认时会出现 [y/n] 类似的提示
4. 如果输出中包含测试通过、文件创建成功等信息，倾向于 completed
5. 如果有明显的 Error/Failed/exception 但还在运行中，标记为 error

请准确判断状态并给出简要总结。`;
