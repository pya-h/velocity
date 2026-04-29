import { Service, Go, Channel, VeloChannel } from '@velocity/framework';
import { velo } from '../../velo';

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

// Exported so job.controller.ts can send jobs and receive results on the main thread.
// The @Go worker receives its own isolated channel instances via @Channel injection.
export const jobChannel    = new VeloChannel<Job>('velocity:jobs');
export const resultChannel = new VeloChannel<JobResult>('velocity:results');

@Service()
class JobWorkerService {
  @Go()
  async run(
    @Channel('velocity:jobs') jobs: VeloChannel<Job>,
    @Channel('velocity:results') out: VeloChannel<JobResult>,
  ) {
    for await (const job of jobs) {
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
