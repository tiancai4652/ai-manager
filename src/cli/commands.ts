import * as readline from 'node:readline';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { StatePersistence, type RunState } from '../utils/state-persistence.js';
import { Orchestrator, type OrchestratorOptions } from '../core/orchestrator.js';
import { RequirementDiscusser } from '../core/requirement-discusser.js';
import { PlanParser } from '../core/plan-parser.js';
import { LlmClient } from '../brain/llm-client.js';
import { ProjectScanner } from '../core/project-scanner.js';
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
    llmStats?: { totalCalls: number; totalTokens: number };
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
      const llmSummary = info.llmStats
        ? ` | 🧠 ${info.llmStats.totalCalls} calls ~${this.formatTokens(info.llmStats.totalTokens)}`
        : '';
      console.log(`\n${emoji} ${info.phase === 'completed' ? chalk.green('完成') : chalk.red('失败')} — ${info.taskProgress} — ${elapsed}${llmSummary}`);
      return;
    }

    const taskInfo = info.currentTask
      ? `${info.currentTask.title} (${info.currentTask.attempts}/${info.currentTask.maxAttempts})`
      : '';

    if (!this.spinner) {
      this.spinner = ora({ spinner: 'dots' }).start();
    }

    // 显示大脑交互信息（含 LLM 统计）
    if (info.brainActivity) {
      this.spinner.stop();
      const llmTag = info.llmStats
        ? chalk.gray(` [${info.llmStats.totalCalls}] ~${this.formatTokens(info.llmStats.totalTokens)}`)
        : '';
      console.log(chalk.cyan(`  💬 ${info.brainActivity}${llmTag}`));
      this.spinner = ora({ spinner: 'dots' }).start();
    }

    // spinner 文本含 LLM 统计
    const llmInfo = info.llmStats
      ? ` | 🧠 ${info.llmStats.totalCalls} ~${this.formatTokens(info.llmStats.totalTokens)}`
      : '';
    this.spinner.text = `${emoji} ${taskInfo || info.phase} — ${info.taskProgress} — ${elapsed}${llmInfo}`;

    if (info.terminalPreview && info.phase === 'executing') {
      const lines = info.terminalPreview.split('\n').filter(l => l.trim()).slice(-3);
      if (lines.length > 0) {
        this.spinner.stop();
        for (const line of lines) {
          console.log(chalk.gray(`  │ ${line.slice(0, 100)}`));
        }
        this.spinner = ora({ spinner: 'dots' }).start();
        this.spinner.text = `${emoji} ${taskInfo || info.phase} — ${info.taskProgress} — ${elapsed}${llmInfo}`;
      }
    }
  }

  private formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  /** 格式化 token 数量（如 1.2K, 15K） */
  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K tokens`;
    }
    return `${tokens} tokens`;
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
    .version('0.2.0');

  // 主命令: run
  program
    .command('run')
    .description('启动一个任务，先讨论需求，确认后自动执行')
    .argument('[requirement]', '任务需求描述（可选，不提供则交互式输入）')
    .option('-d, --dir <path>', '工作目录（默认: ./ai-manager-workspace/<timestamp>）')
    .option('-a, --agent <type>', '编码 AI 类型: claude-code | codex', 'claude-code')
    .option('-m, --model <model>', '大脑 LLM 模型 (如 claude-sonnet-4-20250514, claude-opus-4-8)')
    .option('-r, --req-doc <path>', '需求文档路径（支持 .md / .txt）')
    .option('-y, --yes', '跳过讨论和确认，直接执行', false)
    .option('--debug', '调试模式', false)
    .action(async (requirement: string | undefined, opts: {
      dir?: string;
      agent: 'claude-code' | 'codex';
      model?: string;
      reqDoc?: string;
      yes: boolean;
      debug: boolean;
    }) => {
      if (opts.debug) {
        setLogLevel(LogLevel.DEBUG);
      }

      const config = loadConfig();

      // 确定工作目录和模式
      const { path: workingDir, mode } = resolveWorkingDir(opts.dir);

      // 扫描项目上下文
      const projectContext = ProjectScanner.scan(workingDir, mode);

      // 确定模型
      const brainModel = opts.model ?? config.brainModel;
      const llm = new LlmClient(brainModel);

      // ─── 确定需求 ─────────────────────────────────────
      // 优先级：命令行参数 > 需求文档文件 > 交互式输入
      let finalRequirement = requirement;

      if (!finalRequirement && opts.reqDoc) {
        // 从文件读取需求
        const docPath = resolve(opts.reqDoc);
        if (!existsSync(docPath)) {
          console.error(chalk.red(`❌ 需求文档不存在: ${docPath}`));
          process.exit(1);
        }
        try {
          finalRequirement = readFileSync(docPath, 'utf-8').trim();
          console.log(chalk.green(`📄 已加载需求文档: ${docPath} (${finalRequirement.length} 字)`));
        } catch (err) {
          console.error(chalk.red(`❌ 读取需求文档失败: ${err}`));
          process.exit(1);
        }
      }

      if (!finalRequirement) {
        // 交互式输入需求
        finalRequirement = await promptMultilineInput(workingDir, mode, projectContext) ?? undefined;
        if (!finalRequirement) {
          console.log(chalk.yellow('未提供需求，退出。'));
          process.exit(0);
        }
      }

      const modeLabel = mode === 'modify'
        ? chalk.yellow('🔧 修改模式：在已有项目上工作')
        : chalk.green('🆕 新建模式：将创建新项目');

      console.log(chalk.cyan(`
