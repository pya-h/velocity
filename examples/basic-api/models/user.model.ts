import { Entity, Column, PrimaryKey } from '../../../src';

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
  createdAt: Date;

  constructor() {
    this.id = 0;
    this.name = '';
    this.email = '';
    this.createdAt = new Date();
  }
}
