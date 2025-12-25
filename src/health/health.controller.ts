import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@Controller('health')
@ApiTags('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({
    description: 'Service is up',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'UP' },
        service: { type: 'string', example: 'anti-fraud' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Service is starting or unavailable',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'STARTING' },
        detail: { type: 'string', example: 'Connecting to resources...' },
      },
    },
  })
  check() {
    if (this.healthService.isReady()) {
      return { status: 'UP', service: 'anti-fraud' };
    }
    throw new ServiceUnavailableException({
      status: 'STARTING',
      detail: 'Connecting to resources...',
    });
  }
}
