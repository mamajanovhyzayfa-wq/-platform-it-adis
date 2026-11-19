import { Module } from '@nestjs/common'
import { RbacModule } from '../../rbac/rbac.module.js'
import { AuthModule } from '../auth/auth.module.js'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
