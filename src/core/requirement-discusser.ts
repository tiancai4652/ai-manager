import * as readline from 'node:readline';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LlmClient } from '../brain/llm-client.js';
import type { ProjectContext } from '../models/project-context.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

/**
 * 需求讨论结果
 */
export interface DiscussionResult {
  /** 经过讨论后完善的最终需求文档 */
  refinedRequirement: string;
  /** 讨论轮数 */
  rounds: number;
  /** 需求文档保存路径 */
  documentPath: string;
}

/**
 * LLM 返回的讨论响应
 */
interface DiscussionResponse {
  needsMoreInfo: boolean;
  questions: string[];
  currentUnderstanding: string;
}

/**
 * 需求讨论器
 * 在执行之前，用 LLM 和用户多轮对话，把模糊的需求澄清
 * 最终生成需求文档，用户确认后保存到 .aimanager/ 目录
 */
export class RequirementDiscusser {
  private llm: LlmClient;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private projectContext?: ProjectContext;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  /**
   * 启动需求讨论
   * @param initialRequirement 用户原始需求
   * @param workingDir 工作目录（用于保存需求文档）
   * @param projectContext 项目上下文（modify 模式时传入）
   */
  async discuss(initialRequirement: string, workingDir: string, projectContext?: ProjectContext): Promise<DiscussionResult> {
    this.projectContext = projectContext;

    const modeHint = projectContext?.mode === 'modify'
      ? chalk.yellow(' (修改已有项目)')
      : '';

    console.log(chalk.cyan('\n💬 需求讨论') + modeHint);
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.white(`你的需求: ${initialRequirement}`));
    console.log(chalk.gray('─'.repeat(50)));

    this.conversationHistory.push({
      role: 'user',
      content: initialRequirement,
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let rounds = 0;
    const maxRounds = 10;

    try {
      while (rounds < maxRounds) {
        rounds++;

        const response = await this.analyzeAndAsk();

        if (response.currentUnderstanding) {
          console.log(chalk.gray(`\n  当前理解: ${response.currentUnderstanding}`));
        }

        if (!response.needsMoreInfo || response.questions.length === 0) {
          console.log(chalk.green('\n  ✅ 需求已经足够清晰。'));
          break;
        }

        console.log(chalk.yellow('\n  ❓ 需要确认几个问题:'));
        response.questions.forEach((q, i) => {
          console.log(chalk.yellow(`     ${i + 1}. ${q}`));
        });

        const answer = await this.promptUser(rl, '你的回答 (输入 "开始" 跳过讨论)');
        if (answer === null) break;

        if (this.isDoneSignal(answer)) {
          console.log(chalk.green('\n  ✅ 好的，按当前理解开始。'));
          break;
        }

        this.conversationHistory.push({
          role: 'assistant',
          content: `问题: ${response.questions.join('; ')}`,
        });
        this.conversationHistory.push({
          role: 'user',
          content: answer,
        });
      }
    } finally {
      rl.close();
    }

    // 生成需求文档
    let refined = await this.synthesizeRequirement(initialRequirement);

    // ====== 需求文档确认循环 ======
    const docPath = this.getDocPath(workingDir);
    let confirmed = false;

    const confirmRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (!confirmed) {
        console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.cyan('📋 完善后的需求文档:'));
        console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.white(refined));
        console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

        console.log(chalk.yellow('\n  请确认需求文档:'));
        console.log(chalk.yellow('    [Y] 确认无误，继续'));
        console.log(chalk.yellow('    [E] 我有补充或修改'));
        console.log(chalk.yellow('    [Q] 取消退出'));

        const choice = await this.promptUser(confirmRl, '你的选择 [Y/E/Q]');

        if (choice === null || (choice && choice.toLowerCase() === 'q')) {
          console.log(chalk.yellow('已取消。'));
          process.exit(0);
        }

        if (choice && choice.toLowerCase() === 'e') {
          // 用户要修改
          const supplement = await this.promptUser(confirmRl, '请输入你的补充或修改');
          if (supplement) {
            // 把用户反馈加入对话历史，重新生成
            this.conversationHistory.push(
              { role: 'assistant', content: `之前的需求文档:\n${refined}` },
              { role: 'user', content: `我要补充/修改: ${supplement}` },
            );
            refined = await this.synthesizeRequirement(initialRequirement);
            console.log(chalk.blue('\n  📝 已更新需求文档，请重新确认。'));
          }
          continue;
        }

        // 默认 Y
        confirmed = true;
      }
    } finally {
      confirmRl.close();
    }

    // 保存需求文档到文件
    this.saveDocument(docPath, refined, initialRequirement);
    console.log(chalk.green(`\n  📄 需求文档已保存: ${docPath}`));

    return { refinedRequirement: refined, rounds, documentPath: docPath };
  }

  /**
   * 让 LLM 分析需求并生成问题
   */
  private async analyzeAndAsk(): Promise<DiscussionResponse> {
    const conversation = this.conversationHistory
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
      .join('\n');

    const systemPrompt = this.buildDiscusserPrompt();

    return await this.llm.chatJson<DiscussionResponse>({
      system: systemPrompt,
      user: `## 对话历史\n${conversation}`,
      schemaName: 'discussion_response',
      schemaDescription: '分析用户需求，判断是否需要更多信息',
      schema: {
        properties: {
          needsMoreInfo: {
            type: 'boolean',
            description: '是否还需要更多信息才能开始执行',
          },
          questions: {
            type: 'array',
            items: { type: 'string' },
            description: '要问用户的问题列表',
          },
          currentUnderstanding: {
            type: 'string',
            description: '当前对需求的理解',
          },
        },
        required: ['needsMoreInfo', 'questions', 'currentUnderstanding'],
      },
    });
  }

  /**
   * 综合所有对话，生成最终的完善需求
   */
  private async synthesizeRequirement(original: string): Promise<string> {
    if (this.conversationHistory.length <= 1) {
      return original;
    }

    const conversation = this.conversationHistory
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
      .join('\n');

    return await this.llm.chat({
      system: SYNTHESIZER_SYSTEM_PROMPT,
      user: `## 原始需求\n${original}\n\n## 讨论记录\n${conversation}\n\n请综合以上所有信息，生成一份完善、清晰、可直接执行的需求描述。`,
      maxTokens: 2048,
    });
  }

  /**
   * 保存需求文档到文件
   */
  private saveDocument(path: string, refined: string, original: string): void {
    const dir = join(path, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const content = [
      `# 需求文档`,
      ``,
      `> 由 AI Manager 自动生成`,
      `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
      ``,
      `## 原始需求`,
      ``,
      original,
      ``,
      `---`,
      ``,
      refined,
      ``,
    ].join('\n');

    writeFileSync(path, content, 'utf-8');
  }

  /**
   * 获取需求文档保存路径
   */
  private getDocPath(workingDir: string): string {
    return join(workingDir, '.aimanager', 'requirement.md');
  }

  /**
   * 从终端获取用户输入
   */
  private promptUser(rl: readline.Interface, hint: string): Promise<string | null> {
    return new Promise((resolve) => {
      console.log(chalk.cyan(`\n  💬 ${hint}:`));
      rl.question('  > ', (answer: string) => {
        const trimmed = answer.trim();
        resolve(trimmed.length === 0 ? null : trimmed);
      });
    });
  }

  private isDoneSignal(text: string): boolean {
    const signals = ['开始', '好了', '就这样', 'go', 'start', 'ok', 'yes', 'done', '跳过'];
    const lower = text.toLowerCase();
    return signals.some(s => lower.includes(s));
  }

  /**
   * 构建 discusser system prompt
   * modify 模式时附加项目上下文，让 LLM 能问出针对性问题
   */
  private buildDiscusserPrompt(): string {
    let prompt = DISCUSSER_SYSTEM_PROMPT;

    if (this.projectContext?.mode === 'modify') {
      prompt += '\n\n' + DISCUSSER_MODIFY_CONTEXT;
      prompt += '\n\n## 现有项目信息\n';
      prompt += `### 项目结构\n\`\`\`\n${this.projectContext.fileTree}\n\`\`\`\n`;
      prompt += `### package.json\n\`\`\`json\n${this.projectContext.packageInfo}\n\`\`\`\n`;

      if (this.projectContext.existingReadme !== '(无 README)') {
        prompt += `### 已有文档摘要\n${this.projectContext.existingReadme}\n`;
      }
    }

    return prompt;
  }
}

