import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ReportQueryDto } from './dto/report-query.dto';
import {
  DailyReportSection,
  ReportsService,
} from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER_SERVICE, UserRole.BRANCH_EMPLOYEE)
  @ApiHeader({
    name: 'X-Report-Section',
    required: false,
    description:
      'summary (default) | sales | reservations | delivered | cancelled | received | stockOut | allMovements',
  })
  getDaily(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
    @Headers('x-report-section') sectionHeader?: string,
  ) {
    const section = this.parseDailySection(sectionHeader);
    return this.reportsService.getDailyReport(user, query, section);
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

  private parseDailySection(raw?: string): DailyReportSection {
    const value = String(raw || 'summary').trim().toLowerCase();
    const allowed: DailyReportSection[] = [
      'summary',
      'sales',
      'reservations',
      'delivered',
      'cancelled',
      'received',
      'stockout',
      'allmovements',
    ];

    const normalized =
      value === 'stock-out' || value === 'stock_out'
        ? 'stockout'
        : value === 'all-movements' || value === 'all_movements'
          ? 'allmovements'
          : value;

    if (!allowed.includes(normalized as DailyReportSection)) {
      throw new BadRequestException(
        `Invalid X-Report-Section. Allowed: ${allowed.join(', ')}`,
      );
    }

    return normalized as DailyReportSection;
  }
}
