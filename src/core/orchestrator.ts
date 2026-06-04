import { PtySession } from '../terminal/pty-session.js';
import { OutputAnalyzer } from '../brain/output-analyzer.js';
import { InstructionGenerator } from '../brain/instruction-generator.js';
import { QualityReviewer } from '../brain/quality-reviewer.js';
import { PlanParser } from './plan-parser.js';
import { TaskManager } from './task-manager.js';
import { LlmClient } from '../brain/llm-client.js';
import type { Plan } from '../models/plan.js';
import type { OutputAnalysis } from '../models/session-state.js';
import type { Task } from '../models/task.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { ExecutionLog } from '../utils/execution-log.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * 编排器选项
 */
export interface OrchestratorOptions {
  /** 用户需求（经过讨论完善后的） */
  requirement: string;
  /** 工作目录 */
  workingDir: string;
  /** 编码 AI 类型 */
  agentType: 'claude-code' | 'codex';
  /** 大脑 LLM 模型（覆盖配置） */
  brainModel?: string;
  /** 预解析的任务列表 */
  preParsedTasks?: Array<{
    id: string;
    title: string;
    description: string;
    maxAttempts: number;
  }>;
  /** 需求文档路径 */
  requirementDocPath?: string;
  /** 完成时的回调 */
  onComplete?: (plan: Plan) => void;
  /** 需要人工介入时的回调 */
  onIntervention?: (reason: string) => void;
  /** 进度更新回调 */
  onProgress?: (info: ProgressInfo) => void;
}

/**
 * 进度信息
 */
export interface ProgressInfo {
  phase: 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';
  currentTask?: Task;
  taskProgress: string;
  terminalPreview: string;
  elapsedMs: number;
  /** 大脑交互信息（实时显示用） */
  brainActivity?: string;
}

/**
 * 编排器 — AI Manager 的核心
 * 管理整个任务分解 → 执行 → 监控 → 评审 → 迭代 的生命周期
 */
