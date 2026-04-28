/**
 * JobController — REST interface for the @Go + VelocityChannel + PostgreSQL job queue demo.
 */
import { Controller, Get, Post as HttpPost, Status, StatusCode } from '@velocity/framework';
import type { VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';
import { pgDb } from '../../pgDb';
import { jobChannel, resultChannel } from '../services/job.service';

interface JobParams {
  id: string;
}

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
  // ── @Status(202) + typed body ─────────────────────────────────────────────
  @HttpPost('/')
  @Status(StatusCode.Accepted)
  async submit(body: Record<string, unknown>): Promise<{ job: unknown; message: string }> {
    const payload = body || {};
    const enqueuedAt = new Date().toISOString();

    const record = await pgDb.JobRecord.create({
      payload: JSON.stringify(payload),
      status: 'pending',
      output: '',
      enqueuedAt,
    });

    jobChannel.send({ id: record.id, payload, enqueuedAt });

    return {
      job: record,
      message: 'Queued — @Go worker is processing in a real Bun thread',
    };
  }

  // ── No params — just return ───────────────────────────────────────────────
  @Get('/')
  async list(): Promise<{ total: number; jobs: unknown[] }> {
    const jobs = await pgDb.JobRecord.findAll();
    return { total: jobs.length, jobs };
  }

  @Get('/results')
  async results(): Promise<{ total: number; results: unknown[] }> {
    const completed = await pgDb.JobRecord.findMany({ status: 'done' } as Record<string, unknown>);
    return { total: completed.length, results: completed };
  }

  // ── Typed param + res for error handling ──────────────────────────────────
  @Get('/:id')
  async getById(param: JobParams, res: VelocityResponse): Promise<{ job: unknown } | void> {
    const id = parseInt(param.id);
    if (isNaN(id)) return res.status(StatusCode.BadRequest).json({ error: 'Invalid ID' });
    const job = await pgDb.JobRecord.findById(id);
    if (!job) return res.status(StatusCode.NotFound).json({ error: 'Job not found' });
    return { job };
  }
}

velo.register(JobController);
