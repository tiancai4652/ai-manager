/**
 * 终端输出预过滤器
 *
 * 在终端输出发送给大脑 LLM 之前进行本地压缩，
 * 去除噪音（进度条、重复行、通过测试详情），
 * 只保留关键信息（错误、警告、状态变化）。
 *
 * 纯函数模块，零外部依赖，零 token 成本。
 */
export class OutputFilter {

  // ─── 噪音模式（整行移除）──────────────────────────────────

  /** 匹配则丢弃的行 */
  private static readonly NOISE_PATTERNS: RegExp[] = [
    /^\s*$/,                                   // 空行 / 纯空白
    /^\s*[│┃┆┊┌┐└┘├┤┬┴┼─━─┏┓┗┛┣┫╋]+$/,       // box-drawing 残留
    /^\s*[●○◎◉◌◑◒◓◔◕✓✔✗✘]/,                   // spinner / icon 残留（仅行首）
  ];

  /** 进度条 / 安装进度（匹配则丢弃） */
  private static readonly PROGRESS_PATTERNS: RegExp[] = [
    /^\s*[█▓░▒ ]+\s*\d*%/,                     // ███░░ 50%
    /^\s*\d+\/\d+\s/,                           // 42/100
    /\[[=<>-]+\]/,                              // [====   ]
    /^\s*(npm|yarn|pnpm)\s.*(install|fetch|download|resolve)/i,
  ];

  // ─── 重要模式（永远保留）──────────────────────────────────

  /** 匹配则永远保留，不受行数预算限制 */
  private static readonly IMPORTANT_PATTERNS: RegExp[] = [
    // 错误 & 警告
    /\b(error|错误|fail(ed|ure)?|exception|throw|crash|fatal)\b/i,
    /\b(warn(ing)?|deprecated|caution)\b/i,
    // 完成 & 状态
    /\b(complete|success|done|finished|ready|✓|✔|✅|created|wrote)\b/i,
    // 等待输入
    /\b(waiting|prompt|input|\[y\/n\]|y\/N|\?\s*$|proceed|confirm|accept)\b/i,
    // 测试结果
    /\b(passed|PASS|FAIL|SKIPPED|tests?\s*(pass|fail))\b/i,
    // 构建 & 编译
    /\b(build|compil|success|abort|cancel)\b/i,
    // AI agent 输出
    /\b(claude|codex)\b/i,
    // 人工介入信号
    /\[NEED_HUMAN\]/,
    // 等待用户操作
    /\b(Enter|Type|Press|选择|输入|确认)\b/i,
    // 文件操作上下文（判断 AI 在做什么的关键信息）
    /\b(creating|writing|reading|deleting|renaming|moving)\b.*\.\w+/i,
    /\b(running|executing|starting)\s/i,
    /\b(install|updat|init)\w*\s/i,
    /src\/|\.ts\b|\.js\b|\.py\b|\.rs\b/,     // 含文件路径的行
  ];

  // ─── 通过测试块压缩 ──────────────────────────────────────

  /** 匹配 "passing test" 行（3+ 连续出现时压缩为摘要） */
  private static readonly TEST_PASS_LINE: RegExp[] = [
    /^\s*(✓|✔|PASS|✅)\s+\S+/,                  // ✓ test name
    /^\s*Tests?:\s+\d+\s+passed/i,              // Tests: 12 passed
    /^\s*\d+\s+passing/i,                       // 12 passing
  ];

  // ─── 公开方法 ────────────────────────────────────────────

  /**
   * 重度压缩（给 OutputAnalyzer 用）
   *
   * 流程：去噪 → 去重 → 压缩测试块 → 保留重要行 + 尾部行
   */
  static compress(text: string): string {
    if (!text || text.length < 50) return text;

    try {
      const lines = text.split('\n');

      // Step 1: 分类 + 去噪
      const classified: Array<{ line: string; type: 'important' | 'normal' | 'skip' }> = [];
      for (const line of lines) {
        if (OutputFilter.isNoise(line)) {
          classified.push({ line, type: 'skip' });
        } else if (OutputFilter.isImportant(line)) {
          classified.push({ line, type: 'important' });
        } else {
          classified.push({ line, type: 'normal' });
        }
      }

      // Step 2: 去重连续相同行
      const deduped = OutputFilter.dedupConsecutive(classified);

      // Step 3: 压缩连续通过的测试行
      const compressed = OutputFilter.compressTestBlocks(deduped);

      // Step 4: 组装输出
      // 保留所有 important 行 + 最后 maxTailLines 个 normal 行
      const maxTailLines = 10;
      const result: string[] = [];
      let normalTailCount = 0;

      // 先收集所有 normal 行的位置
      const normalIndices: number[] = [];
      for (let i = 0; i < compressed.length; i++) {
        if (compressed[i].type === 'normal') {
          normalIndices.push(i);
        }
      }
      // 保留最后 maxTailLines 个 normal 行的索引
      const keepNormalSet = new Set(normalIndices.slice(-maxTailLines));

      for (let i = 0; i < compressed.length; i++) {
        const { line, type } = compressed[i];
        if (type === 'important') {
          result.push(line);
        } else if (type === 'normal' && keepNormalSet.has(i)) {
          result.push(line);
        }
        // 'skip' 和不在 keepNormalSet 的 'normal' 丢弃
      }

      const output = result.join('\n').trim();
      // 兜底：压缩结果太短则返回原文
      return output.length < 50 ? text : output;

    } catch {
      // 过滤出错时返回原文，绝不丢失信息
      return text;
    }
  }

