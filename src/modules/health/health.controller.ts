import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthStatus } from '@wedding/shared';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity check' })
  @ApiResponse({ status: 200, description: 'API and database are healthy' })
  @ApiResponse({ status: 503, description: 'API is running but the database is unreachable' })
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    const health = await this.healthService.check();
    // 503 lets Nginx / uptime monitors detect a degraded instance without parsing the body.
    res.status(health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return health;
  }
}
