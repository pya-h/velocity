import { Controller, Get, Post as PostMethod, Put, Delete } from '../../../src';
import { VelocityRequest, VelocityResponse } from '../../../src/types';
import { BaseRepository } from '../../../src/orm/repository';
import { Post } from '../models/post.model';

@Controller('/api/posts')
export class PostController {
  constructor(private postRepository: BaseRepository<Post>) {}

  @Get('/')
  async getAllPosts(req: VelocityRequest, res: VelocityResponse) {
    const posts = await this.postRepository.find();
    return { posts };
  }

  @Get('/:id')
  async getPostById(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const post = await this.postRepository.findById(id);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    return { post };
  }

  @PostMethod('/')
  async createPost(req: VelocityRequest, res: VelocityResponse) {
    const { title, content, author } = req.body;

    if (!title || !content || !author) {
      return res.status(400).json({ 
        error: 'Missing required fields: title, content, author' 
      });
    }

    const postData = {
      title,
      content,
      author,
      createdAt: new Date()
    };

    const result = await this.postRepository.create(postData);
    
    // Fetch the created post
    const post = await this.postRepository.findById(result.lastInsertRowid || result.insertId);
    
    return res.status(201).json({ post });
  }

  @Put('/:id')
  async updatePost(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const { title, content, author, publishedAt } = req.body;
    const updateData: any = {};

    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (author) updateData.author = author;
    if (publishedAt !== undefined) updateData.publishedAt = publishedAt ? new Date(publishedAt) : null;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await this.postRepository.update(id, updateData);
    const post = await this.postRepository.findById(id);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    return { post };
  }

  @Delete('/:id')
  async deletePost(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    const post = await this.postRepository.findById(id);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await this.postRepository.delete(id);
    
    return res.status(204).send('');
  }

  @Get('/author/:author')
  async getPostsByAuthor(req: VelocityRequest, res: VelocityResponse) {
    const author = req.params!.author;
    const posts = await this.postRepository.findWhere({ author } as Partial<Post>);
    return { posts, author };
  }

  @Get('/published')
  async getPublishedPosts(req: VelocityRequest, res: VelocityResponse) {
    const posts = await this.postRepository
      .createQueryBuilder()
      .select('*')
      .where('publishedAt IS NOT NULL')
      .orderBy('publishedAt', 'DESC')
      .execute();
    
    return { posts };
  }
}
