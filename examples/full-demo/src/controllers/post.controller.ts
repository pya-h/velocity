import {
  Controller,
  Get,
  Post as HttpPost,
  Delete,
  UseMiddleware,
  UseInterceptor,
  Validate,
  Validator,
} from "@velocity/framework";
import type { VelocityRequest, VelocityResponse, MiddlewareFunction } from "@velocity/framework";
import { pgDb } from "../../pgDb";
import { velo } from "../../velo";
import * as Joi from "joi";

const authMiddleware: MiddlewareFunction = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }
  next();
};

const timingInterceptor = (data: any, req: VelocityRequest, _res: VelocityResponse) => {
  return {
    ...data,
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
  @Get("/")
  @UseInterceptor(timingInterceptor)
  async list(_req: VelocityRequest, _res: VelocityResponse) {
    const posts = await pgDb.Post.findAll();
    return { posts };
  }

  @Get("/:id")
  async getById(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const post = await pgDb.Post.findById(id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    return { post };
  }

  @HttpPost("/")
  @UseMiddleware(authMiddleware)
  @Validate(createPostSchema)
  async create(req: VelocityRequest, res: VelocityResponse) {
    const post = await pgDb.Post.create({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    return res.status(201).json({ post });
  }

  @Delete("/:id")
  @UseMiddleware(authMiddleware)
  async remove(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const post = await pgDb.Post.findById(id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    await pgDb.Post.delete(id);
    return res.status(204).send("");
  }
}

velo.register(PostController);