export class Orchestrator {
  private opts: OrchestratorOptions;
  private config = loadConfig();
  private llm: LlmClient;
  private planParser: PlanParser;
  private taskManager: TaskManager;
  private outputAnalyzer: OutputAnalyzer;
  private instructionGenerator: InstructionGenerator;
  private qualityReviewer: QualityReviewer;
  private session: PtySession | null = null;
  private startTime = 0;
  private plan: Plan | null = null;
  private aborted = false;
  private execLog: ExecutionLog;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.execLog = new ExecutionLog(opts.workingDir);
    this.llm = new LlmClient(opts.brainModel);
    this.planParser = new PlanParser(this.llm);
    this.taskManager = new TaskManager();
    this.outputAnalyzer = new OutputAnalyzer(this.llm);
    this.instructionGenerator = new InstructionGenerator(this.llm);
    this.qualityReviewer = new QualityReviewer(this.llm);
  }

  /**
   * 启动编排循环
   */
  async run(): Promise<Plan> {
    this.startTime = Date.now();
    this.aborted = false;

    try {
      // Phase 1: 需求解析（如果外部已解析则跳过）
      this.emitProgress('planning');

      if (this.opts.preParsedTasks && this.opts.preParsedTasks.length > 0) {
        logger.info(chalk.cyan('📋 使用预解析的任务计划...'));
        this.taskManager.createTasks(this.opts.preParsedTasks);
      } else {
        logger.info(chalk.cyan('🎯 开始解析需求...'));
        const parsed = await this.planParser.parse(this.opts.requirement, this.opts.workingDir);
        this.taskManager.createTasks(parsed.tasks);
      }

      // 保存执行计划文档
      this.savePlanDocument();

      // 构建 Plan 对象
      this.plan = {
        id: crypto.randomUUID(),
        userRequirement: this.opts.requirement,
        tasks: this.taskManager.getAll(),
        currentTaskIndex: 0,
        status: 'executing',
        workingDir: this.opts.workingDir,
        agentType: this.opts.agentType,
        startedAt: new Date(),
      };

      // Phase 2: 启动编码 AI 终端会话
      logger.info(chalk.cyan('🚀 启动编码 AI 终端会话...'));
      this.session = this.createSession();

      // Phase 3: 逐个执行任务
      let task: Task | undefined;
      while ((task = this.taskManager.getNextPending()) && !this.aborted) {
        logger.info(chalk.yellow(`\n📋 执行任务: ${task.title} (尝试 ${task.attempts + 1}/${task.maxAttempts})`));
        this.plan.currentTaskIndex = this.taskManager.getAll().indexOf(task);

        await this.executeTask(task);
      }

      // Phase 4: 完成
      if (this.plan) {
        this.plan.status = this.aborted ? 'failed' : 'completed';
        this.plan.completedAt = new Date();
      }

      this.emitProgress('completed');

      // Phase 5: 生成项目使用文档（在 kill session 之前，避免 pty 清理影响子进程）
      if (!this.aborted) {
        await this.saveProjectReadme();
      }

      this.session?.kill();

      const summary = this.taskManager.getProgressSummary();
      logger.info(chalk.green(`\n✅ 任务完成! ${summary}`));
      logger.info(chalk.gray(`   总用时: ${this.elapsed()}`));

      this.opts.onComplete?.(this.plan!);
      return this.plan!;

    } catch (err) {
      logger.error(`编排器错误: ${err}`);
      if (this.plan) {
        this.plan.status = 'failed';
        this.plan.completedAt = new Date();
      }
      this.session?.kill();
      this.emitProgress('failed');
      throw err;
    }
  }

  /**
   * 中止编排
   */
  abort(): void {
    this.aborted = true;
    this.session?.kill();
    logger.warn('编排已中止');
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: Task): Promise<void> {
    this.taskManager.updateStatus(task.id, 'in_progress');
    this.execLog.taskStatus(task.title, 'in_progress');

    // 生成初始指令
    this.execLog.brainCall('生成指令', task.title);
    this.emitProgress('executing', task, { brainActivity: '🧠 生成指令...' });
    const instruction = await this.instructionGenerator.generateInitialInstruction(task);
    this.execLog.brainResponse('生成指令', instruction.content);
    this.taskManager.recordInstruction(task.id, instruction.content);

    logger.info(chalk.blue(`  → 发送指令: ${instruction.content.slice(0, 80)}...`));
    this.execLog.instructionSent(instruction.content);
    // Claude Code 输入框需要文本先落定，再单独按回车提交
    this.session!.write(instruction.content);
    await this.session!.input.sleep(500);
    this.session!.write('\r');
    await this.session!.input.sleep(instruction.waitFor);

    // 进入监控循环
    let consecutiveIdle = 0;
    const maxIdle = 3;
    const maxCycles = 60;
    let cycle = 0;

    while (cycle < maxCycles && !this.aborted) {
      cycle++;

      // 等待一个分析间隔
      await this.session!.input.sleep(this.config.analysisInterval);

      // 分析终端输出
      const analysis = await this.analyzeOutput(task);
      this.execLog.stateJudgment(analysis.state, analysis.summary);
      this.emitProgress('executing', task, {
        brainActivity: `📊 ${analysis.state}: ${analysis.summary}`,
      });

      logger.debug(`  状态: ${analysis.state} — ${analysis.summary}`);

      switch (analysis.state) {
        case 'working':
          consecutiveIdle = 0;
          break;

        case 'waiting_input':
          consecutiveIdle = 0;
          await this.handleWaitingInput(task, analysis);
          break;

        case 'error':
          consecutiveIdle = 0;
          await this.handleError(task, analysis);
          break;

        case 'completed':
          consecutiveIdle = 0;
          await this.handleCompleted(task);
          return;

        case 'idle':
          consecutiveIdle++;
          if (consecutiveIdle >= maxIdle) {
            logger.info('  终端空闲，检查任务是否完成...');
            this.execLog.info(`任务 ${task.title} 连续 ${maxIdle} 次 idle，进行最终评审`);
            await this.handleCompleted(task);
            return;
          }
          break;

        case 'unknown':
          break;
      }
    }

    logger.warn(`  任务 "${task.title}" 达到最大监控周期，进行最终评审`);
    this.execLog.info(`任务 ${task.title} 达到最大监控周期 ${maxCycles}`);
    await this.handleCompleted(task);
  }

  /**
   * 分析当前终端输出
   */
  private async analyzeOutput(task: Task): Promise<OutputAnalysis> {
    this.emitProgress('executing', task, { brainActivity: '🧠 分析终端输出...' });
    try {
      const result = await this.outputAnalyzer.analyze(
        this.session!.output,
        `${task.title}: ${task.description}`
      );
      this.execLog.brainResponse('输出分析', `${result.state}: ${result.summary}`);
      // 记录终端快照
      const snapshot = this.session!.output.getRecentLines(10);
      this.execLog.terminalSnapshot(snapshot);
      return result;
    } catch (err) {
      logger.warn(`输出分析失败: ${err}`);
      this.execLog.error(`输出分析失败: ${err}`);
      return {
        state: 'unknown',
        summary: '分析失败',
        detectedIssues: [],
        needsIntervention: false,
      };
    }
  }

  /**
   * 处理等待输入状态
   */
  private async handleWaitingInput(task: Task, analysis: OutputAnalysis): Promise<void> {
    const recentOutput = this.session!.output.getRecentLines(20);

    let instruction;
    if (analysis.suggestedInput) {
      instruction = { content: analysis.suggestedInput, waitFor: 3000 };
    } else {
      this.execLog.brainCall('生成响应', `等待输入: ${analysis.summary}`);
      this.emitProgress('executing', task, { brainActivity: '🧠 生成响应输入...' });
      instruction = await this.instructionGenerator.generateResponse({
        task,
        analysis,
        recentOutput,
      });
      this.execLog.brainResponse('生成响应', instruction.content);
    }

    logger.info(chalk.blue(`  → 响应输入: ${instruction.content.slice(0, 60)}`));
    this.execLog.instructionSent(instruction.content);
    this.taskManager.recordInstruction(task.id, instruction.content);
    this.session!.write(instruction.content);
    await this.session!.input.sleep(300);
    this.session!.write('\r');
    await this.session!.input.sleep(instruction.waitFor);
  }

  /**
   * 处理错误状态
   */
  private async handleError(task: Task, analysis: OutputAnalysis): Promise<void> {
    if (analysis.needsIntervention) {
      logger.warn(chalk.red(`  ⚠️ 需要人工介入: ${analysis.summary}`));
      this.execLog.error(`需要人工介入: ${analysis.summary}`);
      this.opts.onIntervention?.(analysis.summary);
      this.taskManager.updateStatus(task.id, 'blocked');
      this.execLog.taskStatus(task.title, 'blocked');
      return;
    }

    const recentOutput = this.session!.output.getRecentLines(30);
    this.execLog.brainCall('错误恢复', analysis.summary);
    this.emitProgress('executing', task, { brainActivity: '🧠 生成错误修复...' });
    const instruction = await this.instructionGenerator.generateResponse({
      task,
      analysis,
      recentOutput,
    });
    this.execLog.brainResponse('错误恢复', instruction.content);

    logger.info(chalk.blue(`  → 错误恢复: ${instruction.content.slice(0, 60)}`));
    this.execLog.instructionSent(instruction.content);
    this.taskManager.recordInstruction(task.id, instruction.content);
    this.session!.write(instruction.content);
    await this.session!.input.sleep(300);
    this.session!.write('\r');
    await this.session!.input.sleep(instruction.waitFor);
  }

  /**
   * 处理任务完成（进入质量评审）
   */
  private async handleCompleted(task: Task): Promise<void> {
    this.emitProgress('reviewing', task, { brainActivity: '🔍 质量评审中...' });
    logger.info(chalk.cyan('  🔍 质量评审中...'));

    const terminalOutput = this.session!.output.getFullCleanText();
    const review = await this.qualityReviewer.review(
      task,
      this.opts.workingDir,
      terminalOutput
    );

    this.taskManager.recordReview(task.id, review);
    this.taskManager.updateStatus(task.id, 'reviewing');
    this.execLog.review(review.score, review.passed, review.issues);

    if (review.passed) {
      this.taskManager.updateStatus(task.id, 'completed');
      this.execLog.taskStatus(task.title, `completed (评分: ${review.score}/10)`);
      logger.info(chalk.green(`  ✅ 任务完成! 评分: ${review.score}/10`));
    } else if (this.taskManager.canRetry(task.id)) {
      logger.warn(chalk.yellow(`  ⚠️ 评审未通过 (评分: ${review.score}/10)，准备重试...`));
      if (review.issues.length > 0) {
        logger.info(chalk.yellow('  问题:'));
        review.issues.forEach(i => logger.info(chalk.yellow(`    - ${i}`)));
      }

      this.execLog.brainCall('生成修复', review.issues.join('; '));
      this.emitProgress('executing', task, { brainActivity: '🧠 生成修复指令...' });
      const fixInstruction = await this.instructionGenerator.generateFixInstruction({
        task,
        issues: review.issues,
        suggestedFix: review.suggestedFix,
      });
      this.execLog.brainResponse('生成修复', fixInstruction.content);

      this.taskManager.recordInstruction(task.id, fixInstruction.content);
      this.taskManager.updateStatus(task.id, 'in_progress');

      logger.info(chalk.blue(`  → 修复指令: ${fixInstruction.content.slice(0, 80)}...`));
      this.execLog.instructionSent(fixInstruction.content);
      this.session!.write(fixInstruction.content);
      await this.session!.input.sleep(300);
      this.session!.write('\r');
      await this.session!.input.sleep(fixInstruction.waitFor);

      await this.executeTask(task);
    } else {
      this.taskManager.updateStatus(task.id, 'failed');
      this.execLog.taskStatus(task.title, 'failed (重试耗尽)');
      logger.error(chalk.red(`  ❌ 任务失败，已耗尽重试次数`));
    }
  }

  /**
   * 创建编码 AI 的 PTY 会话
   * Claude Code 加 --dangerously-skip-permissions 避免权限弹窗阻断自动化流程
   *
   * Windows 上 claude 是 .cmd 脚本，node-pty 无法直接启动，
   * 需要通过 cmd.exe /c 来中转
   */
  private createSession(): PtySession {
    let command: string;
    let args: string[];

    if (process.platform === 'win32') {
      // Windows: 通过 cmd.exe 中转
      const innerCmd = this.opts.agentType === 'claude-code'
        ? 'claude --dangerously-skip-permissions'
        : 'codex exec';
      command = 'cmd.exe';
      args = ['/c', innerCmd];
    } else {
      // Unix: 直接调用
      command = this.opts.agentType === 'claude-code' ? 'claude' : 'codex';
      args = this.opts.agentType === 'claude-code'
        ? ['--dangerously-skip-permissions']
        : ['exec'];
    }

    logger.info(`启动终端: ${command} ${args.join(' ')}`);
    logger.info(`工作目录: ${this.opts.workingDir}`);

    const session = new PtySession({
      command,
      args,
      cwd: this.opts.workingDir,
      cols: this.config.terminalCols,
      rows: this.config.terminalRows,
    });

    session.spawn();

    // 等待编码 AI 启动
    logger.info('等待编码 AI 启动...');
    return session;
  }

  /**
   * 发送进度信息
   */
  private emitProgress(
    phase: ProgressInfo['phase'],
    task?: Task,
    info?: { terminalPreview?: string; brainActivity?: string },
  ): void {
    this.opts.onProgress?.({
      phase,
      currentTask: task,
      taskProgress: this.taskManager.getProgressSummary(),
      terminalPreview: info?.terminalPreview ?? this.session?.output.getRecentLines(5) ?? '',
      elapsedMs: Date.now() - this.startTime,
      brainActivity: info?.brainActivity,
    });
  }

  /**
   * 获取已用时间
   */
  private elapsed(): string {
    const ms = Date.now() - this.startTime;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  /**
   * 保存执行计划文档到 .aimanager/plan.md
   */
  private savePlanDocument(): void {
    const dir = join(this.opts.workingDir, '.aimanager');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tasks = this.taskManager.getAll();
    const lines = [
      '# 执行计划',
      '',
      `> 由 AI Manager 自动生成`,
      `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
      '',
      `## 需求`,
      '',
      this.opts.requirement,
      '',
      '## 任务列表',
      '',
    ];

    tasks.forEach((t, i) => {
      lines.push(`### ${i + 1}. ${t.title}`);
      lines.push('');
      lines.push(t.description);
      lines.push('');
    });

    const planPath = join(dir, 'plan.md');
    writeFileSync(planPath, lines.join('\n'), 'utf-8');
    logger.info(`执行计划已保存: ${planPath}`);
  }

  /**
   * 项目完成后生成使用文档 README.md
   * 用 LLM 根据项目文件结构 + package.json 生成
   */
  private async saveProjectReadme(): Promise<void> {
    const readmePath = join(this.opts.workingDir, 'README.md');

    // 如果已有 README.md 且内容充实，不覆盖
    if (existsSync(readmePath)) {
      try {
        const existing = readFileSync(readmePath, 'utf-8');
        if (existing.length > 100) return; // 已有文档，跳过
      } catch { /* 忽略 */ }
    }

    logger.info(chalk.cyan('📝 生成项目使用文档...'));

    try {
      const fileTree = this.getProjectFileTree();
      const packageJson = this.readProjectPackageJson();
      const configFiles = this.readProjectConfigFiles();
      const sourceFiles = this.readProjectSourceFiles();

      const readmeContent = await this.llm.chat({
        system: PROJECT_README_PROMPT,
        user: `## 项目需求\n${this.opts.requirement}\n\n## package.json\n${packageJson}\n\n## 文件结构\n\`\`\`\n${fileTree}\n\`\`\`\n\n## 源代码\n${sourceFiles}\n\n## 配置文件\n${configFiles}\n\n请直接输出 README.md 的完整内容，不要包含任何解释或多余文本。`,
        maxTokens: 2048,
      });

      // 去掉可能的 markdown 代码块包裹
      let content = readmeContent.trim();
      if (content.startsWith('```markdown') || content.startsWith('```md')) {
        content = content.replace(/^```(?:markdown|md)\n?/, '').replace(/\n?```$/, '');
      } else if (content.startsWith('```')) {
        content = content.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      if (content.length > 50) {
        writeFileSync(readmePath, content, 'utf-8');
        logger.info(chalk.green(`📄 项目使用文档已生成: ${readmePath}`));
      }
    } catch (err) {
      logger.warn(`生成项目文档失败（不影响项目）: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 读取项目源代码文件内容（用于生成 README）
   */
  private readProjectSourceFiles(): string {
    const extensions = ['.js', '.ts', '.py', '.rs', '.go', '.java', '.html'];
    const maxFileSize = 3000;
    let result = '';

    const walk = (dir: string, depth: number) => {
      if (depth <= 0 || !existsSync(dir)) return;
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === '.aimanager') continue;
          const fullPath = join(dir, e.name);
          if (e.isFile() && extensions.some(ext => e.name.endsWith(ext))) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              if (content.length <= maxFileSize) {
                result += `\n### ${e.name}\n\`\`\`\n${content}\n\`\`\`\n`;
              } else {
                result += `\n### ${e.name}\n\`\`\`\n${content.slice(0, maxFileSize)}\n// ... (truncated)\n\`\`\`\n`;
              }
            } catch { /* 忽略 */ }
          } else if (e.isDirectory()) {
            walk(fullPath, depth - 1);
          }
        }
      } catch { /* 忽略 */ }
    };

    walk(this.opts.workingDir, 3);
    return result || '(无源代码文件)';
  }

  /**
   * 获取项目文件树（用于生成 README）
   */
  private getProjectFileTree(maxDepth = 3): string {
    const walk = (dir: string, depth: number, prefix: string): string => {
      if (depth <= 0 || !existsSync(dir)) return '';
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.aimanager')
          .slice(0, 30);
        let result = '';
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          result += `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
          if (entry.isDirectory()) {
            result += walk(fullPath, depth - 1, prefix + '  ');
          }
        }
        return result;
      } catch { return ''; }
    };
    return walk(this.opts.workingDir, maxDepth, '');
  }

  /**
   * 读取项目的 package.json
   */
  private readProjectPackageJson(): string {
    const pkgPath = join(this.opts.workingDir, 'package.json');
    if (!existsSync(pkgPath)) return '(无 package.json)';
    try {
      const raw = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      // 只保留关键字段，避免输出过大
      const filtered = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        scripts: pkg.scripts,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        bin: pkg.bin,
        main: pkg.main,
      };
      return JSON.stringify(filtered, null, 2);
    } catch { return '(无法解析 package.json)'; }
  }

  /**
   * 读取项目的配置文件（tsconfig, pyproject 等）
   */
  private readProjectConfigFiles(): string {
    const configNames = ['tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'requirements.txt', 'config.json'];
    let result = '';
    for (const name of configNames) {
      const path = join(this.opts.workingDir, name);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8');
          result += `\n### ${name}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\`\n`;
        } catch { /* 忽略 */ }
      }
    }
    return result || '(无配置文件)';
  }
}

const PROJECT_README_PROMPT = `CRITICAL: Output ONLY the raw Markdown content of a README.md file. No explanation, no questions, no conversation. Start directly with # title.

你是一个项目文档专家。根据项目信息生成一份实用的中文 README.md。

## 必须包含的部分

1. **项目名称和简介**
2. **功能特性**（根据源代码推断）
3. **安装步骤**（具体的依赖安装命令）
4. **使用方法**（启动命令 + 使用示例，直接复制就能跑）
5. **项目结构**（关键目录/文件说明）

## 规则

- 用中文撰写
- 用实际的命令、文件名、参数名
- 简洁实用，每句话都要有信息量
- 不要包含 AI Manager 相关内容`;
