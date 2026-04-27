import { Entity, Column, PrimaryKey } from '@velocity/framework';
import { pgDb } from '../../pgDb';

@Entity('job_records')
export class JobRecord {
  @PrimaryKey()
  id: number;

  @Column()
  payload: string;  // JSON-encoded job payload

  @Column()
  status: string;   // 'pending' | 'done' | 'failed'

  @Column({ nullable: true })
  output?: string;

  @Column()
  enqueuedAt: string;

  @Column({ nullable: true })
  processedAt?: string;

  constructor() {
    this.id = 0;
    this.payload = '{}';
    this.status = 'pending';
    this.output = '';
    this.enqueuedAt = new Date().toISOString();
  }
}

pgDb.register(JobRecord);
