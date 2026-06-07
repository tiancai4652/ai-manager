/**
 * 项目上下文
 *
 * 在 "modify" 模式下，AI Manager 会扫描已有项目，将结构、源码、配置等信息
 * 打包为 ProjectContext，注入所有 LLM 调用，使大脑能精准地在现有代码上做修改。
 */
export interface ProjectContext {
  /** 当前模式：新建 / 修改已有项目 */
  mode: 'new' | 'modify';
  /** 目录树字符串 */
  fileTree: string;
  /** package.json 关键字段（如有） */
  packageInfo: string;
  /** 配置文件内容（tsconfig, pyproject 等） */
  configFiles: string;
  /** 关键源代码文件内容 */
  sourceFiles: string;
  /** 源代码签名（仅 export/import/class/function 声明行） */
  sourceSignatures: string;
  /** 已有 README 摘要（如有） */
  existingReadme: string;
}
