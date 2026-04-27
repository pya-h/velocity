import {
  Controller, Get, Post as HttpPost, Delete,
  Guards, Interceptors,
  Validate, Validator,
  TransformInterceptor,
  Fn,
} from '@velocity/framework';
import type { VelocityRequest, VelocityResponse, GuardFunction } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';
import * as Joi from 'joi';

const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120).optional()
});

@Controller('/users')
class UserController {
  // ── Injection style: just `query` ─────────────────────────────────────────
  // Only requests what it needs — no req/res boilerplate.
  // Also sets a cookie via res (listed as second param).
  @Get('/')
  @Interceptors(TransformInterceptor)
  async list(query: Record<string, string>, res: VelocityResponse) {
    res.setCookie('last-visit', new Date().toISOString(), {
      httpOnly: true, path: '/', maxAge: 86400,
    });
    const users = await db.User.findAll();
    return { users, query };
  }

  // ── Injection style: just `param` ─────────────────────────────────────────
  @Get('/:id')
  async getById(param: Record<string, string>, res: VelocityResponse) {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return { user };
  }

  // ── Injection style: `body` + `res` ───────────────────────────────────────
  // Body is auto-validated via @Validate schema. Handler receives validated body directly.
  @HttpPost('/')
  @Guards(authGuard)
  @Validate(createUserSchema)
  async create(body: any, res: VelocityResponse) {
    const user = await db.User.create({
      ...body,
      createdAt: new Date().toISOString()
    });
    return res.status(201).json({ user });
  }

  // ── Injection style: classic `req` + `res` (backward compat) ──────────────
  @Delete('/:id')
  @Guards(authGuard)
  async remove(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.User.delete(id);
    return res.status(204).send('');
  }

  // ── HTTP Functions (/. namespace) — no injection, uses @Fn arg parsing ────
  @Fn()
  async findUser(id: number) {
    const user = await db.User.findById(id);
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }

  @Fn()
  async countUsers() {
    const users = await db.User.findAll();
    return users.length;
  }

  @Fn()
  async greet(name: string, formal: boolean) {
    return { message: formal ? `Good day, ${name}.` : `Hey ${name}!` };
  }
}

velo.register(UserController);
