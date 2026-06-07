import { describe, it, expect } from 'vitest';
import { OutputFilter } from '../src/terminal/output-filter.js';

describe('OutputFilter', () => {
  describe('compress (重度压缩)', () => {
    it('保留错误/警告等重要行', () => {
      // 需要足够长的输入避免短文本兜底
      const filler = Array(10).fill('some regular build output line here').join('\n');
      const input = [
        filler,
        'Error: cannot find module xyz',
        filler,
        'Warning: deprecated API usage detected here',
        filler,
      ].join('\n');

      const result = OutputFilter.compress(input);
      expect(result).toContain('Error: cannot find module xyz');
      expect(result).toContain('Warning: deprecated API usage');
    });

    it('去除进度条噪音', () => {
      const filler = Array(10).fill('some normal build output here for padding').join('\n');
      const input = [
        filler,
        '████████░░░░ 67% downloading packages',
        '[====      ] downloading packages from registry',
        filler,
      ].join('\n');

      const result = OutputFilter.compress(input);
      expect(result).not.toContain('████');
      expect(result).toContain('some normal build output');
    });

    it('压缩连续通过测试行为摘要', () => {
      const input = [
        'PASS test unit helper functions correctly',
        'PASS test integration flow works as expected',
        'PASS test output compression removes noise',
        'PASS test token estimation is reasonable',
        'some other important output here after tests',
        'more trailing output line for padding one',
        'more trailing output line for padding two',
      ].join('\n');

      const result = OutputFilter.compress(input);
      expect(result).toContain('passing tests');
      expect(result).toContain('some other important output');
    });

    it('短文本原样返回', () => {
      expect(OutputFilter.compress('short')).toBe('short');
    });
  });

  describe('compressLight (轻度压缩)', () => {
    it('去空行和去重连续相同行', () => {
      // 输入需要 > 50 字符
      const input = [
        'line a with enough content for threshold',
        '',
        'line b repeated content here for test',
        'line b repeated content here for test',
        'line b repeated content here for test',
        'line c with enough content for threshold',
      ].join('\n');

      const result = OutputFilter.compressLight(input);
      expect(result).toContain('[×3]');
      expect(result).toContain('line a');
      expect(result).toContain('line c');
    });

    it('短文本原样返回', () => {
      expect(OutputFilter.compressLight('hi')).toBe('hi');
    });
  });
});
