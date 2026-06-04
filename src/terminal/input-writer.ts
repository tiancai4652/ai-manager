import type { IPty } from 'node-pty';

/**
 * 输入注入器
 * 负责向 PTY 会话写入输入，带防抖和延迟支持
 */
export class InputWriter {
  private pty: IPty | null = null;
  private lastWriteTime = 0;
  private minInterval: number;

  constructor(minInterval = 100) {
    this.minInterval = minInterval;
  }

  /** 绑定到 PTY 实例 */
  attach(pty: IPty): void {
    this.pty = pty;
  }

  /** 向终端写入文本（模拟键盘输入） */
  async write(text: string): Promise<void> {
    if (!this.pty) {
      throw new Error('InputWriter not attached to a PTY instance');
    }

    // 确保最小间隔
    const now = Date.now();
    const elapsed = now - this.lastWriteTime;
    if (elapsed < this.minInterval) {
      await this.sleep(this.minInterval - elapsed);
    }

    this.pty.write(text);
    this.lastWriteTime = Date.now();
  }

  /** 发送一行命令（自动追加回车） */
  async sendLine(line: string): Promise<void> {
    await this.write(line + '\r');
  }

  /** 发送 Enter 键 */
  async sendEnter(): Promise<void> {
    await this.write('\r');
  }

  /** 发送 Ctrl+C */
  async sendCtrlC(): Promise<void> {
    await this.write('\x03');
  }

  /** 发送 Ctrl+D (EOF) */
  async sendCtrlD(): Promise<void> {
    await this.write('\x04');
  }

  /** 延迟指定时间 */
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 写入后等待 */
  async writeAndWait(text: string, waitMs: number): Promise<void> {
    await this.write(text);
    await this.sleep(waitMs);
  }
}
