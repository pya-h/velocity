import {
  Controller, Get, Post as HttpPost, Delete,
  Guards, Interceptors,
  Validate, Validator,
  TransformInterceptor,
  Status, StatusCode,
  ResponseFrame, Frame,
  Fn,
} from '@velocity/framework';
import type { VeloRequest, VeloResponse } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';
import { authGuard, type SessionUser } from '../guards/auth.guard';
import * as Joi from 'joi';

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

// Controller-level frame override — different from the global frame in velo.ts.
// Extracts 'message' from handler responses into a top-level field.
//
// Response shape:
//   { code: 200, result: <data without message>, error: null, message: "extracted" }
@ResponseFrame({
  code:    Frame.Status,
  result:  Frame.Data,
  error:   Frame.Error,
  message: Frame.Extract('message', true), // optional — null if handler doesn't return it
})
@Controller('/users')
class UserController {
  // ── Public: list all users ─────────────────────────────────────────────────
  @Get('/')
  @Status(StatusCode.OK)
  @Interceptors(TransformInterceptor)
  async list(query: Record<string, string>, res: VeloResponse): Promise<{ users: unknown[] }> {
    res.setCookie('last-visit', new Date().toISOString(), {
      httpOnly: true, path: '/', maxAge: 86400,
    });
    const users = await db.User.findAll();
    return { users };
  }

  // ── Public: get single user ────────────────────────────────────────────────
  @Get('/:id')
  async getById(param: UserParams, res: VeloResponse): Promise<{ user: unknown } | void> {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(StatusCode.NotFound).json({ error: 'User not found' });
    return { user };
  }

  // ── Protected: create user (cookie auth + validation) ──────────────────────
  //    `user` param is the authenticated SessionUser from the cookie guard.
  @HttpPost('/')
  @Guards(authGuard)
  @Validate(createUserSchema)
  @Status(StatusCode.Created)
  async create(body: CreateUserBody, user: SessionUser): Promise<{ user: unknown; message: string }> {
    const created = await db.User.create({
      ...body,
      createdAt: new Date().toISOString()
    });
    return { user: created, message: `User created by ${user.username}` };
  }

  // ── Protected: delete user (cookie auth, classic req+res style) ────────────
  @Delete('/:id')
  @Guards(authGuard)
  async remove(req: VeloRequest, res: VeloResponse): Promise<void> {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) { res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' }); return; }

    const found = await db.User.findById(id);
    if (!found) { res.status(StatusCode.NotFound).json({ error: 'User not found' }); return; }

    await db.User.delete(id);
    res.status(StatusCode.NoContent).send('');
  }

  // ── HTTP Functions (public — @Fn bypasses ResponseFrame) ───────────────────
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
