/**
 * Velocity Framework — Full Demo
 *
 * Entry point. Imports self-registering modules, seeds data, and starts the server.
 *
 * Run:  npm run demo
 *
 * Databases:
 *   SQLite    (db)    — users
 *   PostgreSQL (pgDb) — posts, job_records
 *
 * REST endpoints:
 *   curl localhost:5000/api/health
 *
 *   curl localhost:5000/api/users
 *   curl -X POST localhost:5000/api/users \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer demo" \
 *        -d '{"name":"Alice","email":"alice@example.com","age":28}'
 *
 *   curl localhost:5000/api/posts
 *   curl -X POST localhost:5000/api/posts \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer demo" \
 *        -d '{"title":"Hello","content":"World","author":"Alice"}'
 *
 *   # Submit jobs (status persisted to PostgreSQL via connection pool)
 *   curl -X POST localhost:5000/api/jobs \
 *        -H "Content-Type: application/json" \
 *        -d '{"task":"send-email","to":"alice@example.com"}'
 *   curl localhost:5000/api/jobs           # all jobs (any status)
 *   curl localhost:5000/api/jobs/results   # completed jobs only
 *   curl localhost:5000/api/jobs/1         # specific job by ID
 *
 * HTTP Functions (@Fn — /.name(args) syntax):
 *   curl 'localhost:5000/.findUser(1)'
 *   curl 'localhost:5000/.countUsers()'
 *   curl 'localhost:5000/.greet("Alice",true)'
 *   curl 'localhost:5000/.greet(Bob,false)'
 */

import * as path from 'path';
import { velo } from './velo';
import './db';
import './pgDb';

// Entities self-register on their respective databases when imported
import './src/entities/user.entity';
import './src/entities/post.entity';
import './src/entities/job-record.entity';

// Services self-register on velo when imported
import './src/services/user.service';
import './src/services/job.service';

// Controllers self-register on velo when imported
import './src/controllers/health.controller';
import './src/controllers/user.controller';
import './src/controllers/post.controller';
import './src/controllers/job.controller';

async function main() {
  velo.serve('/apitester', path.join(__dirname, 'velo/apitester.html'));

  await velo.listen();
}

main().catch(console.error);
