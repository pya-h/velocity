import { Controller, Get, Post, Put, Delete, Validate } from '../../../src';
import { VelocityRequest, VelocityResponse } from '../../../src/types';
import { UserService } from '../services/user.service';
import { Validator } from '../../../src/validation/validator';
import * as Joi from 'joi';

const createUserSchema = Validator.createSchema({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  age: Joi.number().integer().min(1).max(120)
});

const updateUserSchema = Validator.createSchema({
  name: Joi.string(),
  email: Joi.string().email(),
  age: Joi.number().integer().min(1).max(120)
});

@Controller('/api/users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('/')
  async getAllUsers(req: VelocityRequest, res: VelocityResponse) {
    const users = await this.userService.getAllUsers();
    return { users };
  }

  @Get('/:id')
  async getUserById(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const user = await this.userService.getUserById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return { user };
  }

  @Post('/')
  @Validate(createUserSchema)
  async createUser(req: VelocityRequest, res: VelocityResponse) {
    const userData = req.body;
    const user = await this.userService.createUser(userData);
    return res.status(201).json({ user });
  }

  @Put('/:id')
  @Validate(updateUserSchema)
  async updateUser(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const userData = req.body;
    const user = await this.userService.updateUser(id, userData);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return { user };
  }

  @Delete('/:id')
  async deleteUser(req: VelocityRequest, res: VelocityResponse) {
    const id = parseInt(req.params!.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const success = await this.userService.deleteUser(id);
    
    if (!success) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(204).send('');
  }
}
