/**
 * Velocity Framework — Full Demo
 *
 * Entry point. Imports self-registering modules, seeds data, and starts the server.
 *
 * Run:  npx ts-node examples/full-demo/main.ts
 *
 * Try:
 *   curl localhost:5000/api/health
 *   curl localhost:5000/api/users
 *   curl -X POST localhost:5000/api/users \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer demo" \
 *        -d '{"name":"Alice","email":"alice@example.com","age":28}'
 *   curl localhost:5000/api/posts
 */

import { velo } from './velo';
import { db } from './db';

// Entities self-register on db when imported
import './entities/user.entity';
import './entities/post.entity';

// Services self-register on velo when imported
import './services/user.service';

// Controllers self-register on velo when imported
import './controllers/health.controller';
import './controllers/user.controller';
import './controllers/post.controller';

async function main() {
  // Start the server (processes registrations, initializes DB, begins listening)
  await velo.listen();

  // Seed sample data after DB is ready
  await db.User.create({ name: 'John Doe', email: 'john@example.com', age: 30, createdAt: new Date().toISOString() });
  await db.User.create({ name: 'Jane Smith', email: 'jane@example.com', age: 25, createdAt: new Date().toISOString() });
  await db.Post.create({ title: 'Hello World', content: 'First post!', author: 'John Doe', createdAt: new Date().toISOString() });

  console.log('Seeded sample data: 2 users, 1 post');
}

main().catch(console.error);