🎯 AI Manager v0.1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 需求: ${finalRequirement.slice(0, 60)}${finalRequirement.length > 60 ? '...' : ''}
📂 目录: ${workingDir}
${modeLabel}
🤖 Agent: ${opts.agent}
🧠 Brain: ${brainModel} (${config.brainMode})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));

      let refinedRequirement = finalRequirement;
      let preParsedTasks: OrchestratorOptions['preParsedTasks'] = undefined;
      let requirementDocPath: string | undefined;

      if (!opts.yes) {
        // ====== Phase 1: 需求讨论 ======
        const discusser = new RequirementDiscusser(llm);
        const discussionResult = await discusser.discuss(finalRequirement, workingDir, projectContext);
        refinedRequirement = discussionResult.refinedRequirement;
        requirementDocPath = discussionResult.documentPath;

        // ====== Phase 2: 解析并展示计划 ======
        console.log(chalk.cyan('\n🧠 解析任务计划...\n'));
        const planParser = new PlanParser(llm);
        const parsed = await planParser.parse(refinedRequirement, workingDir, projectContext);

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
        projectContext,
        onProgress: (info) => display.update(info),
        onComplete: (plan) => {
          display.stop();
          const stats = orchestrator.getRunStats();
          const llmLine = stats
            ? `🧠  LLM: ${stats.totalCalls} calls, ~${(stats.totalTokens / 1000).toFixed(1)}K tokens\n`
            : '';
          console.log(chalk.green(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 所有任务已完成!
📋 需求: ${plan.userRequirement.slice(0, 50)}
📊 任务: ${plan.tasks.length} 个
⏱️  总用时: ${Math.round((Date.now() - plan.startedAt.getTime()) / 1000)}s
${llmLine}📂 目录: ${plan.workingDir}
📄 报告: ${plan.workingDir}/.aimanager/run-report.{json,md}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));
        },
        onIntervention: async (reason) => {
          display.stop();
          const response = await promptUserIntervention(reason);
          // display 没有 start()，下次 update() 时 spinner 会自动重建
          return response;
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

  // ─── resume 子命令 — 断点续跑 ──────────────────────
  program
    .command('resume')
    .description('从上次中断处恢复执行')
    .argument('[dir]', '项目目录（默认扫描 ai-manager-workspace）')
    .action(async (dir?: string) => {
      // 扫描可恢复的状态
      const candidates = findResumableStates(dir);

      if (candidates.length === 0) {
        console.log(chalk.yellow('没有可恢复的运行。'));
        console.log(chalk.gray('  提示: 在之前运行的项目目录下执行 aimanager resume ./my-project'));
        return;
      }

      // 如果多个，让用户选
      let chosen = candidates[0];
      if (candidates.length > 1) {
        console.log(chalk.cyan('\n找到多个可恢复的运行:\n'));
        candidates.forEach((c, i) => {
          const state = c.state;
          const tasks = state.tasks;
          const completed = tasks.filter(t => t.status === 'completed').length;
          const time = state.savedAt ? new Date(state.savedAt).toLocaleString('zh-CN') : '未知';
          console.log(`  ${i + 1}. ${chalk.white(state.requirement.slice(0, 50))}`);
          console.log(`     ${chalk.gray(`${c.dir} — ${completed}/${tasks.length} 完成 — ${time}`)}`);
        });
        const choice = await promptChoice(`选择恢复 [1-${candidates.length}]`, candidates.length);
        if (choice === null) {
          console.log(chalk.yellow('已取消'));
          return;
        }
        chosen = candidates[choice - 1];
      }

      const state = chosen.state;
      const tasks = state.tasks;
      const completed = tasks.filter(t => t.status === 'completed').length;
      const remaining = tasks.filter(t => t.status !== 'completed').length;

      console.log(chalk.cyan(`
🔄 断点续跑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 需求: ${state.requirement.slice(0, 60)}
📂 目录: ${chosen.dir}
📊 进度: ${completed}/${tasks.length} 已完成, ${remaining} 待执行
🧠 Brain: ${state.brainModel}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));

      // 恢复执行
      const display = new ProgressDisplay();
      const orchestrator = new Orchestrator({
        requirement: state.requirement,
        workingDir: state.workingDir,
        agentType: state.agentType,
        brainModel: state.brainModel,
        resumeState: state,
        onProgress: (info) => display.update(info),
        onComplete: (plan) => {
          display.stop();
          const stats = orchestrator.getRunStats();
          const llmLine = stats ? `🧠  LLM: ${stats.totalCalls} calls, ~${(stats.totalTokens / 1000).toFixed(1)}K tokens\n` : '';
          console.log(chalk.green(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 所有任务已完成!
📋 需求: ${plan.userRequirement.slice(0, 50)}
📊 任务: ${plan.tasks.length} 个
⏱️  总用时: ${Math.round((Date.now() - plan.startedAt.getTime()) / 1000)}s
${llmLine}📂 目录: ${plan.workingDir}
📄 报告: ${plan.workingDir}/.aimanager/run-report.{json,md}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`));
        },
        onIntervention: async (reason) => {
          display.stop();
          const response = await promptUserIntervention(reason);
          return response;
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
        console.error(chalk.red(`\n❌ 恢复执行失败: ${err}`));
        process.exit(1);
      }
    });

  // ─── log 子命令 — 查看运行报告 ──────────────────────
  program
    .command('log')
    .description('查看运行报告（token 消耗、耗时、调用明细）')
    .argument('[dir]', '项目目录（默认扫描当前目录和 ai-manager-workspace）')
    .option('-v, --verbose', '显示每次 LLM 调用明细', false)
    .action((dir?: string, opts?: { verbose?: boolean }) => {
      const reports = findRunReports(dir);

      if (reports.length === 0) {
        console.log(chalk.yellow('未找到运行报告。'));
        console.log(chalk.gray('  提示: 在项目目录下运行，或指定目录 aimanager log ./my-project'));
        return;
      }

      for (const { path, report } of reports) {
        displayRunReport(path, report, opts?.verbose ?? false);
      }
    });

  // ─── reminder 子系统命令 ────────────────────────────
  registerReminderCommands(program);

  return program;
}

