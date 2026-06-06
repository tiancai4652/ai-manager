import { spawn, type IPty } from 'node-pty';
import { OutputBuffer } from './output-buffer.js';
import { InputWriter } from './input-writer.js';
import { logger } from '../utils/logger.js';
import type { TerminalConfig } from '../models/session-state.js';

/**
 * PTY 终端会话
 * 核心职责：管理一个 node-pty 伪终端实例，提供 spawn/write/onOutput/kill
 */
export class PtySession {
  private pty: IPty | null = null;
  private readonly config: TerminalConfig;
  readonly output: OutputBuffer;
  readonly input: InputWriter;
  private outputCallbacks: Array<(data: string) => void> = [];
  private exitCode: number | null = null;
  private exitPromise: Promise<number> | null = null;
  private exitResolve: ((code: number) => void) | null = null;

  constructor(config: Partial<TerminalConfig> & Pick<TerminalConfig, 'command'>) {
    this.config = {
      args: [],
      cwd: process.cwd(),
      cols: 120,
      rows: 40,
      ...config,
    };
    this.output = new OutputBuffer();
    this.input = new InputWriter();
  }

  /** 启动伪终端 */
  spawn(): void {
    if (this.pty) {
      throw new Error('PTY session already spawned');
    }

    logger.debug(`Spawning PTY: ${this.config.command} ${this.config.args.join(' ')}`);
    logger.debug(`  cwd: ${this.config.cwd}, cols: ${this.config.cols}, rows: ${this.config.rows}`);

    this.exitPromise = new Promise(resolve => {
      this.exitResolve = resolve;
    });

    this.pty = spawn(this.config.command, this.config.args, {
      name: 'xterm-256color',
      cols: this.config.cols,
      rows: this.config.rows,
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });

    this.input.attach(this.pty);

    // 实时输出流
    this.pty.onData((data: string) => {
      this.output.append(data);
      for (const cb of this.outputCallbacks) {
        cb(data);
      }
    });

    // 进程退出
    this.pty.onExit(({ exitCode }) => {
      this.exitCode = exitCode;
      logger.debug(`PTY exited with code: ${exitCode}`);
      this.exitResolve?.(exitCode);
    });
  }

  /** 注册输出回调（实时触发） */
  onOutput(callback: (data: string) => void): void {
    this.outputCallbacks.push(callback);
  }

  /** 移除输出回调 */
  offOutput(callback: (data: string) => void): void {
    this.outputCallbacks = this.outputCallbacks.filter(cb => cb !== callback);
  }

  /** 写入输入（进程已死时静默忽略） */
  write(data: string): void {
    if (!this.isAlive()) return;
    this.pty!.write(data);
  }

  /** 发送一行命令 */
  sendLine(line: string): void {
    this.write(line + '\r');
  }

  /** 进程是否还在运行 */
  isAlive(): boolean {
    return this.pty !== null && this.exitCode === null;
  }

  /** 获取退出码（null 表示还在运行） */
  getExitCode(): number | null {
    return this.exitCode;
  }

  /** 等待进程退出 */
  async waitExit(): Promise<number> {
    if (this.exitCode !== null) return this.exitCode;
    if (!this.exitPromise) throw new Error('PTY not spawned');
    return this.exitPromise;
  }

  /** 终止进程（重复调用或进程已死均安全） */
  kill(): void {
    if (!this.pty) return;
    try {
      logger.debug('Killing PTY session');
      this.pty.kill();
    } catch {
      // 进程可能已自行退出，忽略清理错误
    }
    this.pty = null;
    this.exitCode = this.exitCode ?? -1;
  }

  /** 获取 PID */
  getPid(): number | undefined {
    return this.pty?.pid;
  }

  /** 调整终端大小 */
  resize(cols: number, rows: number): void {
    this.pty?.resize(cols, rows);
  }
}
