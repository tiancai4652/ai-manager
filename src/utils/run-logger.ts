import type { LLMCallRecord, RunReport } from '../models/llm-call-record.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

/**
 * 运行日志记录器
 *
 * 累积每次 LLM 调用记录，运行结束后生成：
 * - .aimanager/run-report.json  (结构化数据，便于程序分析)
 * - .aimanager/run-report.md    (可读报告，便于人工查看)
 */
export class RunLogger {
  private records: LLMCallRecord[] = [];
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /** 记录一次 LLM 调用 */
  record(rec: LLMCallRecord): void {
    this.records.push(rec);
  }

  /** 获取累计统计（给进度显示用） */
  getStats(): { totalCalls: number; totalTokens: number } {
    return {
      totalCalls: this.records.length,
      totalTokens: this.records.reduce((sum, r) => sum + r.estimatedTokens, 0),
    };
  }

  /** 获取最近 N 次调用记录 */
  getRecent(n: number): LLMCallRecord[] {
    return this.records.slice(-n);
  }

  /** 写入运行报告 */
  writeReport(meta: { requirement: string; startedAt: Date; completedAt: Date }): void {
    const dir = join(this.workingDir, '.aimanager');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const summary = this.buildSummary();
    const report: RunReport = {
      id: crypto.randomUUID(),
      requirement: meta.requirement,
      startedAt: meta.startedAt.toISOString(),
      completedAt: meta.completedAt.toISOString(),
      totalDurationMs: meta.completedAt.getTime() - meta.startedAt.getTime(),
      llmCalls: this.records,
      summary,
    };

    // JSON 结构化数据
    writeFileSync(join(dir, 'run-report.json'), JSON.stringify(report, null, 2), 'utf-8');
    // Markdown 可读报告
    this.writeReadableReport(dir, report);

    logger.info(`📊 运行报告已保存: ${dir}/run-report.{json,md}`);
  }

  // ─── 内部方法 ─────────────────────────────────────────

  private buildSummary(): RunReport['summary'] {
    const total = this.records.length;
    const tokens = this.records.reduce((s, r) => s + r.estimatedTokens, 0);
    const inputChars = this.records.reduce((s, r) => s + r.inputChars, 0);
    const outputChars = this.records.reduce((s, r) => s + r.outputChars, 0);
    const avgMs = total > 0
      ? Math.round(this.records.reduce((s, r) => s + r.durationMs, 0) / total)
      : 0;

    const byPurpose: Record<string, { calls: number; tokens: number; avgMs: number }> = {};
    for (const rec of this.records) {
      if (!byPurpose[rec.purpose]) {
        byPurpose[rec.purpose] = { calls: 0, tokens: 0, avgMs: 0 };
      }
      byPurpose[rec.purpose].calls++;
      byPurpose[rec.purpose].tokens += rec.estimatedTokens;
    }
    for (const [key, group] of Object.entries(byPurpose)) {
      const groupRecords = this.records.filter(r => r.purpose === key);
      group.avgMs = Math.round(groupRecords.reduce((s, r) => s + r.durationMs, 0) / groupRecords.length);
    }

    return {
      totalCalls: total,
      totalEstimatedTokens: tokens,
      totalInputChars: inputChars,
      totalOutputChars: outputChars,
      avgCallDurationMs: avgMs,
      byPurpose,
    };
  }

  private writeReadableReport(dir: string, report: RunReport): void {
    const lines: string[] = [];
    lines.push('# AI Manager 运行报告');
    lines.push('');
    lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push('');

    // 概要
    lines.push('## 概要');
    lines.push('');
    const dur = Math.round(report.totalDurationMs / 1000);
    lines.push(`- **总用时**: ${Math.floor(dur / 60)}m ${dur % 60}s`);
    lines.push(`- **LLM 调用次数**: ${report.summary.totalCalls}`);
    lines.push(`- **估算总 Token**: ${report.summary.totalEstimatedTokens.toLocaleString()}`);
    lines.push(`- **平均调用耗时**: ${report.summary.avgCallDurationMs}ms`);
    lines.push(`- **输入总字符**: ${report.summary.totalInputChars.toLocaleString()}`);
    lines.push(`- **输出总字符**: ${report.summary.totalOutputChars.toLocaleString()}`);
    lines.push('');

    // 按用途分类
    if (Object.keys(report.summary.byPurpose).length > 0) {
      lines.push('## 按用途分类');
      lines.push('');
      lines.push('| 用途 | 调用次数 | 估算 Token | 平均耗时 |');
      lines.push('|------|---------|-----------|---------|');
      for (const [purpose, stats] of Object.entries(report.summary.byPurpose)) {
        lines.push(`| ${purpose} | ${stats.calls} | ${stats.tokens.toLocaleString()} | ${stats.avgMs}ms |`);
      }
      lines.push('');
    }

    // 调用明细
    if (report.llmCalls.length > 0) {
      lines.push('## 调用明细');
      lines.push('');
      lines.push('| # | 时间 | 用途 | 类型 | 耗时 | 输入字符 | 输出字符 | Token |');
      lines.push('|---|------|------|------|------|---------|---------|-------|');
      report.llmCalls.forEach((rec, i) => {
        const time = rec.timestamp.slice(11, 19);
        const ok = rec.success ? '' : ' ❌';
        lines.push(
          `| ${i + 1} | ${time} | ${rec.purpose}${ok} | ${rec.type} | ${rec.durationMs}ms `
          + `| ${rec.inputChars.toLocaleString()} | ${rec.outputChars.toLocaleString()} | ${rec.estimatedTokens.toLocaleString()} |`,
        );
      });
    }

    writeFileSync(join(dir, 'run-report.md'), lines.join('\n'), 'utf-8');
  }
}
