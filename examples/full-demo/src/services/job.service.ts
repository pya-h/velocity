import { Service, Go, VelocityChannel } from '@velocity/framework';
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

const jobChannel    = new VelocityChannel<Job>('velocity:jobs');
const resultChannel = new VelocityChannel<JobResult>('velocity:results');

let jobIdCounter = 0;
export const processedResults: JobResult[] = [];

// Collect results from the @Go worker on the main event loop
(async () => {
  for await (const result of resultChannel) {
    processedResults.push(result);
  }
})();

export function enqueueJob(payload: any): Job {
  const job: Job = { id: ++jobIdCounter, payload, enqueuedAt: new Date().toISOString() };
  jobChannel.send(job);
  return job;
}

@Service()
class JobWorkerService {
  @Go()
  async run() {
    const jobs = new VelocityChannel<Job>('velocity:jobs');
    const out  = new VelocityChannel<JobResult>('velocity:results');

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
