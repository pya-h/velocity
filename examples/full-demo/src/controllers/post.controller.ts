import {
  Controller, Get, Post as HttpPost, Delete,
  Guards, Interceptors,
  Validate, Validator,
  Status, StatusCode,
} from '@velocity/framework';
import type { VeloRequest, VeloResponse } from '@velocity/framework';
import { pgDb } from '../../pgDb';
import { velo } from '../../velo';
import { authGuard, type SessionUser } from '../guards/auth.guard';
import * as Joi from 'joi';

interface CreatePostBody {
  title: string;
  content: string;
}

interface PostParams {
  id: string;
}

const timingInterceptor = (data: unknown, req: VeloRequest): unknown => {
  return {
    ...(data as Record<string, unknown>),
    _timing: { servedAt: new Date().toISOString(), path: req.url },
  };
};

const createPostSchema = Validator.createSchema({
  title: Joi.string().required(),
  content: Joi.string().required(),
});

@Controller('/posts')
class PostController {
  // ── Public: list all posts ─────────────────────────────────────────────────
  @Get('/')
  @Interceptors(timingInterceptor)
  async list(): Promise<{ posts: unknown[] }> {
    const posts = await pgDb.Post.findAll();
    return { posts };
  }

  // ── Public: get single post ────────────────────────────────────────────────
  @Get('/:id')
  async getById(param: PostParams, res: VeloResponse): Promise<{ post: unknown } | void> {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' });

    const post = await pgDb.Post.findById(id);
    if (!post) return res.status(StatusCode.NotFound).json({ error: 'Post not found' });
    return { post };
  }

  // ── Protected: create post (cookie auth) ───────────────────────────────────
  //    `user` is the authenticated SessionUser — author is set automatically.
  @HttpPost('/')
  @Guards(authGuard)
  @Validate(createPostSchema)
  @Status(StatusCode.Created)
  async create(body: CreatePostBody, user: SessionUser): Promise<{ post: unknown }> {
    const post = await pgDb.Post.create({
      ...body,
      author: user.username,
      createdAt: new Date().toISOString(),
    });
    return { post };
  }

  // ── Protected: delete post (cookie auth) ───────────────────────────────────
  @Delete('/:id')
  @Guards(authGuard)
  async remove(param: PostParams, res: VeloResponse): Promise<void> {
    const id = parseInt(param.id);
    if (isNaN(id)) { res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' }); return; }

    const post = await pgDb.Post.findById(id);
    if (!post) { res.status(StatusCode.NotFound).json({ error: 'Post not found' }); return; }

    await pgDb.Post.delete(id);
    res.status(StatusCode.NoContent).send('');
  }
}

velo.register(PostController);