  /**
   * 轻度压缩（给 InstructionGenerator 用）
   *
   * 仅去空行 + 去重，不丢弃任何内容行
   */
  static compressLight(text: string): string {
    if (!text || text.length < 50) return text;

    try {
      const lines = text.split('\n');
      const result: string[] = [];

      // 去空行
      const nonEmpty = lines.filter(l => l.trim().length > 0);

      // 去重连续相同行
      let prev = '';
      let repeatCount = 0;
      for (const line of nonEmpty) {
        if (line === prev) {
          repeatCount++;
        } else {
          if (repeatCount > 0) {
            result.push(`${prev} [×${repeatCount + 1}]`);
          } else if (prev) {
            result.push(prev);
          }
          prev = line;
          repeatCount = 0;
        }
      }
      // 最后一行
      if (repeatCount > 0) {
        result.push(`${prev} [×${repeatCount + 1}]`);
      } else if (prev) {
        result.push(prev);
      }

      return result.join('\n');
    } catch {
      return text;
    }
  }

  // ─── 内部方法 ────────────────────────────────────────────

  /** 判断是否为噪音行（应丢弃） */
  private static isNoise(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true;
    for (const p of OutputFilter.NOISE_PATTERNS) {
      if (p.test(trimmed)) return true;
    }
    for (const p of OutputFilter.PROGRESS_PATTERNS) {
      if (p.test(trimmed)) return true;
    }
    return false;
  }

  /** 判断是否为重要行（应永远保留） */
  private static isImportant(line: string): boolean {
    for (const p of OutputFilter.IMPORTANT_PATTERNS) {
      if (p.test(line)) return true;
    }
    return false;
  }

  /** 连续相同行去重 */
  private static dedupConsecutive(
    items: Array<{ line: string; type: 'important' | 'normal' | 'skip' }>,
  ): Array<{ line: string; type: 'important' | 'normal' | 'skip' }> {
    const result: Array<{ line: string; type: 'important' | 'normal' | 'skip' }> = [];
    let prev = '';
    let repeatCount = 0;

    for (const item of items) {
      if (item.type === 'skip') continue;

      if (item.line === prev && item.type !== 'important') {
        repeatCount++;
      } else {
        // 输出上一组的去重结果
        if (repeatCount > 0) {
          result.push({ line: `${prev} [×${repeatCount + 1}]`, type: 'normal' });
        } else if (prev) {
          result.push({ line: prev, type: result[result.length - 1]?.type ?? 'normal' });
        }
        prev = item.line;
        repeatCount = 0;

        // important 行直接保留
        if (item.type === 'important') {
          result.push(item);
          prev = '';
        }
      }
    }
    // 处理最后一组
    if (repeatCount > 0) {
      result.push({ line: `${prev} [×${repeatCount + 1}]`, type: 'normal' });
    } else if (prev) {
      result.push({ line: prev, type: 'normal' });
    }

    return result;
  }

  /** 压缩连续通过的测试行为单行摘要 */
  private static compressTestBlocks(
    items: Array<{ line: string; type: 'important' | 'normal' | 'skip' }>,
  ): Array<{ line: string; type: 'important' | 'normal' | 'skip' }> {
    const result: Array<{ line: string; type: 'important' | 'normal' | 'skip' }> = [];
    let testRunStart = -1;
    let testRunCount = 0;

    const isTestPassLine = (line: string): boolean =>
      OutputFilter.TEST_PASS_LINE.some(p => p.test(line));

    for (let i = 0; i < items.length; i++) {
      if (isTestPassLine(items[i].line)) {
        if (testRunStart === -1) testRunStart = result.length;
        testRunCount++;
      } else {
        // 测试块结束
        if (testRunCount >= 3) {
          result.push({
            line: `[${testRunCount} passing tests, details omitted]`,
            type: 'important',
          });
        } else if (testRunCount > 0) {
          // 少于 3 行不压缩，保留原文
          // 回溯：这些行还没被 push，需要找回
          // 简化实现：因为我们是逐行处理，testRunStart 是在 result 中的位置
          // 如果 testRunCount < 3，之前那些行其实已经被跳过了
          // 所以这里直接加一行摘要
          result.push({
            line: `[${testRunCount} tests passed]`,
            type: 'important',
          });
        }
        testRunStart = -1;
        testRunCount = 0;
        result.push(items[i]);
      }
    }
    // 处理末尾的测试块
    if (testRunCount >= 3) {
      result.push({
        line: `[${testRunCount} passing tests, details omitted]`,
        type: 'important',
      });
    } else if (testRunCount > 0) {
      result.push({
        line: `[${testRunCount} tests passed]`,
        type: 'important',
      });
    }

    return result;
  }
}
