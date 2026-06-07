import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { getDb } from '../db';

beforeEach(() => {
  getDb().prepare('DELETE FROM users').run();
});

afterAll(() => {
  getDb().close();
});

describe('用户接口', () => {
  it('GET /users — 初始状态返回空数组', async () => {
    const response = await request(app).get('/users');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('POST /users — 创建用户成功', async () => {
    const response = await request(app)
      .post('/users')
      .send({ name: '张三', email: 'zhangsan@example.com' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: '张三',
      email: 'zhangsan@example.com',
    });
    expect(typeof response.body.id).toBe('number');
    expect(response.body.created_at).toBeDefined();
  });

  it('GET /users/:id — 查询用户及 404', async () => {
    // 先创建一个用户
    const createRes = await request(app)
      .post('/users')
      .send({ name: '李四', email: 'lisi@example.com' });

    const { id } = createRes.body;

    // 查询存在的用户
    const getRes = await request(app).get(`/users/${id}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id,
      name: '李四',
      email: 'lisi@example.com',
    });

    // 查询不存在的用户
    const notFoundRes = await request(app).get('/users/9999');

    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body).toEqual({ error: 'User not found' });
  });
});
