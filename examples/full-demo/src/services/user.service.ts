import { Service } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';

@Service()
export class UserService {
  /** Get all users */
  async getAll() {
    return db.User.findAll();
  }

  /** Get user by ID */
  async getById(id: number) {
    return db.User.findById(id);
  }

  /** Create a new user */
  async create(data: { name: string; email: string; age?: number }) {
    return db.User.create({
      ...data,
      createdAt: new Date().toISOString()
    });
  }

  /** Delete a user */
  async remove(id: number) {
    return db.User.delete(id);
  }
}

// Self-register on velo
velo.register(UserService);
