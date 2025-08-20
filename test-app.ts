import 'reflect-metadata';
import { VelocityApplication } from './src/core/application';
import { VelocityRequest, VelocityResponse } from './src/types';

// Simple test controller without complex decorators
class TestController {
  async getHealth(req: VelocityRequest, res: VelocityResponse) {
    return { status: 'OK', message: 'Framework is running!', timestamp: new Date().toISOString() };
  }

  async getUsers(req: VelocityRequest, res: VelocityResponse) {
    return { 
      users: [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
      ]
    };
  }

  async createUser(req: VelocityRequest, res: VelocityResponse) {
    const { name, email } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    const user = { 
      id: Math.floor(Math.random() * 1000), 
      name, 
      email, 
      createdAt: new Date().toISOString() 
    };
    
    return res.status(201).json({ user });
  }
}

// Manual registration approach
async function bootstrap() {
  const app = new VelocityApplication({
    port: 5000,
    host: '0.0.0.0',
    logger: {
      level: 'info',
      format: 'combined',
      outputs: ['console']
    },
    database: null // Disable database for this demo
  });

  // Manually register routes
  const controller = new TestController();
  
  // Create route metadata manually
  const routes = [
    { path: '/', method: 'GET', handler: 'getHealth' },
    { path: '/users', method: 'GET', handler: 'getUsers' },
    { path: '/users', method: 'POST', handler: 'createUser' }
  ];

  // Use the actual symbols from the framework
  const CONTROLLER_METADATA_KEY = Symbol.for('controller');
  const ROUTES_METADATA_KEY = Symbol.for('routes');
  
  Reflect.defineMetadata(CONTROLLER_METADATA_KEY, {
    path: '/api',
    target: TestController
  }, TestController);
  
  Reflect.defineMetadata(ROUTES_METADATA_KEY, routes, TestController);

  try {
    app.registerController(TestController);
    await app.listen();
    console.log('🚀 Velocity Framework demo is running at http://localhost:5000');
    console.log('📋 Available endpoints:');
    console.log('  GET  /api/        - Health check');
    console.log('  GET  /api/users   - Get users');
    console.log('  POST /api/users   - Create user');
  } catch (error) {
    console.error('Failed to start application:', error);
  }
}

bootstrap().catch(console.error);