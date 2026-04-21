import { Controller, Get } from '../../../src';
import { VelocityRequest, VelocityResponse } from '../../../src/types';
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
