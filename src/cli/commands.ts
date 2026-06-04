import * as readline from 'node:readline';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Orchestrator, type OrchestratorOptions } from '../core/orchestrator.js';
import { RequirementDiscusser } from '../core/requirement-discusser.js';
import { PlanParser } from '../core/plan-parser.js';
import { LlmClient } from '../brain/llm-client.js';
import { loadConfig, saveConfig, fetchAvailableModels, type ModelInfo } from '../utils/config.js';
import { logger, setLogLevel, LogLevel } from '../utils/logger.js';
import { registerReminderCommands } from '../reminder/cli/commands.js';
import chalk from 'chalk';
import ora from 'ora';

/**
 * CLI 进度显示器
 */
class ProgressDisplay {
  private spinner: ReturnType<typeof ora> | null = null;
  private lastPhase = '';

  update(info: {
    phase: string;
    currentTask?: { title: string; attempts: number; maxAttempts: number };
    taskProgress: string;
    terminalPreview: string;
    elapsedMs: number;
    brainActivity?: string;
  }): void {
    const phaseEmoji: Record<string, string> = {
      planning: '🧠',
      executing: '🔄',
      reviewing: '🔍',
      completed: '✅',
      failed: '❌',
    };

    const emoji = phaseEmoji[info.phase] ?? '⏳';
    const elapsed = this.formatTime(info.elapsedMs);

    if (info.phase !== this.lastPhase) {
      this.spinner?.stop();
      this.lastPhase = info.phase;
    }

    if (info.phase === 'completed' || info.phase === 'failed') {
      this.spinner?.stop();
      console.log(`\n${emoji} ${info.phase === 'completed' ? chalk.green('完成') : chalk.red('失败')} — ${info.taskProgress} — ${elapsed}`);
      return;
    }

    const taskInfo = info.currentTask
      ? `${info.currentTask.title} (${info.currentTask.attempts}/${info.currentTask.maxAttempts})`
      : '';

    if (!this.spinner) {
      this.spinner = ora({ spinner: 'dots' }).start();
    }

    // 显示大脑交互信息
    if (info.brainActivity) {
      this.spinner.stop();
      console.log(chalk.cyan(`  💬 ${info.brainActivity}`));
      this.spinner = ora({ spinner: 'dots' }).start();
    }

    this.spinner.text = `${emoji} ${taskInfo || info.phase} — ${info.taskProgress} — ${elapsed}`;

    if (info.terminalPreview && info.phase === 'executing') {
      const lines = info.terminalPreview.split('\n').filter(l => l.trim()).slice(-3);
      if (lines.length > 0) {
        this.spinner.stop();
        for (const line of lines) {
          console.log(chalk.gray(`  │ ${line.slice(0, 100)}`));
        }
        this.spinner = ora({ spinner: 'dots' }).start();
        this.spinner.text = `${emoji} ${taskInfo || info.phase} — ${info.taskProgress} — ${elapsed}`;
      }
    }
  }

  private formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  stop(): void {
    this.spinner?.stop();
  }
}

