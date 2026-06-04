import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 执行日志
 * 将所有大脑交互、状态判断、指令发送记录到 .aimanager/execution.log
 */
export class ExecutionLog {
  private logPath: string;

  constructor(workingDir: string) {
    const dir = join(workingDir, '.aimanager');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.logPath = join(dir, 'execution.log');
    this.append('='.repeat(60));
    this.append(`AI Manager 执行日志 - ${new Date().toLocaleString('zh-CN')}`);
    this.append('='.repeat(60));
  }

  /** 记录大脑调用（LLM 请求） */
  brainCall(type: string, summary: string): void {
    const ts = this.timestamp();
    this.append(`[${ts}] 🧠 大脑调用 [${type}]: ${summary}`);
  }

  /** 记录大脑响应 */
  brainResponse(type: string, result: string): void {
    const ts = this.timestamp();
    const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
    this.append(`[${ts}] 🧠 大脑响应 [${type}]: ${preview}`);
  }

  /** 记录状态判断 */
  stateJudgment(state: string, summary: string): void {
    const ts = this.timestamp();
    this.append(`[${ts}] 📊 状态判断: ${state} — ${summary}`);
  }

  /** 记录指令发送 */
  instructionSent(content: string): void {
    const ts = this.timestamp();
    const preview = content.length > 150 ? content.slice(0, 150) + '...' : content;
    this.append(`[${ts}] ➡️  发送指令: ${preview}`);
  }

  /** 记录质量评审 */
  review(score: number, passed: boolean, issues: string[]): void {
    const ts = this.timestamp();
    this.append(`[${ts}] 🔍 质量评审: ${score}/10 ${passed ? '✅ 通过' : '❌ 未通过'}`);
    if (issues.length > 0) {
      issues.forEach(i => this.append(`          - ${i}`));
    }
  }

  /** 记录任务状态变更 */
  taskStatus(taskTitle: string, status: string): void {
    const ts = this.timestamp();
    this.append(`[${ts}] 📋 任务: ${taskTitle} → ${status}`);
  }

  /** 记录终端输出快照 */
  terminalSnapshot(output: string): void {
    const ts = this.timestamp();
    const lines = output.split('\n').filter(l => l.trim()).slice(-5);
    this.append(`[${ts}] 📡 终端输出 (最近5行):`);
    lines.forEach(l => this.append(`          ${l.slice(0, 120)}`));
  }

  /** 记录通用信息 */
  info(message: string): void {
    this.append(`[${this.timestamp()}] ℹ️  ${message}`);
  }

  /** 记录错误 */
  error(message: string): void {
    this.append(`[${this.timestamp()}] ❌ ${message}`);
  }

  private append(line: string): void {
    try {
      appendFileSync(this.logPath, line + '\n', 'utf-8');
    } catch {
      // 日志写入失败不影响主流程
    }
  }

  private timestamp(): string {
    return new Date().toISOString().slice(11, 19);
  }

  get path(): string {
    return this.logPath;
  }
}
