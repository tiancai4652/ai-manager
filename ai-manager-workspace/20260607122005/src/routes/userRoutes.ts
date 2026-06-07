import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// GET /users — 返回全部用户列表
router.get('/users', async (_req: Request, res: Response) => {
  const db = getDb();
  const users = db.prepare('SELECT * FROM users').all();
  res.json(users);
});

// POST /users — 创建用户
router.post('/users', async (req: Request, res: Response) => {
  const { name, email } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: 'name and email are required' });
    return;
  }

  const db = getDb();
  const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
  const result = stmt.run(name, email);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

// GET /users/:id — 根据 id 查询单个用户
router.get('/users/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

export default router;
