import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryOperationsService } from './inventory-operations.service';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryOperationsService],
  exports: [InventoryService, InventoryOperationsService],
})
export class InventoryModule {}
