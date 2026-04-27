import {
  Controller, Get, Post as HttpPost, Delete,
  UseMiddleware, UseInterceptor,
  Validate, Validator,
  TransformInterceptor,
} from '@velocity/framework';
import type { VelocityRequest, VelocityResponse, MiddlewareFunction } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';
import * as Joi from 'joi';

const authMiddleware: MiddlewareFunction = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }
  req.user = { id: 1, role: 'admin' };
  next();
};

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120).optional()
});

@Controller('/users')
class UserController {
  @Get('/')
  @UseInterceptor(TransformInterceptor)
  async list(_req: VelocityRequest, _res: VelocityResponse) {
    const users = await db.User.findAll();
    return { users };
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
  @UseMiddleware(authMiddleware)
  @Validate(createUserSchema)
  async create(req: VelocityRequest, res: VelocityResponse) {
    const user = await db.User.create({
      ...req.body,
      createdAt: new Date().toISOString()
    });
    return res.status(201).json({ user });
  }

  @Delete('/:id')
  @UseMiddleware(authMiddleware)
  async remove(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const user = await db.User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.User.delete(id);
    return res.status(204).send('');
  }
}

velo.register(UserController);
