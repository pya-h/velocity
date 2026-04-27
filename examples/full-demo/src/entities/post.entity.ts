import { Entity, Column, PrimaryKey } from '@velocity/framework';
import { pgDb } from '../../pgDb';

@Entity('posts')
export class Post {
  @PrimaryKey()
  id: number;

  @Column()
  title: string;

  @Column()
  content: string;

  @Column()
  author: string;

  @Column()
  createdAt: string;

  constructor() {
    this.id = 0;
    this.title = '';
    this.content = '';
    this.author = '';
    this.createdAt = new Date().toISOString();
  }
}

// Self-register on the PostgreSQL database
pgDb.register(Post);
