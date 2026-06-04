import { z } from 'zod/v4';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ConfigSchema = z.object({
  /** 默认编码 AI 类型 */
  agentType: z.enum(['claude-code', 'codex']).default('claude-code'),
  /** Anthropic API Key (也可通过 ANTHROPIC_API_KEY 环境变量) */
  apiKey: z.string().optional(),
  /** 任务最大重试次数 */
  maxRetries: z.number().default(3),
  /** 输出分析间隔 (ms) */
  analysisInterval: z.number().default(3000),
  /** 单个任务超时 (ms) */
  taskTimeout: z.number().default(300_000),
  /** LLM 模型 */
  brainModel: z.string().default('claude-sonnet-4-20250514'),
  /** "大脑"调用方式：auto 优先 claude -p（复用终端登录），api 直接调 Anthropic API */
  brainMode: z.enum(['auto', 'claude-cli', 'api']).default('auto'),
  /** 终端列数 */
  terminalCols: z.number().default(120),
  /** 终端行数 */
  terminalRows: z.number().default(40),
  /** 日志级别 */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_DIR = join(homedir(), '.aimanager');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  agentType: 'claude-code',
  maxRetries: 3,
  analysisInterval: 3000,
  taskTimeout: 300_000,
  brainModel: 'claude-sonnet-4-20250514',
  brainMode: 'auto',
  terminalCols: 120,
  terminalRows: 40,
  logLevel: 'info',
};

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  // 优先从环境变量读 API key
  const envApiKey = process.env.ANTHROPIC_API_KEY;

  if (existsSync(CONFIG_FILE)) {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    cachedConfig = { ...ConfigSchema.parse(raw), apiKey: envApiKey ?? raw.apiKey };
  } else {
    cachedConfig = { ...DEFAULT_CONFIG, apiKey: envApiKey };
  }

  return cachedConfig;
}

export function saveConfig(partial: Partial<Config>) {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  const validated = ConfigSchema.parse(updated);

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2));
  cachedConfig = validated;
}

/**
 * 解析 CLI 传入的 --config key=value 覆盖
 */
export function applyCliOverrides(config: Config, overrides: string[]): Config {
  const result = { ...config };
  for (const o of overrides) {
    const [key, ...rest] = o.split('=');
    const value = rest.join('=');
    if (key in result) {
      (result as Record<string, unknown>)[key] =
        typeof result[key as keyof Config] === 'number' ? Number(value) : value;
    }
  }
  return ConfigSchema.parse(result);
}
