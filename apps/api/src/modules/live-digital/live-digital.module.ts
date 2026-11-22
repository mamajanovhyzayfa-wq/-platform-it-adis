import { Module } from '@nestjs/common'
import { LiveDigitalController } from './live-digital.controller.js'
import { LiveDigitalService } from './live-digital.service.js'

@Module({ controllers: [LiveDigitalController], providers: [LiveDigitalService] })
export class LiveDigitalModule {}