/**
 * 交互式多行需求输入
 *
 * 没提供 requirement 参数时触发：
 * - 显示项目/目录上下文提示
 * - 支持多行输入，空行两次结束
 * - 也支持粘贴需求文档路径
 */
function promptMultilineInput(workingDir: string, mode: 'new' | 'modify', projectContext: import('../models/project-context.js').ProjectContext): Promise<string | null> {
  return new Promise((_resolve) => {
    console.log(chalk.cyan('\n💬 请描述你的需求'));
    console.log(chalk.gray('─'.repeat(50)));

    if (mode === 'modify') {
      console.log(chalk.gray(`  📂 项目: ${workingDir}`));
      // 从 README 或 package.json 提取项目名
      const pkgMatch = projectContext.packageInfo.match(/"name":\s*"([^"]+)"/);
      if (pkgMatch) {
        console.log(chalk.gray(`  📦 项目名: ${pkgMatch[1]}`));
      }
    }

    console.log(chalk.gray('  输入需求描述，支持多行。连续两次回车结束输入。'));
    console.log(chalk.gray('  也可以直接输入需求文档路径（.md / .txt）'));
    console.log(chalk.gray('─'.repeat(50)));
    process.stdout.write(chalk.yellow('  > '));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const lines: string[] = [];
    let lastWasEmpty = false;
    let done = false;

    rl.on('line', (line: string) => {
      if (done) return;
      if (line.trim() === '') {
        if (lastWasEmpty || lines.length === 0) {
          // 连续空行或第一行就空 → 结束
          done = true;
          rl.close();
          const result = lines.join('\n').trim();
          _resolve(result || null);
          return;
        }
        lastWasEmpty = true;
        lines.push('');
      } else {
        lastWasEmpty = false;
        lines.push(line);
      }
      if (!done) {
        process.stdout.write(chalk.yellow('  > '));
      }
    });

    rl.on('close', () => {
      if (done) return; // 已在 line 事件中 _resolve
      const result = lines.join('\n').trim();

      // 检查是否是文件路径
      if (result) {
        const absPath = resolve(result);
        if (existsSync(absPath)) {
          const lower = result.toLowerCase();
          if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.markdown')) {
            try {
              const content = readFileSync(absPath, 'utf-8').trim();
              console.log(chalk.green(`  📄 已加载需求文档: ${result} (${content.length} 字)`));
              _resolve(content);
              return;
            } catch {
              // 读取失败，当作普通需求文本
            }
          }
        }
      }

      _resolve(result || null);
    });
  });
}

