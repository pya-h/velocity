import { Entity, Column, PrimaryKey } from '../../../src';

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

  @Column({ nullable: true })
  publishedAt?: Date;

  @Column()
  createdAt: Date;

  constructor() {
    this.id = 0;
    this.title = '';
    this.content = '';
    this.author = '';
    this.createdAt = new Date();
  }
}
