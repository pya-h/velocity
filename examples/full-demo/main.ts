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

import * as fs from 'fs';
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
  // Serve the API tester UI at /
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');
  const server = (velo as any).server as import('http').Server;
  const originalListeners = server.listeners('request').slice();
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    // CORS headers for API tester
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    // Delegate to Velocity
    for (const listener of originalListeners) (listener as any)(req, res);
  });

  // Start the server (processes registrations, initializes DB, begins listening)
  await velo.listen();

  // Seed sample data after DB is ready
  await db.User.create({ name: 'John Doe', email: 'john@example.com', age: 30, createdAt: new Date().toISOString() });
  await db.User.create({ name: 'Jane Smith', email: 'jane@example.com', age: 25, createdAt: new Date().toISOString() });
  await db.Post.create({ title: 'Hello World', content: 'First post!', author: 'John Doe', createdAt: new Date().toISOString() });

  console.log('Seeded sample data: 2 users, 1 post');
}

main().catch(console.error);
