import { LlmClient } from './llm-client.js';
import type { Task } from '../models/task.js';
import type { ReviewResult } from '../models/task.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * 质量评审器
 * 在任务完成后检查是否真的做好了
 */
export class QualityReviewer {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  /**
   * 评审任务完成质量
   * @param task 当前任务
   * @param workingDir 工作目录
   * @param terminalOutput 终端的完整输出（清洗后）
   */
  async review(task: Task, workingDir: string, terminalOutput: string): Promise<ReviewResult> {
    // 第一步：快速检查（不需要 LLM）
    const quickCheck = this.quickCheck(task, workingDir);
    if (!quickCheck.passed) {
      logger.info(`Quick check failed: ${quickCheck.issues.join('; ')}`);
      return quickCheck;
    }

    // 第二步：LLM 审查（看文件结构 + 关键文件内容 + 终端输出）
    const fileTree = this.getFileTree(workingDir, 2);
    const keyFiles = this.readKeyFiles(workingDir);

    // 终端输出截取最近 2000 字符，避免过长
    const terminalSnippet = terminalOutput
      ? `\n## 终端输出（最近）\n\`\`\`\n${terminalOutput.slice(-2000)}\n\`\`\`\n`
      : '';

    const result = await this.llm.chatJson<ReviewResult>({
      system: REVIEWER_SYSTEM_PROMPT,
      user: `## 任务\n${task.title}: ${task.description}\n\n## 当前文件结构\n\`\`\`\n${fileTree}\n\`\`\`\n\n## 关键文件内容\n${keyFiles}\n${terminalSnippet}根据以上信息判断任务是否完成。`,
      schemaName: 'review_result',
      schemaDescription: '任务完成质量评审',
      maxTokens: 512,
      schema: {
        properties: {
          passed: {
            type: 'boolean',
            description: '是否通过评审',
          },
          score: {
            type: 'number',
            description: '0-10 分',
          },
          issues: {
            type: 'array',
            items: { type: 'string' },
            description: '发现的问题',
          },
          suggestedFix: {
            type: 'string',
            description: '如果不通过，建议的修复指令',
          },
        },
        required: ['passed', 'score', 'issues'],
      },
    });

    return result;
  }

  /**
   * 快速检查（不用 LLM）
   */
  private quickCheck(task: Task, workingDir: string): ReviewResult {
    const issues: string[] = [];

    // 检查工作目录是否有文件（任务应该会产生文件）
    if (existsSync(workingDir)) {
      const files = readdirSync(workingDir);
      if (files.length === 0) {
        issues.push('工作目录为空，没有生成任何文件');
      }
    } else {
      issues.push('工作目录不存在');
    }

    if (issues.length > 0) {
      return {
        passed: false,
        score: 0,
        issues,
        suggestedFix: `检查任务 "${task.title}" 的执行情况，确保所有必要文件已创建`,
      };
    }

    return { passed: true, score: 5, issues: [] };
  }

  /**
   * 获取目录树（简易版）
   */
  private getFileTree(dir: string, maxDepth: number, prefix = ''): string {
    if (maxDepth <= 0 || !existsSync(dir)) return '';

    const entries = readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .slice(0, 30);

    let result = '';
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      result += `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
      if (entry.isDirectory()) {
        result += this.getFileTree(fullPath, maxDepth - 1, prefix + '  ');
      }
    }
    return result;
  }

  /**
   * 读取关键文件的内容（用于 LLM 审查）
   */
  private readKeyFiles(workingDir: string): string {
    const keyExtensions = ['.ts', '.js', '.json', '.md', '.py', '.rs'];
    const maxFileSize = 3000;
    let result = '';

    try {
      const entries = readdirSync(workingDir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules');

      for (const entry of entries.slice(0, 10)) {
        if (entry.isFile()) {
          const ext = extname(entry.name);
          if (keyExtensions.includes(ext)) {
            const fullPath = join(workingDir, entry.name);
            const stat = statSync(fullPath);
            if (stat.size <= maxFileSize) {
              const content = readFileSync(fullPath, 'utf-8');
              result += `\n### ${entry.name}\n\`\`\`\n${content.slice(0, maxFileSize)}\n\`\`\`\n`;
            }
          }
        }
      }
    } catch {
      // 忽略读取错误
    }

    return result || '(无关键文件可读取)';
  }
}

const REVIEWER_SYSTEM_PROMPT = `Evaluate if a coding task is complete and quality is acceptable.

Criteria: functionality completeness > code quality > file structure.
Score: 8-10 = fully meets requirements, 5-7 = minor issues, 3-4 = partial, 0-2 = not done.

Rules:
- Terminal output showing success = task likely complete
- Only mark failed for clear problems
- Don't demand perfection — focus on functionality
- Don't require running interactive tests
- If not passed, give specific fix suggestions

Return JSON.`;
