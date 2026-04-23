/**
 * Velocity Framework — Full Demo
 *
 * Entry point. Imports self-registering modules, seeds data, and starts the server.
 *
 * Run:  npm run demo
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

import * as path from 'path';
import { velo } from './velo';
import { db } from './db';

// Entities self-register on db when imported
import './src/entities/user.entity';
import './src/entities/post.entity';

// Services self-register on velo when imported
import './src/services/user.service';

// Controllers self-register on velo when imported
import './src/controllers/health.controller';
import './src/controllers/user.controller';
import './src/controllers/post.controller';

async function main() {
  velo.serve('/apitester', path.join(__dirname, 'velo/apitester.html'));

  await velo.listen();
}

main().catch(console.error);
