/**
 * JobController — REST interface for the @Go + VelocityChannel job queue demo.
 *
 * Try it:
 *   # Submit a job
 *   curl -X POST localhost:5000/api/jobs \
 *        -H "Content-Type: application/json" \
 *        -d '{"task":"send-email","to":"alice@example.com"}'
 *
 *   # Submit a few more, then check results
 *   curl localhost:5000/api/jobs/results
 */
import { Controller, Get, Post as HttpPost } from '@velocity/framework';
import type { VelocityRequest, VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';
import { enqueueJob, processedResults } from '../services/job.service';

@Controller('/jobs')
class JobController {
  /** Enqueue a new background job. Returns immediately (non-blocking). */
  @HttpPost('/')
  submit(req: VelocityRequest, res: VelocityResponse) {
    const job = enqueueJob(req.body || {});
    return res.status(202).json({
      job,
      message: 'Queued — @Go worker is processing in a real thread',
    });
  }

  /** Return all results processed by the @Go worker so far. */
  @Get('/results')
  results(_req: VelocityRequest, _res: VelocityResponse) {
    return { total: processedResults.length, results: processedResults };
  }
}

velo.register(JobController);
