import { Controller, Get } from '@velocity/framework';
import type { VelocityRequest, VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';

@Controller('/health')
class HealthController {
  @Get('/')
  async health(_req: VelocityRequest, _res: VelocityResponse) {
    return { status: 'ok', uptime: process.uptime() };
  }
}

velo.register(HealthController);
