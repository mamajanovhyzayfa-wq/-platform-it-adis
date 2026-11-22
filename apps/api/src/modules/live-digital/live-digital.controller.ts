import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../../nest/common/decorators.js'
import { LiveDigitalService } from './live-digital.service.js'

@Controller('api/live-digital')
export class LiveDigitalController {
  constructor(private readonly liveDigital: LiveDigitalService) {}

  @Get('status')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  status() {
    return this.liveDigital.status()
  }

  @Get('rooms')
  @Roles('ADMIN', 'MANAGER', 'TEACHER')
  rooms(@Query() query: Record<string, string>) {
    return this.liveDigital.rooms(query)
  }
}
