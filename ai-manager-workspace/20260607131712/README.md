# Node.js 示例工具集

两个可独立运行的 Node.js 脚本：一个输出 Hello World，一个命令行计算器。

## 功能特性

- **hello.js** — 输出 Hello World，作为最简示例
- **calc.js** — 命令行四则运算计算器，支持加减乘除，带除零检查和未知运算报错

## 安装

无第三方依赖，仅需 Node.js（v12+，支持 ES Module）。

```bash
# 确认 Node.js 已安装
node -v
```

## 使用方法

### Hello World

```bash
node hello.js
# 输出: Hello World
```

### 计算器

```bash
node calc.js <运算> <数字1> <数字2>
```

**示例：**

```bash
node calc.js add 3 5        # Result: 8
node calc.js subtract 10 4  # Result: 6
node calc.js multiply 6 7   # Result: 42
node calc.js divide 20 4    # Result: 5
node calc.js divide 1 0     # Error: Division by zero（退出码 1）
node calc.js pow 2 3        # Error: Unknown operation "pow"（退出码 1）
```

## 项目结构

```
├── hello.js   # Hello World 示例脚本
└── calc.js    # 四则运算命令行计算器（add / subtract / multiply / divide）
```