/**
 * 解析工作目录并检测模式
 * 如果目录已有文件 → modify 模式；否则 → new 模式
 */
function resolveWorkingDir(dir?: string): { path: string; mode: 'new' | 'modify' } {
  if (dir) {
    const abs = resolve(dir);
    if (existsSync(abs)) {
      const entries = readdirSync(abs).filter(e => !e.startsWith('.'));
      if (entries.length > 0) {
        console.log(chalk.cyan(`📂 检测到已有项目 (${entries.length} 项)`));
        return { path: abs, mode: 'modify' };
      }
    } else {
      mkdirSync(abs, { recursive: true });
    }
    return { path: abs, mode: 'new' };
  }

  // 默认: ./ai-manager-workspace/<YYYYMMDD-HHmmss>
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const defaultDir = resolve(`./ai-manager-workspace/${ts}`);
  mkdirSync(defaultDir, { recursive: true });
  console.log(chalk.gray(`📂 未指定工作目录，自动创建: ${defaultDir}`));
  return { path: defaultDir, mode: 'new' };
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
 * 人工介入提示：暂停等待用户输入，将回复转达给 AI
 */
function promptUserIntervention(reason: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.yellow(`\n\n⏸️  需要人工介入: ${reason}`));
    console.log(chalk.gray('  输入回复发给 AI（直接 Enter 表示已处理，无消息）'));
    rl.question('  > ', (answer: string) => {
      rl.close();
      resolve(answer.trim());
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

// ─── resume / log 命令辅助 ──────────────────────────────────

/**
 * 扫描可恢复的运行状态
 */
function findResumableStates(dir?: string): Array<{ dir: string; state: RunState }> {
  const results: Array<{ dir: string; state: RunState }> = [];

  const scanDir = (base: string) => {
    const sp = new StatePersistence(base);
    if (sp.canResume()) {
      const state = sp.load();
      if (state) {
        results.push({ dir: base, state });
      }
    }
    // 扫描子目录
    try {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subSp = new StatePersistence(join(base, entry.name));
          if (subSp.canResume()) {
            const state = subSp.load();
            if (state) {
              results.push({ dir: join(base, entry.name), state });
            }
          }
        }
      }
    } catch { /* 忽略 */ }
  };

  if (dir) {
    scanDir(resolve(dir));
  } else {
    scanDir('.');
    const wsDir = resolve('ai-manager-workspace');
    if (existsSync(wsDir)) {
      scanDir(wsDir);
    }
  }

  // 最新的排在前面
  results.sort((a, b) => (b.state.savedAt ?? '').localeCompare(a.state.savedAt ?? ''));
  return results;
}

interface RunReportLike {
  requirement?: string;
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
  summary?: {
    totalCalls: number;
    totalEstimatedTokens: number;
    totalInputChars: number;
    totalOutputChars: number;
    avgCallDurationMs: number;
    byPurpose: Record<string, { calls: number; tokens: number; avgMs: number }>;
  };
  llmCalls?: Array<{
    timestamp: string;
    purpose: string;
    type: string;
    durationMs: number;
    inputChars: number;
    outputChars: number;
    estimatedTokens: number;
    success: boolean;
  }>;
}

/**
 * 扫描目录查找运行报告
 */
function findRunReports(dir?: string): Array<{ path: string; report: RunReportLike }> {
  const results: Array<{ path: string; report: RunReportLike }> = [];

  const scanDir = (base: string) => {
    // 直接找 .aimanager/run-report.json
    const reportPath = join(base, '.aimanager', 'run-report.json');
    if (existsSync(reportPath)) {
      try {
        const raw = JSON.parse(readFileSync(reportPath, 'utf-8'));
        results.push({ path: base, report: raw });
      } catch { /* 忽略损坏的报告 */ }
    }

    // 扫描子目录中的 workspace
    try {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subReport = join(base, entry.name, '.aimanager', 'run-report.json');
          if (existsSync(subReport)) {
            try {
              const raw = JSON.parse(readFileSync(subReport, 'utf-8'));
              results.push({ path: join(base, entry.name), report: raw });
            } catch { /* 忽略 */ }
          }
        }
      }
    } catch { /* 忽略无权限目录 */ }
  };

  if (dir) {
    scanDir(resolve(dir));
  } else {
    // 默认扫描当前目录和 ai-manager-workspace
    scanDir('.');
    const wsDir = resolve('ai-manager-workspace');
    if (existsSync(wsDir)) {
      scanDir(wsDir);
    }
  }

  // 按时间倒序（最新的在前）
  results.sort((a, b) => {
    const ta = a.report.startedAt ?? '';
    const tb = b.report.startedAt ?? '';
    return tb.localeCompare(ta);
  });

  return results;
}

