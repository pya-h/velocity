import { Entity, Column, PrimaryKey } from '@velocity/framework';
import { db } from '../db';

@Entity('users')
export class User {
  @PrimaryKey()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  age?: number;

  @Column()
  createdAt: string;

  constructor() {
    this.id = 0;
    this.name = '';
    this.email = '';
    this.createdAt = new Date().toISOString();
  }
}

// Self-register on the database
db.register(User);
