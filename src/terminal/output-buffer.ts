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

  constructor(maxLines = 500) {
    this.maxLines = maxLines;
  }

  /** 追加一段输出 */
  append(data: string): void {
    this.rawChunks.push(data);
    this.cleanChunks.push(stripAnsi(data));
    this.fullRawOutput += data;

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

  /** 清空缓冲区 */
  clear(): void {
    this.rawChunks = [];
    this.cleanChunks = [];
    this.fullRawOutput = '';
  }

  /** 获取缓冲区大致大小 */
  get size(): number {
    return this.fullRawOutput.length;
  }
}
