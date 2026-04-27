import { Controller, Get } from '@velocity/framework';
import { velo } from '../../velo';

@Controller('/health')
class HealthController {
  // ── Injection style: no params — just return ──────────────────────────────
  @Get('/')
  async health() {
    return { status: 'ok', uptime: process.uptime() };
  }
}

velo.register(HealthController);
