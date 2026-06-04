import { LlmClient } from '../brain/llm-client.js';
import { TaskPlanSchema } from '../models/task.js';
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
  async parse(requirement: string, workingDir: string): Promise<ParsedPlan> {
    logger.info(`解析需求: ${requirement.slice(0, 50)}...`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`需求解析重试第 ${attempt} 次...`);
        }

        const raw = await this.llm.chatJson<unknown>({
          system: PLAN_PARSER_SYSTEM_PROMPT,
          user: `## 用户需求\n${requirement}\n\n## 工作目录\n${workingDir}\n\n请将需求分解为有序的任务列表。`,
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
}

const PLAN_PARSER_SYSTEM_PROMPT = `你是一个项目任务分解专家。你的任务是将用户的软件需求分解为有序、可执行的任务列表。

## 分解原则

1. **有序执行**：任务按依赖关系排列，前面的任务是后面的基础
2. **粒度适中**：每个任务应该可以在一次 Claude Code 对话中完成
3. **具体明确**：描述要包含具体要做什么，不要模糊
4. **验证环节**：最后一个任务应该是验证/测试
5. **一般 3-8 个任务**：不要太多也不要太少

## 任务描述要求

- 包含要创建/修改的文件
- 包含要实现的具体功能
- 包含技术细节（框架、库、API 等）
- 如果需要运行命令，说明命令

## 示例

用户需求: "用 Express 做一个 REST API，有用户认证和 CRUD"

分解:
1. "初始化项目" — npm init, 安装 express, 搭建基本 server.ts
2. "实现数据模型" — 定义 User 和 Resource 的 schema
3. "实现 CRUD API" — GET/POST/PUT/DELETE 端点
4. "实现认证" — JWT 认证中间件，登录/注册接口
5. "编写测试" — API 端点测试
6. "验证运行" — 启动服务，测试所有端点`;

