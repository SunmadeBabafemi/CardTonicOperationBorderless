import { Module } from '@nestjs/common';
import { DevToolsController } from './devTools.controller';
import { DevToolsService } from './devTools.service';

@Module({
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule {}
