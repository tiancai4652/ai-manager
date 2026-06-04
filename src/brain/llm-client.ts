import { execSync, spawnSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * "大脑"调用方式
 */
type BrainMode = 'claude-cli' | 'api';

/**
 * LLM 客户端封装
 *
 * 支持两种调用方式：
 * 1. claude-cli: 通过 `claude -p` 调用，复用终端里 Claude Code 的登录状态，零配置
 * 2. api: 直接调 Anthropic API，需要 ANTHROPIC_API_KEY
 *
 * brainMode='auto' 时优先尝试 claude -p，不可用时回退到 API
 */
export class LlmClient {
  private mode: BrainMode;
  private apiClient: Anthropic | null = null;
  private model: string;

  constructor(modelOverride?: string) {
    const config = loadConfig();
    this.model = modelOverride ?? config.brainModel;
    this.mode = this.resolveMode(config.brainMode, config.apiKey);
    logger.info(`大脑调用方式: ${this.mode}, 模型: ${this.model}`);
  }

  /**
   * 确定使用哪种调用方式
   */
  private resolveMode(
    brainMode: string,
    apiKey?: string,
  ): BrainMode {
    if (brainMode === 'api') {
      if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          'brainMode=api 但未设置 ANTHROPIC_API_KEY。运行: aimanager config set apiKey <key>',
        );
      }
      this.initApiClient(apiKey ?? process.env.ANTHROPIC_API_KEY!);
      return 'api';
    }

    if (brainMode === 'claude-cli') {
      this.assertClaudeCli();
      return 'claude-cli';
    }

    // auto: 优先 claude-cli
    if (this.isClaudeCliAvailable()) {
      return 'claude-cli';
    }

    // 回退到 API
    if (apiKey || process.env.ANTHROPIC_API_KEY) {
      this.initApiClient((apiKey ?? process.env.ANTHROPIC_API_KEY)!);
      return 'api';
    }

    throw new Error(
      '无法初始化大脑 LLM。两种方式都不可用：\n' +
      '  1. claude-cli: 未检测到 claude 命令，请安装 Claude Code (npm i -g @anthropic-ai/claude-code)\n' +
      '  2. api: 未设置 ANTHROPIC_API_KEY\n' +
      '请至少配置一种方式。',
    );
  }

  /**
   * 检查 claude 命令是否可用
   */
  private isClaudeCliAvailable(): boolean {
    try {
      execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private assertClaudeCli(): void {
    if (!this.isClaudeCliAvailable()) {
      throw new Error(
        'brainMode=claude-cli 但未检测到 claude 命令。请安装: npm i -g @anthropic-ai/claude-code',
      );
    }
  }

  private initApiClient(apiKey: string): void {
    this.apiClient = new Anthropic({ apiKey });
  }

  /**
   * 发送单轮请求，返回文本响应
   */
  async chat(params: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const { system, user } = params;
    logger.debug(`LLM request (${this.mode}): ${user.slice(0, 100)}...`);

    if (this.mode === 'claude-cli') {
      return this.chatViaCli(system, user);
    }
    return this.chatViaApi(params);
  }

  /**
   * 发送请求并解析为 JSON
   * claude-cli 模式下用 prompt 要求返回 JSON
   * api 模式下用 tool_use 强制结构化输出
   */
  async chatJson<T>(params: {
    system: string;
    user: string;
    schemaName: string;
    schemaDescription: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<T> {
    const { system, user, schemaName, schema } = params;
    logger.debug(`LLM JSON request (${this.mode}, ${schemaName}): ${user.slice(0, 100)}...`);

    if (this.mode === 'claude-cli') {
      return this.chatJsonViaCli<T>(system, user, schemaName, schema);
    }
    return this.chatJsonViaApi<T>(params);
  }

  // ── claude-cli 模式实现 ──

  /**
   * 用 spawnSync 调用 claude -p
   * 通过 stdin 管道传递 prompt，彻底绕开 shell 引号问题
   * 带自动重试：超时或临时错误最多重试 2 次
   */
  private callClaudeCli(prompt: string): string {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info(`claude -p 重试第 ${attempt} 次...`);
        }

        const result = spawnSync(
          'claude',
          ['--print', '--output-format', 'text', '--model', this.model],
          {
            input: prompt,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120_000,    // 2 分钟超时，复杂 prompt 需要更多时间
            maxBuffer: 1024 * 1024,
            shell: true,
          },
        );

        if (result.error) {
          // 超时类错误可以重试
          if (result.error.message.includes('ETIMEDOUT') || result.error.message.includes('timed out')) {
            lastError = result.error;
            continue;
          }
          throw new Error(`claude -p 调用失败: ${result.error.message}`);
        }
        if (result.status !== 0 && result.status !== null) {
          const stderr = result.stderr?.toString().trim() ?? '';
          throw new Error(`claude -p 退出码 ${result.status}: ${stderr}`);
        }

        return (result.stdout?.toString() ?? '').trim();

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 只有超时类错误才重试，其他错误直接抛出
        if (!lastError.message.includes('ETIMEDOUT') && !lastError.message.includes('timed out')) {
          throw lastError;
        }
      }
    }

    throw new Error(`claude -p 在 ${maxRetries + 1} 次尝试后仍然超时: ${lastError?.message}`);
  }

  private chatViaCli(system: string, user: string): string {
    const prompt = this.buildCliPrompt(system, user);
    const text = this.callClaudeCli(prompt);
    logger.debug(`LLM response: ${text.slice(0, 100)}...`);
    return text;
  }

  private chatJsonViaCli<T>(
    system: string,
    user: string,
    _schemaName: string,
    schema: Record<string, unknown>,
  ): T {
    // 让 claude -p 返回 JSON，强调不能有其他文本
    const jsonInstruction = [
      system,
      '',
      'CRITICAL: Respond with ONLY a JSON object. No explanation, no markdown, no text before or after.',
      'Schema:',
      JSON.stringify({ type: 'object', ...schema }, null, 2),
      '',
      'Do not include any text outside the JSON object.',
    ].join('\n');

    const prompt = this.buildCliPrompt(jsonInstruction, user);
    const raw = this.callClaudeCli(prompt);

    logger.info(`LLM JSON raw response (${raw.length} chars): ${raw.slice(0, 300)}`);

    // 提取并解析 JSON，带容错
    const jsonStr = this.extractJson(raw);
    logger.info(`Extracted JSON: ${jsonStr.slice(0, 300)}`);
    try {
      return JSON.parse(jsonStr) as T;
    } catch (parseErr) {
      logger.warn(`JSON 解析失败，原始输出:\n${raw.slice(0, 500)}`);
      throw new Error(
        `LLM 返回的 JSON 无法解析: ${parseErr instanceof Error ? parseErr.message : parseErr}\n` +
        `原始内容: ${raw.slice(0, 200)}`
      );
    }
  }

  // ── api 模式实现 ──

  private async chatViaApi(params: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const { system, user, maxTokens = 1024, temperature = 0 } = params;

    const response = await this.apiClient!.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    });

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  private async chatJsonViaApi<T>(params: {
    system: string;
    user: string;
    schemaName: string;
    schemaDescription: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<T> {
    const { system, user, schemaName, schemaDescription, schema, maxTokens = 1024 } = params;

    const response = await this.apiClient!.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      tools: [
        {
          name: schemaName,
          description: schemaDescription,
          input_schema: { type: 'object' as const, ...schema },
        },
      ],
      tool_choice: { type: 'tool', name: schemaName },
      messages: [{ role: 'user', content: user }],
    });

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === schemaName) {
        return block.input as T;
      }
    }

    throw new Error(`LLM did not return structured output for ${schemaName}`);
  }

  // ── 工具方法 ──

  /**
   * 构建 claude -p 的完整 prompt（把 system + user 合并）
   */
  private buildCliPrompt(system: string, user: string): string {
    return `<system>\n${system}\n</system>\n\n${user}`;
  }

  /**
   * 从可能包含多余文本的响应中提取 JSON
   * 策略：找到最后一个 ```json...``` 块，或最后的 {...} 配对
   */
  private extractJson(text: string): string {
    // 1. 找最后一个 ```json ... ``` 块
    const allCodeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
    if (allCodeBlocks.length > 0) {
      const lastBlock = allCodeBlocks[allCodeBlocks.length - 1];
      const content = lastBlock[1].trim();
      if (content.startsWith('{')) return content;
    }

    // 2. 找最后一个 { ... } 配对
    const braceMatch = this.matchBalancedBraces(text);
    if (braceMatch) return braceMatch;

    // 3. 如果有 { 但被截断（没有配对的 }），尝试补全
    const startIdx = text.indexOf('{');
    if (startIdx !== -1) {
      const partial = text.slice(startIdx).trim();
      // 尝试补全：数未闭合的括号
      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escape = false;
      for (const ch of partial) {
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
        if (ch === '[') openBrackets++;
        if (ch === ']') openBrackets--;
      }
      let fixed = partial;
      // 如果在字符串内被截断，先关闭字符串
      if (inString) fixed += '"';
      // 补全括号
      for (let i = 0; i < openBrackets; i++) fixed += ']';
      for (let i = 0; i < openBraces; i++) fixed += '}';
      return fixed;
    }

    return text;
  }

  /**
   * 匹配平衡的 { } 括号对，从最后一个 { 开始找配对
   */
  private matchBalancedBraces(text: string): string | null {
    // 从后往前找 { ，这样能跳过前面可能出现的非 JSON 文本
    let startIdx = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === '{') { startIdx = i; break; }
    }
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
    return null; // 没有配对的 }
  }
}