/**
 * 格式化 token 数量
 */
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/**
 * 展示运行报告
 */
function displayRunReport(dirPath: string, report: RunReportLike, verbose: boolean): void {
  const s = report.summary;
  if (!s) {
    console.log(chalk.yellow(`⚠️ ${dirPath} — 报告无 summary 数据`));
    return;
  }

  const dur = report.totalDurationMs ? Math.round(report.totalDurationMs / 1000) : 0;
  const timeStr = report.startedAt
    ? new Date(report.startedAt).toLocaleString('zh-CN')
    : '未知';

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan(`📊 运行报告`));
  console.log(chalk.gray(`  📂 ${dirPath}`));
  console.log(chalk.gray(`  🕐 ${timeStr}`));
  if (report.requirement) {
    console.log(chalk.gray(`  📋 ${report.requirement.slice(0, 60)}${report.requirement.length > 60 ? '...' : ''}`));
  }
  console.log('');
  console.log(`  ⏱️  总用时:     ${chalk.white(Math.floor(dur / 60))}m ${dur % 60}s`);
  console.log(`  🧠 LLM 调用:   ${chalk.white(s.totalCalls)} 次`);
  console.log(`  📊 估算 Token:  ${chalk.white(fmtTokens(s.totalEstimatedTokens))}`);
  console.log(`  ⚡ 平均耗时:    ${chalk.white(s.avgCallDurationMs)}ms/call`);
  console.log(`  📥 输入字符:    ${chalk.white(s.totalInputChars.toLocaleString())}`);
  console.log(`  📤 输出字符:    ${chalk.white(s.totalOutputChars.toLocaleString())}`);

  // 按用途分类
  if (Object.keys(s.byPurpose).length > 0) {
    console.log('');
    console.log(chalk.cyan('  按用途分类:'));
    const maxPurposeLen = Math.max(...Object.keys(s.byPurpose).map(k => k.length));
    for (const [purpose, stats] of Object.entries(s.byPurpose)) {
      const pct = s.totalEstimatedTokens > 0
        ? Math.round(stats.tokens / s.totalEstimatedTokens * 100)
        : 0;
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      console.log(
        `    ${chalk.white(purpose.padEnd(maxPurposeLen))}  `
        + `${chalk.gray(stats.calls + ' calls')}  `
        + `${chalk.green(fmtTokens(stats.tokens))} `
        + `${chalk.gray(`(${pct}%)`)} `
        + `${chalk.gray(stats.avgMs + 'ms')}`,
      );
    }
  }

  // 明细模式
  if (verbose && report.llmCalls && report.llmCalls.length > 0) {
    console.log('');
    console.log(chalk.cyan('  调用明细:'));
    report.llmCalls.forEach((call, i) => {
      const time = call.timestamp.slice(11, 19);
      const ok = call.success ? chalk.green('✓') : chalk.red('✗');
      console.log(
        `    ${chalk.gray(`#${String(i + 1).padStart(2)} ${time}`)} `
        + `${ok} ${chalk.white(call.purpose.padEnd(8))} `
        + `${chalk.gray(call.type.padEnd(8))} `
        + `${call.durationMs}ms `
        + `${chalk.cyan(fmtTokens(call.estimatedTokens) + ' tokens')}`,
      );
    });
  }

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');
}