const DISCUSSER_SYSTEM_PROMPT = `你是一个需求分析专家。你的任务是和用户讨论他们的软件开发需求，确保需求足够清晰、具体，可以交给编码 AI 直接执行。

## 分析要点

1. **技术栈**：用什么语言、框架、库？
2. **功能范围**：具体有哪些功能？边界在哪里？
3. **数据/存储**：需要数据库吗？什么数据？存哪里？
4. **接口/API**：有哪些端点？输入输出格式？
5. **UI/交互**：前端页面长什么样？有什么交互？
6. **非功能需求**：性能、安全、测试、部署要求？
7. **验收标准**：怎么判断做完了？

## 判断原则

- 如果需求已经**足够具体**，设置 needsMoreInfo=false
- 如果需求很模糊，必须问清楚
- 问题要**具体**，不要问太泛
- 一次最多问 3 个问题
- 用中文提问`;

const SYNTHESIZER_SYSTEM_PROMPT = `你是一个需求文档生成专家。根据用户的原始需求和讨论记录，生成一份完善、清晰、可直接交给编码 AI 执行的需求描述。

## 要求

1. 保留所有讨论中确定的技术决策
2. 结构化输出：用标题和列表组织
3. 包含明确的验收标准
4. 不要遗漏讨论中提到的任何细节
5. 用中文输出

## 格式示例

\`\`\`
## 项目概述
用 XXX 框架做一个 XXX

## 技术栈
- 语言: TypeScript
- 框架: Express
- 数据库: SQLite

## 功能需求
1. ...
2. ...

## 验收标准
- 能通过 npm start 启动
- 所有 API 端点可正常调用
\`\`\``;

const DISCUSSER_MODIFY_CONTEXT = `
## 重要：这是一个已有项目的修改任务

你已经有项目的结构和信息，请在提问时利用这些知识：

1. **引用现有代码**：例如 "我看到项目中已经有 routes/auth.ts，你希望在它的基础上扩展还是新建文件？"
2. **确认影响范围**：问清楚修改会影响哪些现有功能
3. **确认风格一致**：如果项目已有明确的模式（如 REST 风格、MVC 等），确认是否继续保持
4. **最小化假设**：不要假设需要重写已有代码，优先问"在现有基础上修改"相关的问题
5. **如果需求已经明确**（比如"给某个接口加个参数"），可以直接 needsMoreInfo=false，不需要再问`;
