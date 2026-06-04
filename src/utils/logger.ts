import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  debug(msg: string, ...args: unknown[]) {
    if (currentLevel <= LogLevel.DEBUG) {
      console.log(chalk.gray(`[${timestamp()}] DEBUG`), msg, ...args);
    }
  },
  info(msg: string, ...args: unknown[]) {
    if (currentLevel <= LogLevel.INFO) {
      console.log(chalk.blue(`[${timestamp()}] INFO`), msg, ...args);
    }
  },
  warn(msg: string, ...args: unknown[]) {
    if (currentLevel <= LogLevel.WARN) {
      console.log(chalk.yellow(`[${timestamp()}] WARN`), msg, ...args);
    }
  },
  error(msg: string, ...args: unknown[]) {
    if (currentLevel <= LogLevel.ERROR) {
      console.log(chalk.red(`[${timestamp()}] ERROR`), msg, ...args);
    }
  },
  /** 终端输出（不附带前缀，直接显示） */
  raw(msg: string) {
    console.log(msg);
  },
};
