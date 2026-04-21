import { Controller, Get, VelocityRequest, VelocityResponse } from '@velocity/framework';
import { velo } from '../velo';

@Controller('/health')
class HealthController {
  @Get('/')
  async health(_req: VelocityRequest, _res: VelocityResponse) {
    return { status: 'ok', uptime: process.uptime() };
  }
}

// Self-register (globalPrefix '/api' → /api/health)
velo.register(HealthController);
