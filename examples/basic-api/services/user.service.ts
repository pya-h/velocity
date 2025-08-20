import { Injectable } from '../../../src';
import { Logger } from '../../../src/logging/logger';

interface User {
  id: number;
  name: string;
  email: string;
  age?: number;
  createdAt: Date;
}

@Injectable()
export class UserService {
  private users: User[] = [];
  private nextId = 1;

  constructor(private logger: Logger) {
    this.logger.info('UserService initialized');
    
    // Add some sample users
    this.users = [
      {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        createdAt: new Date()
      },
      {
        id: 2,
        name: 'Jane Smith',
        email: 'jane@example.com',
        age: 25,
        createdAt: new Date()
      }
    ];
    this.nextId = 3;
  }

  async getAllUsers(): Promise<User[]> {
    this.logger.debug('Fetching all users');
    return this.users;
  }

  async getUserById(id: number): Promise<User | null> {
    this.logger.debug(`Fetching user with ID: ${id}`);
    return this.users.find(user => user.id === id) || null;
  }

  async createUser(userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = {
      ...userData,
      id: this.nextId++,
      createdAt: new Date()
    };

    this.users.push(user);
    this.logger.info(`Created user: ${user.name} (ID: ${user.id})`);
    
    return user;
  }

  async updateUser(id: number, userData: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User | null> {
    const userIndex = this.users.findIndex(user => user.id === id);
    
    if (userIndex === -1) {
      return null;
    }

    this.users[userIndex] = {
      ...this.users[userIndex],
      ...userData
    };

    this.logger.info(`Updated user with ID: ${id}`);
    return this.users[userIndex];
  }

  async deleteUser(id: number): Promise<boolean> {
    const userIndex = this.users.findIndex(user => user.id === id);
    
    if (userIndex === -1) {
      return false;
    }

    this.users.splice(userIndex, 1);
    this.logger.info(`Deleted user with ID: ${id}`);
    
    return true;
  }
}
