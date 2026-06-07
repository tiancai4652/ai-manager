import { execSync, spawnSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { LLMCallRecord } from '../models/llm-call-record.js';

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

  /** 调用记录回调（由 RunLogger 注入） */
  private recorder?: (record: LLMCallRecord) => void;
  /** 当前调用用途（由 Orchestrator 在每次逻辑操作前设置） */
  private currentPurpose = '';

  constructor(modelOverride?: string) {
    const config = loadConfig();
    this.model = modelOverride ?? config.brainModel;
    this.mode = this.resolveMode(config.brainMode, config.apiKey);
    logger.info(`大脑调用方式: ${this.mode}, 模型: ${this.model}`);
  }

  /** 注入调用记录器 */
  setRecorder(recorder: (record: LLMCallRecord) => void): void {
    this.recorder = recorder;
  }

  /** 设置下一次调用的用途（在发起 LLM 调用前设置） */
  setPurpose(purpose: string): void {
    this.currentPurpose = purpose;
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
    const purpose = this.currentPurpose || 'chat';
    const inputChars = system.length + user.length;
    const start = Date.now();

    logger.debug(`LLM request (${this.mode}): ${user.slice(0, 100)}...`);

    try {
      let result: string;
      if (this.mode === 'claude-cli') {
        result = this.chatViaCli(system, user);
      } else {
        result = await this.chatViaApi(params);
      }

      this.recordCall({
        timestamp: new Date().toISOString(),
        type: 'chat',
        purpose,
        model: this.model,
        mode: this.mode,
        durationMs: Date.now() - start,
        inputChars,
        outputChars: result.length,
        estimatedTokens: LlmClient.estimateTokens(inputChars, result.length),
        success: true,
      });

      return result;
    } catch (err) {
      this.recordCall({
        timestamp: new Date().toISOString(),
        type: 'chat',
        purpose,
        model: this.model,
        mode: this.mode,
        durationMs: Date.now() - start,
        inputChars,
        outputChars: 0,
        estimatedTokens: LlmClient.estimateTokens(inputChars, 0),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
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
    const purpose = this.currentPurpose || schemaName;
    const inputChars = system.length + user.length;
    const start = Date.now();

    logger.debug(`LLM JSON request (${this.mode}, ${schemaName}): ${user.slice(0, 100)}...`);

    try {
      let result: T;
      if (this.mode === 'claude-cli') {
        result = this.chatJsonViaCli<T>(system, user, schemaName, schema);
      } else {
        result = await this.chatJsonViaApi<T>(params);
      }

      const outputStr = JSON.stringify(result);
      this.recordCall({
        timestamp: new Date().toISOString(),
        type: 'chatJson',
        purpose,
        model: this.model,
        mode: this.mode,
        durationMs: Date.now() - start,
        inputChars,
        outputChars: outputStr.length,
        estimatedTokens: LlmClient.estimateTokens(inputChars, outputStr.length),
        success: true,
      });

      return result;
    } catch (err) {
      this.recordCall({
        timestamp: new Date().toISOString(),
        type: 'chatJson',
        purpose,
        model: this.model,
        mode: this.mode,
        durationMs: Date.now() - start,
        inputChars,
        outputChars: 0,
        estimatedTokens: LlmClient.estimateTokens(inputChars, 0),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
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

  /** 缓存已渲染的 schema JSON 指令，避免重复序列化 */
  private schemaInstructionCache = new Map<string, string>();

  private chatJsonViaCli<T>(
    system: string,
    user: string,
    schemaName: string,
    schema: Record<string, unknown>,
  ): T {
    // 让 claude -p 返回 JSON：按 schemaName 缓存，压缩 schema（去掉 description）
    let jsonInstruction = this.schemaInstructionCache.get(schemaName);
    if (!jsonInstruction) {
      const compactSchema = LlmClient.stripDescriptions({ type: 'object', ...schema });
      jsonInstruction = [
        system,
        '',
        `JSON only. Schema: ${JSON.stringify(compactSchema)}`,
      ].join('\n');
      this.schemaInstructionCache.set(schemaName, jsonInstruction);
    }

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

  /**
   * 递归移除 schema 中的 description 字段，减少 token 消耗
   */
  private static stripDescriptions(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(LlmClient.stripDescriptions);
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key !== 'description') {
          result[key] = LlmClient.stripDescriptions(value);
        }
      }
      return result;
    }
    return obj;
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
   * 策略：找到最后一个 ```json...``` 块，或第一个完整的 {...} 配对
   */
  private extractJson(text: string): string {
    // 1. 找最后一个 ```json ... ``` 块
    const allCodeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
    if (allCodeBlocks.length > 0) {
      const lastBlock = allCodeBlocks[allCodeBlocks.length - 1];
      const content = lastBlock[1].trim();
      if (content.startsWith('{')) return content;
    }

    // 2. 找第一个完整的 { ... } 配对（从第一个 { 开始，匹配最外层对象）
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
   * 匹配平衡的 { } 括号对，从第一个 { 开始找配对
   */
  private matchBalancedBraces(text: string): string | null {
    // 从前往后找第一个 { ，匹配最外层对象
    const startIdx = text.indexOf('{');
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

  // ─── 调用记录辅助 ────────────────────────────────────

  /** 发送调用记录到 recorder */
  private recordCall(record: LLMCallRecord): void {
    this.recorder?.(record);
  }

  /**
   * 估算 token 数（混合内容：英文/代码 ~4 字符/token，中文 ~2 字符/token）
   * 取 3.5 作为折中值
   */
  private static estimateTokens(inputChars: number, outputChars: number): number {
    return Math.ceil(inputChars / 3.5) + Math.ceil(outputChars / 3.5);
  }
}
