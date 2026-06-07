# Users REST API

基于 Express 5 + TypeScript + SQLite 的用户管理 REST API 服务。

## 功能特性

- **用户列表** — `GET /users` 返回全部用户
- **创建用户** — `POST /users` 接收 `name` 和 `email`，自动生成 id 和创建时间
- **查询用户** — `GET /users/:id` 根据 id 获取单个用户，不存在返回 404
- **参数校验** — 缺少 name 或 email 返回 400 错误
- **email 唯一** — 数据库层面保证 email 不重复
- **自动建表** — 首次启动自动创建 SQLite 数据库和 users 表

## 安装

```bash
npm install
```

依赖说明：
- `express` ^5.2.1 — HTTP 框架
- `better-sqlite3` ^12.10.0 — SQLite 驱动
- `ts-node` ^10.9.2 — 直接运行 TypeScript
- `typescript` ^6.0.3 — 编译器
- `vitest` ^4.1.8 + `supertest` ^7.2.2 — 集成测试

## 使用方法

### 启动服务

```bash
npm start
# 默认端口 3000，也可通过环境变量指定：
PORT=8080 npm start
```

### API 调用示例

```bash
# 创建用户
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "张三", "email": "zhangsan@example.com"}'

# 获取用户列表
curl http://localhost:3000/users

# 根据 id 查询用户
curl http://localhost:3000/users/1
```

### 运行测试

```bash
npm test
```

包含 3 个集成测试：空列表查询、创建用户、单用户查询及 404。

## 项目结构

```
src/
  index.ts              # 入口，启动 Express 服务
  app.ts                # Express 应用实例及中间件配置
  db.ts                 # SQLite 数据库连接及建表
  routes/
    userRoutes.ts       # 用户路由（GET/POST/GET :id）
  __tests__/
    users.test.ts       # 集成测试
data/
  users.db              # SQLite 数据库文件（运行后自动生成）
tsconfig.json           # TypeScript 编译配置
```