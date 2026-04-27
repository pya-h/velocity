/**
 * Job queue demo — shows @Go + VelocityChannel working together.
 *
 * Architecture:
 *   Main thread ──[velocity:jobs]──▶ @Go worker thread
 *   Main thread ◀──[velocity:results]── @Go worker thread
 *
 * The two named channels connect across thread boundaries automatically.
 * `processedResults` is populated on the main event loop by listening
 * to the result channel, then read by JobController.
 */
import { Service, Go, VelocityChannel } from '@velocity/framework';
import { velo } from '../../velo';

// ─── Shared types ───────────────────────────────────────────────────────────

export interface Job {
  id: number;
  payload: any;
  enqueuedAt: string;
}

export interface JobResult {
  jobId: number;
  output: string;
  processedAt: string;
}

// ─── Channels ───────────────────────────────────────────────────────────────
// Both channels are created in every context that imports this file (including
// the @Go worker). BroadcastChannel connects them by name across threads.

const jobChannel    = new VelocityChannel<Job>('velocity:jobs');
const resultChannel = new VelocityChannel<JobResult>('velocity:results');

// ─── Main-thread result collector ───────────────────────────────────────────
// Runs as a non-blocking async loop on the event loop.
// The @Go worker sends results here; we collect them for the REST endpoint.
let jobIdCounter = 0;
export const processedResults: JobResult[] = [];

(async () => {
  for await (const result of resultChannel) {
    processedResults.push(result);
  }
})();

// ─── Main-thread API ────────────────────────────────────────────────────────

export function enqueueJob(payload: any): Job {
  const job: Job = {
    id: ++jobIdCounter,
    payload,
    enqueuedAt: new Date().toISOString(),
  };
  jobChannel.send(job);
  return job;
}

// ─── Background worker ──────────────────────────────────────────────────────

@Service()
class JobWorkerService {
  /**
   * Runs in a real Bun Worker thread (OS-level parallelism).
   * Drains the job channel and sends results back via the result channel.
   */
  @Go()
  async run() {
    // Create channels by name — BroadcastChannel connects them to the main thread
    const jobs = new VelocityChannel<Job>('velocity:jobs');
    const out  = new VelocityChannel<JobResult>('velocity:results');

    for await (const job of jobs) {
      // Simulate async processing work (DB write, HTTP call, image resize, etc.)
      await Bun.sleep(150);

      out.send({
        jobId: job.id,
        output: `Processed job #${job.id} — payload: ${JSON.stringify(job.payload)}`,
        processedAt: new Date().toISOString(),
      });
    }
  }
}

velo.register(JobWorkerService);
