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

// Guard: simple boolean check — cleaner than middleware for auth-only checks
const authGuard: GuardFunction = (req) => !!req.headers['authorization'];

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120).optional()
});

@Controller('/users')
class UserController {
  @Get('/')
  @Interceptors(TransformInterceptor)
  async list(req: VelocityRequest, res: VelocityResponse) {
    // Demo: set a cookie tracking the last visit time
    res.setCookie('last-visit', new Date().toISOString(), {
      httpOnly: true,
      path: '/',
      maxAge: 86400,
    });

    const users = await db.User.findAll();
    return { users, cookies: req.cookies };
  }

  @Get('/:id')
  async getById(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return { user };
  }

  @HttpPost('/')
  @Guards(authGuard)
  @Validate(createUserSchema)
  async create(req: VelocityRequest, res: VelocityResponse) {
    const user = await db.User.create({
      ...req.body,
      createdAt: new Date().toISOString()
    });
    return res.status(201).json({ user });
  }

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

  // ── HTTP Functions (/. namespace) ───────────────────────────────────────
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
