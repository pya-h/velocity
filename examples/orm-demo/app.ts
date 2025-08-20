import { VelocityApplication } from '../../src';
import { PostController } from './controllers/post.controller';
import { Post } from './models/post.model';
import { BaseRepository } from '../../src/orm/repository';

async function bootstrap() {
  const app = new VelocityApplication({
    port: 5000,
    host: '0.0.0.0',
    database: {
      type: 'sqlite',
      database: 'posts.db',
      filename: 'posts.db'
    },
    logger: {
      level: 'info',
      format: 'combined',
      outputs: ['console']
    }
  });

  await app.initialize();

  // Create repository and setup table
  const database = app.getContainer().resolve('database') as any;
  const postRepository = new BaseRepository(database, Post);
  await postRepository.createTable();

  // Register repository
  app.getContainer().register('postRepository', postRepository);

  // Register controllers
  app.registerController(PostController);

  await app.listen();
}

bootstrap().catch(console.error);
