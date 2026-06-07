import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { ProjectContext } from '../models/project-context.js';
import { logger } from '../utils/logger.js';

/**
 * 项目扫描器
 *
 * 从 orchestrator.ts 和 quality-reviewer.ts 提取的统一扫描逻辑。
 * 在 "modify" 模式下扫描已有项目的目录树、源码、配置等信息，
 * 生成结构化的 ProjectContext 供所有 LLM 调用使用。
 */
export class ProjectScanner {
  /** 排除的目录名 */
  private static readonly SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', '.aimanager', '__pycache__',
    'target', 'build', '.next', '.nuxt', 'coverage', '.cache',
  ]);

  /** 源代码扩展名 */
  private static readonly SOURCE_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.java', '.kt', '.swift',
    '.html', '.css', '.scss', '.vue', '.svelte',
  ]);

  /** 配置文件名 */
  private static readonly CONFIG_NAMES = [
    'tsconfig.json', 'jsconfig.json',
    'pyproject.toml', 'setup.py', 'requirements.txt',
    'Cargo.toml', 'go.mod',
    'next.config.js', 'next.config.ts', 'next.config.mjs',
    'vite.config.ts', 'vite.config.js',
    'webpack.config.js', 'webpack.config.ts',
    'package.json',
  ];

  /**
   * 扫描项目，生成 ProjectContext
   *
   * mode='new'  时返回空上下文（所有字段占位）
   * mode='modify' 时执行完整扫描
   */
  static scan(workingDir: string, mode: 'new' | 'modify'): ProjectContext {
    if (mode === 'new') {
      return {
        mode: 'new',
        fileTree: '(新项目)',
        packageInfo: '(新项目)',
        configFiles: '(新项目)',
        sourceFiles: '(新项目)',
        sourceSignatures: '(新项目)',
        existingReadme: '(新项目)',
      };
    }

    logger.info(`扫描已有项目: ${workingDir}`);

    return {
      mode: 'modify',
      fileTree: ProjectScanner.scanFileTree(workingDir, 4),
      packageInfo: ProjectScanner.scanPackageJson(workingDir),
      configFiles: ProjectScanner.scanConfigFiles(workingDir),
      sourceFiles: ProjectScanner.scanSourceFiles(workingDir),
      sourceSignatures: ProjectScanner.scanSourceSignatures(workingDir),
      existingReadme: ProjectScanner.scanExistingReadme(workingDir),
    };
  }

  // ─── 目录树 ────────────────────────────────────────────

  /**
   * 获取目录树字符串
   */
  static scanFileTree(dir: string, maxDepth = 4, prefix = ''): string {
    if (maxDepth <= 0 || !existsSync(dir)) return '';

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && !ProjectScanner.SKIP_DIRS.has(e.name))
        .slice(0, 40);

      let result = '';
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const suffix = entry.isDirectory() ? '/' : '';
        const sizeTag = entry.isFile()
          ? ProjectScanner.formatSize(fullPath)
          : '';
        result += `${prefix}${entry.name}${suffix}${sizeTag}\n`;
        if (entry.isDirectory()) {
          result += ProjectScanner.scanFileTree(fullPath, maxDepth - 1, prefix + '  ');
        }
      }
      return result;
    } catch {
      return '';
    }
  }

  // ─── package.json ──────────────────────────────────────

  /**
   * 读取 package.json 关键字段
   */
  static scanPackageJson(workingDir: string): string {
    const pkgPath = join(workingDir, 'package.json');
    if (!existsSync(pkgPath)) return '(无 package.json)';

    try {
      const raw = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      const filtered = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        scripts: pkg.scripts,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        bin: pkg.bin,
        main: pkg.main,
        type: pkg.type,
      };
      return JSON.stringify(filtered, null, 2);
    } catch {
      return '(无法解析 package.json)';
    }
  }

  // ─── 配置文件 ──────────────────────────────────────────

  /**
   * 读取项目配置文件（tsconfig, pyproject 等）
   */
  static scanConfigFiles(workingDir: string): string {
    let result = '';

    for (const name of ProjectScanner.CONFIG_NAMES) {
      const path = join(workingDir, name);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8');
          result += `\n### ${name}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\`\n`;
        } catch { /* 忽略 */ }
      }
    }

    return result || '(无配置文件)';
  }

  // ─── 源代码文件 ────────────────────────────────────────

  /**
   * 读取关键源代码文件内容
   */
  static scanSourceFiles(workingDir: string, maxDepth = 3, maxFileSize = 3000): string {
    let result = '';

    const walk = (dir: string, depth: number) => {
      if (depth <= 0 || !existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith('.') && !ProjectScanner.SKIP_DIRS.has(e.name));

        // 优先读入口文件
        const sorted = entries.sort((a, b) => {
          const prio = (name: string) =>
            name.startsWith('index.') || name.startsWith('main.') || name.startsWith('app.') ? 0 : 1;
          return prio(a.name) - prio(b.name);
        });

        for (const entry of sorted) {
          const fullPath = join(dir, entry.name);
          if (entry.isFile() && ProjectScanner.SOURCE_EXTENSIONS.has(extname(entry.name))) {
            try {
              const stat = statSync(fullPath);
              if (stat.size > maxFileSize * 2) {
                // 太大的文件只显示前几行
                const content = readFileSync(fullPath, 'utf-8');
                const head = content.split('\n').slice(0, 30).join('\n');
                result += `\n### ${ProjectScanner.relativePath(workingDir, fullPath)}\n\`\`\`\n${head}\n// ... (truncated, ${stat.size} bytes)\n\`\`\`\n`;
              } else if (stat.size <= maxFileSize) {
                const content = readFileSync(fullPath, 'utf-8');
                result += `\n### ${ProjectScanner.relativePath(workingDir, fullPath)}\n\`\`\`\n${content}\n\`\`\`\n`;
              }
            } catch { /* 忽略 */ }
          } else if (entry.isDirectory()) {
            walk(fullPath, depth - 1);
          }
        }
      } catch { /* 忽略 */ }
    };

    walk(workingDir, maxDepth);
    return result || '(无源代码文件)';
  }

  // ─── 已有 README ───────────────────────────────────────

  /**
   * 读取已有 README 前 500 字
   */
  static scanExistingReadme(workingDir: string): string {
    for (const name of ['README.md', 'README.txt', 'readme.md']) {
      const path = join(workingDir, name);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8');
          if (content.length > 500) {
            return content.slice(0, 500) + '\n\n... (已截断)';
          }
          return content;
        } catch { /* 忽略 */ }
      }
    }
    return '(无 README)';
  }

  // ─── 上下文渲染 ────────────────────────────────────────

  /**
   * 将 ProjectContext 渲染为 LLM 可用的上下文字符串
   * modify 模式下返回项目结构 + 关键源文件，new 模式下返回空串
   * 渲染一次后可缓存复用，避免每次 LLM 调用重复拼接
   */
  static renderContextBlock(projectContext?: ProjectContext): string {
    if (!projectContext || projectContext.mode !== 'modify') {
      return '';
    }

    return [
      '',
      '## 现有项目上下文（修改已有项目）',
      '',
      '### 项目结构',
      '```',
      projectContext.fileTree,
      '```',
      '',
      '### 关键源文件',
      projectContext.sourceFiles,
    ].join('\n');
  }

  /**
   * 紧凑版上下文渲染（使用签名替代完整源码）
   * 比 renderContextBlock 节省约 80% token
   */
  static renderCompactContextBlock(projectContext?: ProjectContext): string {
    if (!projectContext || projectContext.mode !== 'modify') {
      return '';
    }

    return [
      '',
      '## Project context (modify mode)',
      '',
      '### Structure',
      '```',
      projectContext.fileTree,
      '```',
      '',
      '### API signatures',
      projectContext.sourceSignatures,
      '',
      '### package.json',
      projectContext.packageInfo,
    ].join('\n');
  }

  // ─── 源码签名扫描 ────────────────────────────────────────

  /** 签名行模式：匹配这些模式的行保留，其余丢弃 */
  private static readonly SIGNATURE_PATTERNS: RegExp[] = [
    /^\s*export\s/,                               // export 语句
    /^\s*(async\s+)?function\s+\w+/,              // function 声明
    /^\s*(class|interface|type|enum)\s+\w+/,       // 类型声明
    /^\s*import\s/,                                // import 语句
    /^\s*(const|let|var)\s+\w+\s*(:|=>|=)/,        // 顶层变量声明（带类型或赋值）
    /^\s*\/\//,                                    // 注释行（保留文档注释）
    /^\s*\*/,                                      // JSDoc 块注释行
    /^\s*\/\*\*/,                                  // JSDoc 开始
    /^\s*\*\//,                                    // JSDoc 结束
  ];

  /**
   * 扫描源文件签名（仅保留 export/function/class/import 声明行）
   * 用于紧凑上下文渲染，替代完整源码
   */
  static scanSourceSignatures(workingDir: string, maxDepth = 3): string {
    let result = '';

    const walk = (dir: string, depth: number) => {
      if (depth <= 0 || !existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith('.') && !ProjectScanner.SKIP_DIRS.has(e.name));

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isFile() && ProjectScanner.SOURCE_EXTENSIONS.has(extname(entry.name))) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              const sigLines: string[] = [];

              for (const line of lines) {
                if (ProjectScanner.SIGNATURE_PATTERNS.some(p => p.test(line))) {
                  sigLines.push(line);
                }
              }

              if (sigLines.length > 0) {
                const relPath = ProjectScanner.relativePath(workingDir, fullPath);
                result += `\n### ${relPath}\n\`\`\`\n${sigLines.join('\n')}\n\`\`\`\n`;
              }
            } catch { /* 忽略 */ }
          } else if (entry.isDirectory()) {
            walk(fullPath, depth - 1);
          }
        }
      } catch { /* 忽略 */ }
    };

    walk(workingDir, maxDepth);
    return result || '(no source files)';
  }

  // ─── 辅助方法 ──────────────────────────────────────────

  private static formatSize(fullPath: string): string {
    try {
      const stat = statSync(fullPath);
      if (stat.size > 1024 * 1024) return '';
      if (stat.size > 1024) return ` (${(stat.size / 1024).toFixed(0)}KB)`;
      return '';
    } catch {
      return '';
    }
  }

  private static relativePath(base: string, fullPath: string): string {
    if (fullPath.startsWith(base)) {
      return fullPath.slice(base.length).replace(/^[\\/]/, '');
    }
    return fullPath;
  }
}
