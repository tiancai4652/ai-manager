import stripAnsi from 'strip-ansi';

/**
 * 终端输出缓冲区
 * 维护一个滑动窗口的输出，提供原始输出和清洗后的输出
 */
export class OutputBuffer {
  /** 原始输出（含 ANSI） */
  private rawChunks: string[] = [];
  /** 清洗后的输出（去 ANSI） */
  private cleanChunks: string[] = [];
  /** 最大保留行数 */
  private maxLines: number;
  /** 所有原始输出（用于获取完整历史） */
  private fullRawOutput = '';
  /** 变化令牌：每次 append/clear 自增，用于检测输出是否有变化 */
  private changeToken = 0;

  constructor(maxLines = 500) {
    this.maxLines = maxLines;
  }

  /** 追加一段输出 */
  append(data: string): void {
    this.rawChunks.push(data);
    this.cleanChunks.push(stripAnsi(data));
    this.fullRawOutput += data;
    this.changeToken++;

    // 滑动窗口：按行数裁剪
    const totalLines = this.cleanChunks.join('').split('\n').length;
    if (totalLines > this.maxLines * 2) {
      // 保留最近的 chunks
      const keepCount = Math.ceil(this.rawChunks.length / 2);
      this.rawChunks = this.rawChunks.slice(-keepCount);
      this.cleanChunks = this.cleanChunks.slice(-keepCount);
    }
  }

  /** 获取最近 N 行的清洗文本（给 LLM 分析用） */
  getRecentLines(lineCount: number): string {
    const fullClean = this.cleanChunks.join('');
    const lines = fullClean.split('\n');
    return lines.slice(-lineCount).join('\n');
  }

  /** 获取所有清洗后的文本 */
  getFullCleanText(): string {
    return this.cleanChunks.join('');
  }

  /** 获取所有原始文本（含 ANSI） */
  getFullRawText(): string {
    return this.fullRawOutput;
  }

  /** 获取最近的原始输出（用于显示） */
  getRecentRaw(chunkCount = 20): string {
    return this.rawChunks.slice(-chunkCount).join('');
  }

  /** 获取最后几行（用于快速状态判断） */
  getLastLine(): string {
    const text = this.cleanChunks.join('');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    return lines[lines.length - 1] ?? '';
  }

  /**
   * 扫描输出中的人工介入信号 [NEED_HUMAN]...[/NEED_HUMAN]
   * 返回标记内的原因文本，未找到返回 null
   */
  scanInterventionSignal(): string | null {
    const text = this.cleanChunks.join('');
    const match = text.match(/\[NEED_HUMAN\]([\s\S]*?)\[\/NEED_HUMAN\]/);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * 快速扫描常见的 Y/N 确认提示（零 token 预判）
   *
   * 检测编码 AI 末尾是否在等待一个简单的 Y/N 确认。
   * 如果匹配，返回建议的输入内容（如 'y'）；
   * 如果不匹配或不确定，返回 null（交给大脑 LLM 处理）。
   */
  scanQuickConfirmation(): string | null {
    const lastLines = this.getRecentLines(8);

    // Claude Code 的 plan 确认: "Do you want to proceed? [Y/n]"
    // 通用 Y/N 提示: "[Y/n]", "[y/N]", "(Y/n)", "(y/N)"
    // 以及 "Proceed?", "Confirm?", "Accept?"
    if (/\[Y\/n\]|\(Y\/n\)|proceed\?|confirm\?|accept\?/i.test(lastLines)) {
      return 'y';
    }
    // 默认 No 的情况: "[y/N]" — 仍然回复 y（自动化场景下倾向于继续）
    if (/\[y\/N\]|\(y\/N\)/i.test(lastLines)) {
      return 'y';
    }
    // "Press Y to continue" 类型
    if (/press\s+Y\s+to\s+(continue|proceed)/i.test(lastLines)) {
      return 'y';
    }

    return null;
  }

  /**
   * 快速状态预判（零 token）
   *
   * 用正则扫描终端末尾输出，高置信度判断编码 AI 状态。
   * 返回预判的状态，或 null 表示不确定（交给大脑 LLM）。
   *
   * 能预判的状态：
   * - working: Claude Code 正在处理（spinner 动画词、活跃输出）
   * - completed: Claude Code 完成任务回到提示符
   * - idle: 连续空提示符，无活动
   */
  scanQuickState(): 'working' | 'completed' | 'idle' | null {
    const lastLines = this.getRecentLines(10);
    const trimmed = lastLines.trim();
    if (!trimmed) return 'idle';

    // ─── working 预判 ────────────────────────────────────
    // Claude Code 的 spinner 动画词: Shimmying, Gusting, Embellishing, Cogitating...
    // 格式: "Xs · ↑/↓ N" 或 spinner 符号 + 动画词
    if (/\b(Shimmying|Gusting|Embellishing|Cogitat|Ponder|Muse|Analyz|Process|Generat|Reason)\w*\s*[.…·]/i.test(lastLines)) {
      return 'working';
    }
    // 通用 spinner/进度指示器
    if (/[⣾⣽⣻⢿⡿⣟⣯⣷⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋]/.test(lastLines) && !/❯\s*$/.test(trimmed)) {
      return 'working';
    }
    // Claude Code 活跃指示: "Ns · ↑/↓ N" 格式
    if (/\d+s\s*·\s*[↑↓]\s*\d/i.test(lastLines)) {
      return 'working';
    }

    // ─── completed 预判 ──────────────────────────────────
    // Claude Code 完成后的典型末尾:
    //   "Cogitated for 7s"
    //   ──────── divider ────────
    //   ❯  (提示符)
    //   ──────── divider ────────
    //   bottom bar
    if (/Cogitated\s+for\s+\d+s/i.test(lastLines) && /❯\s*$/m.test(lastLines)) {
      return 'completed';
    }
    // "wrote to" / "created" 文件消息后回到提示符
    if (/\b(wrote|created|updated|saved)\b.*\.(\w+)\b/i.test(lastLines) && /❯\s*$/m.test(lastLines)) {
      return 'completed';
    }
    // 测试通过 + 回到提示符
    if (/\b(passed|PASS|✓|✔)\b.*test/i.test(lastLines) && /❯\s*$/m.test(lastLines)) {
      return 'completed';
    }

    // ─── idle 预判 ───────────────────────────────────────
    // 连续多个空提示符（Claude Code 空闲等待输入）
    const promptCount = (lastLines.match(/❯\s*$/gm) || []).length;
    if (promptCount >= 3) {
      return 'idle';
    }

    return null; // 不确定，交给 LLM
  }

  /** 清空缓冲区 */
  clear(): void {
    this.rawChunks = [];
    this.cleanChunks = [];
    this.fullRawOutput = '';
    this.changeToken++;
  }

  /** 获取缓冲区大致大小 */
  get size(): number {
    return this.fullRawOutput.length;
  }

  /** 获取当前变化令牌（每次输出变化时自增） */
  getChangeToken(): number {
    return this.changeToken;
  }

  /** 判断自给定令牌以来输出是否发生了变化 */
  hasChangedSince(token: number): boolean {
    return this.changeToken !== token;
  }
}
