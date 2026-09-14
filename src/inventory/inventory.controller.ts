import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockQuantityDto } from './dto/stock-quantity.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.findAll(user);
  }

  @Get(':branchId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  findByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.findByBranch(branchId, user);
  }

  @Get(':branchId/:productId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  findOne(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.findOne(branchId, productId, user);
  }

  @Post(':branchId/:productId/add')
  @Roles(UserRole.ADMIN)
  addStock(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: StockQuantityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.addStock(branchId, productId, dto, user);
  }

  @Post(':branchId/:productId/remove')
  @Roles(UserRole.ADMIN)
  removeStock(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: StockQuantityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.removeStock(branchId, productId, dto, user);
  }

  @Post(':branchId/:productId/adjust')
  @Roles(UserRole.ADMIN)
  adjustStock(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.adjustStock(branchId, productId, dto, user);
  }

  @Get(':branchId/:productId/movements')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  getMovements(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.getMovements(branchId, productId, user);
  }
}
