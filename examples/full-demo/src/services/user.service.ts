import { Go, Service } from '@velocity/framework';
import { db } from '../../db';
import { velo } from '../../velo';

@Service()
export class UserService {
  async getAll() {
    return db.User.findAll();
  }

  async getById(id: number) {
    return db.User.findById(id);
  }

  async create(data: { name: string; email: string; age?: number }) {
    return db.User.create({ ...data, createdAt: new Date().toISOString() });
  }

  async remove(id: number) {
    return db.User.delete(id);
  }
}

velo.register(UserService);
