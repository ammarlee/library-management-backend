import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  getDaily(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getDailyReport(user, query);
  }

  @Get('sales')
  @Roles(UserRole.ADMIN, UserRole.BRANCH_EMPLOYEE)
  getSales(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getSalesReport(user, query);
  }

  @Get('reservations')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  getReservations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getReservationsReport(user, query);
  }

  @Get('inventory')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  getInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getInventoryReport(user, query);
  }

  @Get('stock-movements')
  @Roles(UserRole.ADMIN, UserRole.BRANCH_EMPLOYEE)
  getStockMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getStockMovementsReport(user, query);
  }

  @Get('expenses')
  @Roles(UserRole.ADMIN)
  getExpenses(@Query() query: ReportQueryDto) {
    return this.reportsService.getExpensesReport(query);
  }
}
