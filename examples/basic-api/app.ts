import { VelocityApplication } from '../../src';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';

async function bootstrap() {
  const app = new VelocityApplication({
    port: 5000,
    host: '0.0.0.0',
    database: {
      type: 'sqlite',
      database: 'example.db',
      filename: 'example.db'
    },
    logger: {
      level: 'info',
      format: 'combined',
      outputs: ['console']
    }
  });

  // Register services
  app.getContainer().register('userService', UserService);

  // Register controllers
  app.registerController(UserController);

  await app.listen();
}

bootstrap().catch(console.error);