/**
 * 注册 CLI 命令
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('aimanager')
    .description('AI coding agent orchestrator — 自主管理编码 AI 完成复杂任务')
    .version('0.1.0');

  // 主命令: run
  program
    .command('run')
    .description('启动一个任务，先讨论需求，确认后自动执行')
    .argument('<requirement>', '任务需求描述（可以是粗略的，会引导你细化）')
    .option('-d, --dir <path>', '工作目录（默认: ./ai-manager-workspace/<timestamp>）')
    .option('-a, --agent <type>', '编码 AI 类型: claude-code | codex', 'claude-code')
    .option('-m, --model <model>', '大脑 LLM 模型 (如 claude-sonnet-4-20250514, claude-opus-4-8)')
    .option('-y, --yes', '跳过讨论和确认，直接执行', false)
    .option('--debug', '调试模式', false)
    .action(async (requirement: string, opts: {
      dir?: string;
      agent: 'claude-code' | 'codex';
      model?: string;
      yes: boolean;
      debug: boolean;
    }) => {
      if (opts.debug) {
        setLogLevel(LogLevel.DEBUG);
      }

      const config = loadConfig();

      // 确定工作目录
      const workingDir = resolveWorkingDir(opts.dir);

      // 确定模型
      const brainModel = opts.model ?? config.brainModel;
      const llm = new LlmClient(brainModel);

      console.log(chalk.cyan(`
🎯 AI Manager v0.1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 需求: ${requirement.slice(0, 60)}${requirement.length > 60 ? '...' : ''}
📂 目录: ${workingDir}
🤖 Agent: ${opts.agent}
🧠 Brain: ${brainModel} (${config.brainMode})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));

      let refinedRequirement = requirement;
      let preParsedTasks: OrchestratorOptions['preParsedTasks'] = undefined;
      let requirementDocPath: string | undefined;

      if (!opts.yes) {
        // ====== Phase 1: 需求讨论 ======
        const discusser = new RequirementDiscusser(llm);
        const discussionResult = await discusser.discuss(requirement, workingDir);
        refinedRequirement = discussionResult.refinedRequirement;
        requirementDocPath = discussionResult.documentPath;

        // ====== Phase 2: 解析并展示计划 ======
        console.log(chalk.cyan('\n🧠 解析任务计划...\n'));
        const planParser = new PlanParser(llm);
        const parsed = await planParser.parse(refinedRequirement, workingDir);

        console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.cyan('📋 执行计划:'));
        parsed.tasks.forEach((t, i) => {
          console.log(chalk.white(`  ${i + 1}. ${t.title}`));
          console.log(chalk.gray(`     ${t.description}`));
        });
        console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

        // ====== Phase 3: 确认执行 ======
        const confirmed = await promptConfirm('确认开始执行?');
        if (!confirmed) {
          console.log(chalk.yellow('已取消。需求文档已保存在 ' + requirementDocPath));
          process.exit(0);
        }

        preParsedTasks = parsed.tasks;

      } else {
        // -y 模式：跳过讨论，直接执行
        console.log(chalk.gray('(跳过讨论，直接执行)'));
      }

      // ====== Phase 4: 执行 ======
      const display = new ProgressDisplay();

      const orchestrator = new Orchestrator({
        requirement: refinedRequirement,
        workingDir,
        agentType: opts.agent,
        brainModel,
        preParsedTasks,
        requirementDocPath,
        onProgress: (info) => display.update(info),
        onComplete: (plan) => {
          display.stop();
          console.log(chalk.green(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 所有任务已完成!
📋 需求: ${plan.userRequirement.slice(0, 50)}
📊 任务: ${plan.tasks.length} 个
⏱️  总用时: ${Math.round((Date.now() - plan.startedAt.getTime()) / 1000)}s
📂 目录: ${plan.workingDir}
📄 文档: ${plan.workingDir}/.aimanager/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));
        },
        onIntervention: (reason) => {
          display.stop();
          console.log(chalk.yellow(`\n⚠️  需要人工介入: ${reason}`));
        },
      });

      const cleanup = () => {
        console.log(chalk.yellow('\n\n⏸️  正在中止...'));
        orchestrator.abort();
        display.stop();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      try {
        await orchestrator.run();
      } catch (err) {
        display.stop();
        console.error(chalk.red(`\n❌ 执行失败: ${err}`));
        process.exit(1);
      }
    });

  // 配置命令
  program
    .command('config')
    .description('查看或修改配置')
    .argument('<action>', 'get | set | list')
    .argument('[key]', '配置项名称')
    .argument('[value]', '配置项值')
    .action((action: string, key?: string, value?: string) => {
      switch (action) {
        case 'list': {
          const config = loadConfig();
          console.log(chalk.cyan('当前配置:'));
          Object.entries(config).forEach(([k, v]) => {
            if (k === 'apiKey' && v) {
              console.log(`  ${k}: ${String(v).slice(0, 8)}...`);
            } else {
              console.log(`  ${k}: ${v}`);
            }
          });
          break;
        }
        case 'get': {
          if (!key) {
            console.error(chalk.red('请指定配置项名称'));
            process.exit(1);
          }
          const config = loadConfig();
          console.log(`${key}: ${(config as Record<string, unknown>)[key] ?? '(未设置)'}`);
          break;
        }
        case 'set': {
          if (!key || value === undefined) {
            console.error(chalk.red('用法: aimanager config set <key> <value>'));
            process.exit(1);
          }
          const updates: Record<string, unknown> = { [key]: value };
          saveConfig(updates);
          console.log(chalk.green(`✅ 已设置 ${key} = ${value}`));
          break;
        }
        default:
          console.error(chalk.red(`未知操作: ${action}。可用: get, set, list`));
      }
    });

  // ─── model 子命令 ─────────────────────────────────────
  const modelCmd = program
    .command('model')
    .description('查看和选择大脑 LLM 模型');

  // aimanager model (无子命令 → 交互式选择)
  modelCmd
    .command('pick', { isDefault: true })
    .description('交互式选择模型（默认动作）')
    .action(async () => {
      const config = loadConfig();
      const models = await fetchAvailableModels();

      console.log(chalk.cyan('\n可用模型:\n'));

      // 找到最长 id 用于对齐
      const maxIdLen = Math.max(...models.map(m => m.id.length));
      models.forEach((m, i) => {
        const isCurrent = m.id === config.brainModel;
        const marker = isCurrent ? chalk.green('  ← 当前') : '';
        const num = isCurrent ? chalk.green(`> ${i + 1}.`) : `  ${i + 1}.`;
        console.log(`${num} ${chalk.white(m.id.padEnd(maxIdLen))}  ${chalk.gray(`(${m.display_name})`)}${marker}`);
      });

      console.log();
      const choice = await promptChoice(`请选择 [1-${models.length}]`, models.length);
      if (choice === null) {
        console.log(chalk.yellow('已取消'));
        return;
      }
      const selected = models[choice - 1];
      saveConfig({ brainModel: selected.id });
      console.log(chalk.green(`✅ 已设置模型: ${selected.id} (${selected.display_name})`));
    });

  // aimanager model list
  modelCmd
    .command('list')
    .description('列出所有可用模型')
    .action(async () => {
      const config = loadConfig();
      const models = await fetchAvailableModels();

      const maxIdLen = Math.max(...models.map(m => m.id.length));
      models.forEach(m => {
        const isCurrent = m.id === config.brainModel;
        const marker = isCurrent ? chalk.green('  ← 当前') : '';
        console.log(`  ${chalk.white(m.id.padEnd(maxIdLen))}  ${chalk.gray(`(${m.display_name})`)}${marker}`);
      });
    });

  // aimanager model set <id>
  modelCmd
    .command('set')
    .description('直接设置模型 ID')
    .argument('<id>', '模型 ID')
    .action(async (id: string) => {
      const models = await fetchAvailableModels();
      const found = models.find(m => m.id === id);
      if (!found) {
        console.error(chalk.red(`❌ 未知模型: ${id}`));
        console.log(chalk.gray('可用模型: ' + models.map(m => m.id).join(', ')));
        process.exit(1);
      }
      saveConfig({ brainModel: found.id });
      console.log(chalk.green(`✅ 已设置模型: ${found.id} (${found.display_name})`));
    });

  // ─── reminder 子系统命令 ────────────────────────────
  registerReminderCommands(program);

  return program;
}

/**
 * 解析工作目录
 * 如果没指定，创建一个带时间戳的默认目录
 */
function resolveWorkingDir(dir?: string): string {
  if (dir) {
    const abs = resolve(dir);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
    }
    return abs;
  }

  // 默认: ./ai-manager-workspace/<YYYYMMDD-HHmmss>
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const defaultDir = resolve(`./ai-manager-workspace/${ts}`);
  mkdirSync(defaultDir, { recursive: true });
  console.log(chalk.gray(`📂 未指定工作目录，自动创建: ${defaultDir}`));
  return defaultDir;
}

/**
 * 通用确认提示
 */
function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.yellow(`\n  ${message} [Y/n]`));
    rl.question('  > ', (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes' || trimmed === '是');
    });
  });
}

/**
 * 编号选择提示（1..max），输入空则返回 null
 */
function promptChoice(message: string, max: number): Promise<number | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.yellow(`  ${message}: `), (answer: string) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === '' || trimmed === 'q') {
        resolve(null);
        return;
      }
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > max) {
        console.log(chalk.red(`  无效选择: ${trimmed}`));
        resolve(null);
        return;
      }
      resolve(num);
    });
  });
}
