import { Controller, Get, VelocityRequest, VelocityResponse } from '@velocity/framework';
import { app } from '../app';

@Controller('/api')
class HealthController {
  @Get('/health')
  async health(_req: VelocityRequest, _res: VelocityResponse) {
    return { status: 'ok', uptime: process.uptime() };
  }
}

// Self-register on the app
app.register(HealthController);
