import { Module } from '@nestjs/common'
import { TestsController } from './tests.controller.js'
import { TestingService } from './testing.service.js'

@Module({
  controllers: [TestsController],
  providers: [TestingService],
  exports: [TestingService],
})
export class TestsModule {}
