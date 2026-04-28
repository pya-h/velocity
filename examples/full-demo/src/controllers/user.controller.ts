import {
  Controller, Get, Post as HttpPost, Delete,
  Guards, Interceptors,
  Validate, Validator,
  TransformInterceptor,
  Status, StatusCode,
  Fn,
} from '@velocity/framework';
import type { VelocityRequest, VelocityResponse, GuardFunction } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';
import * as Joi from 'joi';

const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

// ── Typed DTOs ──────────────────────────────────────────────────────────────

interface CreateUserBody {
  name: string;
  email: string;
  age?: number;
}

interface UserParams {
  id: string;
}

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120).optional()
});

@Controller('/users')
class UserController {
  // ── @Status(200) + typed query — no res needed ────────────────────────────
  @Get('/')
  @Status(StatusCode.OK)
  @Interceptors(TransformInterceptor)
  async list(query: Record<string, string>, res: VelocityResponse): Promise<{ users: unknown[] }> {
    res.setCookie('last-visit', new Date().toISOString(), {
      httpOnly: true, path: '/', maxAge: 86400,
    });
    const users = await db.User.findAll();
    return { users };
  }

  // ── Typed param — return directly ─────────────────────────────────────────
  @Get('/:id')
  async getById(param: UserParams, res: VelocityResponse): Promise<{ user: unknown } | void> {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(StatusCode.NotFound).json({ error: 'User not found' });
    return { user };
  }

  // ── @Status(201) + typed body — res only for error paths ──────────────────
  @HttpPost('/')
  @Guards(authGuard)
  @Validate(createUserSchema)
  @Status(StatusCode.Created)
  async create(body: CreateUserBody): Promise<{ user: unknown }> {
    const user = await db.User.create({
      ...body,
      createdAt: new Date().toISOString()
    });
    return { user };
  }

  // ── Classic req + res (backward compat) ───────────────────────────────────
  @Delete('/:id')
  @Guards(authGuard)
  async remove(req: VelocityRequest, res: VelocityResponse): Promise<void> {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) { res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' }); return; }

    const user = await db.User.findById(id);
    if (!user) { res.status(StatusCode.NotFound).json({ error: 'User not found' }); return; }

    await db.User.delete(id);
    res.status(StatusCode.NoContent).send('');
  }

  // ── HTTP Functions (/. namespace) ─────────────────────────────────────────
  @Fn()
  async findUser(id: number): Promise<unknown> {
    const user = await db.User.findById(id);
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }

  @Fn()
  async countUsers(): Promise<number> {
    const users = await db.User.findAll();
    return users.length;
  }

  @Fn()
  async greet(name: string, formal: boolean): Promise<{ message: string }> {
    return { message: formal ? `Good day, ${name}.` : `Hey ${name}!` };
  }
}

velo.register(UserController);
