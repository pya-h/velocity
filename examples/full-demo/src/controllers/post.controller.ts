import {
  Controller, Get, Post as HttpPost, Delete,
  Guards, Interceptors,
  Validate, Validator,
  Status, StatusCode,
} from "@velocity/framework";
import type { VelocityRequest, VelocityResponse, GuardFunction } from "@velocity/framework";
import { pgDb } from "../../pgDb";
import { velo } from "../../velo";
import * as Joi from "joi";

const authGuard: GuardFunction = (req) => !!req.headers["authorization"];

interface CreatePostBody {
  title: string;
  content: string;
  author: string;
}

interface PostParams {
  id: string;
}

const timingInterceptor = (data: unknown, req: VelocityRequest): unknown => {
  return {
    ...(data as Record<string, unknown>),
    _timing: { servedAt: new Date().toISOString(), path: req.url },
  };
};

const createPostSchema = Validator.createSchema({
  title: Joi.string().required(),
  content: Joi.string().required(),
  author: Joi.string().required(),
});

@Controller("/posts")
class PostController {
  // ── No params, return directly ────────────────────────────────────────────
  @Get("/")
  @Interceptors(timingInterceptor)
  async list(): Promise<{ posts: unknown[] }> {
    const posts = await pgDb.Post.findAll();
    return { posts };
  }

  // ── Typed param ───────────────────────────────────────────────────────────
  @Get("/:id")
  async getById(param: PostParams, res: VelocityResponse): Promise<{ post: unknown } | void> {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(StatusCode.BadRequest).json({ error: "Invalid ID" });

    const post = await pgDb.Post.findById(id);
    if (!post) return res.status(StatusCode.NotFound).json({ error: "Post not found" });
    return { post };
  }

  // ── @Status(201) + typed body ─────────────────────────────────────────────
  @HttpPost("/")
  @Guards(authGuard)
  @Validate(createPostSchema)
  @Status(StatusCode.Created)
  async create(body: CreatePostBody): Promise<{ post: unknown }> {
    const post = await pgDb.Post.create({
      ...body,
      createdAt: new Date().toISOString(),
    });
    return { post };
  }

  // ── Typed param + res ─────────────────────────────────────────────────────
  @Delete("/:id")
  @Guards(authGuard)
  async remove(param: PostParams, res: VelocityResponse): Promise<void> {
    const id = parseInt(param.id);
    if (isNaN(id)) { res.status(StatusCode.BadRequest).json({ error: "Invalid ID" }); return; }

    const post = await pgDb.Post.findById(id);
    if (!post) { res.status(StatusCode.NotFound).json({ error: "Post not found" }); return; }

    await pgDb.Post.delete(id);
    res.status(StatusCode.NoContent).send("");
  }
}

velo.register(PostController);
