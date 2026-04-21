import { Service } from '../../../src';
import { db } from '../db';
import { app } from '../app';

@Service()
export class UserService {
  /** Get all users */
  async getAll() {
    return (db as any).User.findAll();
  }

  /** Get user by ID */
  async getById(id: number) {
    return (db as any).User.findById(id);
  }

  /** Create a new user */
  async create(data: { name: string; email: string; age?: number }) {
    return (db as any).User.create({
      ...data,
      createdAt: new Date().toISOString()
    });
  }

  /** Delete a user */
  async remove(id: number) {
    return (db as any).User.delete(id);
  }
}

// Self-register on the app
app.register(UserService);
