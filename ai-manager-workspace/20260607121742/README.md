# Node.js HTTP 服务器

一个使用 Node.js 原生 `http` 模块构建的轻量级 HTTP 服务器，监听 3000 端口。

## 功能特性

- 使用 Node.js 原生 `http` 模块，零依赖
- 访问根路径 `/` 返回 `hello world`
- 未匹配路径返回 404

## 安装步骤

无需安装任何依赖，仅需 Node.js >= 18（支持 `node:` 协议前缀）。

```bash
node -v  # 确认版本 >= 18
```

## 使用方法

启动服务器：

```bash
node server.js
```

输出：

```
Server is listening on port 3000
```

访问测试：

```bash
curl http://localhost:3000/
# hello world

curl http://localhost:3000/other
# Not Found
```

## 项目结构

```
server.js   # 服务器入口，创建 HTTP 服务并监听 3000 端口
```