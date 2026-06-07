import { LlmClient } from '../brain/llm-client.js';
import { TaskPlanSchema } from '../models/task.js';
import type { ProjectContext } from '../models/project-context.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

/**
 * 需求解析结果
 */
export interface ParsedPlan {
  /** 解析后的任务列表 */
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    maxAttempts: number;
  }>;
}

/**
 * 需求解析器
 * 将用户的高层需求分解为有序的任务列表
 */
export class PlanParser {
  private llm: LlmClient;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  /**
   * 将用户需求解析为任务列表
   * MVP 阶段：先拆为多个任务（后续支持依赖关系）
   */
  async parse(requirement: string, workingDir: string, projectContext?: ProjectContext): Promise<ParsedPlan> {
    logger.info(`解析需求: ${requirement.slice(0, 50)}... (模式: ${projectContext?.mode ?? 'new'})`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`需求解析重试第 ${attempt} 次...`);
        }

        const raw = await this.llm.chatJson<unknown>({
          system: this.buildSystemPrompt(projectContext),
          user: this.buildUserPrompt(requirement, workingDir, projectContext),
          schemaName: 'task_plan',
          schemaDescription: '将用户需求分解为有序的任务列表',
          schema: {
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string', description: '简短任务标题' },
                    description: {
                      type: 'string',
                      description: '详细的任务描述，包含具体要做什么',
                    },
                    maxAttempts: {
                      type: 'number',
                      description: '最大重试次数，默认 3',
                    },
                  },
                  required: ['id', 'title', 'description'],
                },
              },
            },
            required: ['tasks'],
          },
        });

        logger.debug(`LLM 返回原始数据: ${JSON.stringify(raw).slice(0, 300)}`);

        // 用 zod 做二次验证
        const parsed = TaskPlanSchema.parse(raw);

        // 确保每个 task 有唯一 id
        const tasks = parsed.tasks.map(t => ({
          ...t,
          id: t.id || uuid(),
          maxAttempts: t.maxAttempts || 3,
        }));

        logger.info(`解析完成，共 ${tasks.length} 个任务:`);
        tasks.forEach((t, i) => logger.info(`  ${i + 1}. ${t.title}`));

        return { tasks };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(`需求解析第 ${attempt + 1} 次失败: ${lastError.message}`);

        // 如果是 Zod 验证错误，可能是 LLM 返回格式不对，打印更多信息
        if (err && typeof err === 'object' && 'issues' in err) {
          const zodErr = err as { issues: Array<{ path: string[]; message: string }> };
          logger.warn(`Zod 验证详情: ${JSON.stringify(zodErr.issues)}`);
        }
      }
    }

    throw new Error(
      `需求解析在 ${maxRetries} 次尝试后仍然失败: ${lastError?.message}\n` +
      `请检查模型是否正确，或需求是否过于模糊。`
    );
  }

  /**
   * 根据 mode 选择 system prompt
   */
  private buildSystemPrompt(projectContext?: ProjectContext): string {
    if (projectContext?.mode === 'modify') {
      return PLAN_PARSER_BASE_PROMPT + PLAN_PARSER_MODIFY_SUFFIX;
    }
    return PLAN_PARSER_BASE_PROMPT + PLAN_PARSER_NEW_SUFFIX;
  }

  /**
   * 构建 user prompt，modify 模式时附加项目上下文
   */
  private buildUserPrompt(requirement: string, workingDir: string, projectContext?: ProjectContext): string {
    if (projectContext?.mode === 'modify') {
      return [
        '## 用户需求',
        requirement,
        '',
        '## 现有项目结构',
        '```',
        projectContext.fileTree,
        '```',
        '',
        '## 现有 package.json',
        '```json',
        projectContext.packageInfo,
        '```',
        '',
        '## 现有配置文件',
        projectContext.configFiles,
        '',
        '## 关键源文件',
        projectContext.sourceFiles,
        '',
        '## 已有文档摘要',
        projectContext.existingReadme,
        '',
        `这是一个已有项目（${workingDir}）。请在现有架构基础上规划修改任务。`,
      ].join('\n');
    }

    return `## 用户需求\n${requirement}\n\n## 工作目录\n${workingDir}\n\n请将需求分解为有序的任务列表。`;
  }
}

/** 任务分解共享规则 */
const PLAN_PARSER_BASE_PROMPT = `你是任务分解专家，将软件需求分解为有序、可执行的任务列表。

## 分解原则
1. 有序执行：按依赖关系排列
2. 粒度适中：每个任务可一次完成
3. 具体明确：描述包含具体做什么
4. 最后一个任务应该是验证/测试
5. 任务描述要包含：目标文件、具体功能、技术细节、要运行的命令`;

/** 新建项目模式附加 */
const PLAN_PARSER_NEW_SUFFIX = `

一般 3-8 个任务。`;

/** 修改已有项目模式附加 */
const PLAN_PARSER_MODIFY_SUFFIX = `

## 修改模式要点
- 先理解现有架构再动手
- 最小化变更，不重建已有功能
- 保持现有风格和命名约定
- 向后兼容，不破坏已有功能
- 明确指出要修改哪个文件、在什么位置
- 一般 2-6 个任务`;

