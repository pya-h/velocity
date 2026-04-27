/**
 * JobController — REST interface for the @Go + VelocityChannel + PostgreSQL job queue demo.
 */
import { Controller, Get, Post as HttpPost } from '@velocity/framework';
import type { VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';
import { pgDb } from '../../pgDb';
import { jobChannel, resultChannel } from '../services/job.service';

// Collect results from the @Go worker on the main thread and persist to PostgreSQL.
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
  // ── Injection style: `body` + `res` ───────────────────────────────────────
  @HttpPost('/')
  async submit(body: any, res: VelocityResponse) {
    const payload = body || {};
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

  // ── Injection style: no params — just return ─────────────────────────────
  @Get('/')
  async list() {
    const jobs = await pgDb.JobRecord.findAll();
    return { total: jobs.length, jobs };
  }

  @Get('/results')
  async results() {
    const results = await pgDb.JobRecord.findMany({ status: 'done' } as any);
    return { total: results.length, results };
  }

  // ── Injection style: `param` + `res` ──────────────────────────────────────
  @Get('/:id')
  async getById(param: Record<string, string>, res: VelocityResponse) {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const job = await pgDb.JobRecord.findById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return { job };
  }
}

velo.register(JobController);
