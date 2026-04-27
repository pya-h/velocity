/**
 * JobController — REST interface for the @Go + VelocityChannel + PostgreSQL job queue demo.
 *
 * Flow:
 *   POST /api/jobs          → creates a job_record (status: pending) in PostgreSQL,
 *                             sends the job to the @Go worker thread via BroadcastChannel
 *   @Go worker              → processes the job (in a real Bun thread), sends result back
 *   resultChannel listener  → receives result on main thread, updates job_record to done
 *   GET  /api/jobs          → list all jobs from PostgreSQL
 *   GET  /api/jobs/results  → list completed jobs (status = done)
 *   GET  /api/jobs/:id      → get a specific job by ID
 *
 * Try it:
 *   # Submit several jobs concurrently
 *   for i in 1 2 3 4 5; do
 *     curl -s -X POST localhost:5000/api/jobs \
 *       -H "Content-Type: application/json" \
 *       -d "{\"task\":\"send-email\",\"to\":\"user${i}@example.com\"}" &
 *   done; wait
 *
 *   # Poll for results (worker takes ~150ms per job)
 *   curl localhost:5000/api/jobs/results
 *   curl localhost:5000/api/jobs
 */
import { Controller, Get, Post as HttpPost } from '@velocity/framework';
import type { VelocityRequest, VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';
import { pgDb } from '../../pgDb';
import { jobChannel, resultChannel } from '../services/job.service';

// Collect results from the @Go worker on the main thread and persist to PostgreSQL.
// This file is never imported in the worker context (worker only imports job.service.ts),
// so pgDb usage here is safe — always runs on the main thread.
(async () => {
  for await (const result of resultChannel) {
    await pgDb.JobRecord.update(result.jobId, {
      status: 'done',
      output: result.output,
      processedAt: result.processedAt,
    });
  }
})();

@Controller('/jobs')
class JobController {
  /** Enqueue a new background job. Persists to PostgreSQL then hands off to worker thread. */
  @HttpPost('/')
  async submit(req: VelocityRequest, res: VelocityResponse) {
    const payload = req.body || {};
    const enqueuedAt = new Date().toISOString();

    const record = await pgDb.JobRecord.create({
      payload: JSON.stringify(payload),
      status: 'pending',
      output: '',
      enqueuedAt,
    });

    jobChannel.send({ id: record.id, payload, enqueuedAt });

    return res.status(202).json({
      job: record,
      message: 'Queued — @Go worker is processing in a real Bun thread',
    });
  }

  /** List all jobs (any status) from PostgreSQL. */
  @Get('/')
  async list(_req: VelocityRequest, _res: VelocityResponse) {
    const jobs = await pgDb.JobRecord.findAll();
    return { total: jobs.length, jobs };
  }

  /** List only completed jobs (status = done). */
  @Get('/results')
  async results(_req: VelocityRequest, _res: VelocityResponse) {
    const results = await pgDb.JobRecord.findMany({ status: 'done' } as any);
    return { total: results.length, results };
  }

  /** Get a specific job by ID. */
  @Get('/:id')
  async getById(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const job = await pgDb.JobRecord.findById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return { job };
  }
}

velo.register(JobController);
