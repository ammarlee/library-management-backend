import { ForbiddenException, Injectable } from '@nestjs/common';
import { ReservationStatus, StockMovementType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto } from './dto/report-query.dto';

export type DailyReportSection =
  | 'summary'
  | 'sales'
  | 'reservations'
  | 'delivered'
  | 'cancelled'
  | 'received'
  | 'stockout'
  | 'allmovements';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma Decimal / string / number → plain number */
  private moneyNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'toNumber' in value &&
      typeof (value as { toNumber: unknown }).toNumber === 'function'
    ) {
      return (value as { toNumber: () => number }).toNumber();
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async getDailyReport(
    user: AuthenticatedUser,
    query: ReportQueryDto,
    section: DailyReportSection = 'summary',
  ) {
    const range = this.buildDateRange(query);

    if (user.role === UserRole.ADMIN) {
      return this.getAdminDailySummary(query, range);
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      const reservations = await this.prisma.reservation.count({
        where: { createdById: user.id, createdAt: range },
      });
      return { summary: { reservations }, section: 'summary' };
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      if (section === 'summary') {
        return this.getBranchDailySummary(user.branchId, range);
      }
      return this.getBranchDailySection(user.branchId, range, section);
    }

    throw new ForbiddenException('Cannot generate report');
  }

  private async getAdminDailySummary(
    query: ReportQueryDto,
    range: { gte: Date; lte: Date },
  ) {
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const [sales, reservations, deliveredReservations, returns, exchanges, payments] =
      await Promise.all([
        this.prisma.sale.count({
          where: { ...branchFilter, createdAt: range },
        }),
        this.prisma.reservation.count({
          where: { ...branchFilter, createdAt: range },
        }),
        this.prisma.reservation.count({
          where: {
            ...branchFilter,
            status: ReservationStatus.DELIVERED,
            updatedAt: range,
          },
        }),
        this.prisma.productReturn.count({ where: { createdAt: range } }),
        this.prisma.exchange.count({ where: { createdAt: range } }),
        this.prisma.payment.aggregate({
          where: {
            createdAt: range,
            ...(query.branchId ? { sale: { branchId: query.branchId } } : {}),
          },
          _sum: { amount: true },
        }),
      ]);

    return {
      section: 'summary' as const,
      summary: {
        sales,
        reservations,
        deliveredReservations,
        returns,
        exchanges,
        paymentsTotal: this.moneyNumber(payments._sum.amount),
      },
    };
  }

  private async getBranchDailySummary(
    branchId: string,
    dateRange: { gte: Date; lte: Date },
  ) {
    const [
      sales,
      reservations,
      deliveredReservations,
      cancelledReservations,
      returns,
      exchanges,
      stockMovementsCount,
      movementQtyRows,
      paymentsList,
      refundsList,
    ] = await Promise.all([
      this.prisma.sale.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.reservation.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.reservation.count({
        where: {
          branchId,
          status: ReservationStatus.DELIVERED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.reservation.count({
        where: {
          branchId,
          status: ReservationStatus.CANCELLED,
          updatedAt: dateRange,
        },
      }),
      this.prisma.productReturn.count({
        where: { sale: { branchId }, createdAt: dateRange },
      }),
      this.prisma.exchange.count({
        where: { sale: { branchId }, createdAt: dateRange },
      }),
      this.prisma.stockMovement.count({
        where: { branchId, createdAt: dateRange },
      }),
      this.prisma.stockMovement.findMany({
        where: { branchId, createdAt: dateRange },
        select: { movementType: true, physicalQuantityChange: true },
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: dateRange,
          OR: [{ sale: { branchId } }, { reservation: { branchId } }],
        },
        select: { amount: true, method: true },
      }),
      this.prisma.refund.findMany({
        where: {
          createdAt: dateRange,
          OR: [
            { sale: { branchId } },
            { reservation: { branchId } },
            { returnRecord: { sale: { branchId } } },
            { exchange: { sale: { branchId } } },
          ],
        },
        select: { amount: true },
      }),
    ]);

    let receivedQty = 0;
    let stockOutQty = 0;

    for (const m of movementQtyRows) {
      if (
        m.movementType === StockMovementType.STOCK_IN ||
        m.movementType === StockMovementType.RETURN ||
        (m.physicalQuantityChange > 0 &&
          m.movementType !== StockMovementType.ADJUSTMENT &&
          m.movementType !== StockMovementType.RESERVATION &&
          m.movementType !== StockMovementType.RESERVATION_RELEASE)
      ) {
        receivedQty += Math.max(0, m.physicalQuantityChange);
      }

      if (
        m.movementType === StockMovementType.STOCK_OUT ||
        m.movementType === StockMovementType.DAMAGED
      ) {
        stockOutQty += Math.abs(m.physicalQuantityChange);
      }
    }

    const paymentsCollected = paymentsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const refundsTotal = refundsList.reduce(
      (sum, row) => sum + this.moneyNumber(row.amount),
      0,
    );
    const paymentsNet = Number((paymentsCollected - refundsTotal).toFixed(2));

    const paymentsByMethodMap = new Map<string, number>();
    for (const row of paymentsList) {
      const method = String(row.method || 'CASH').toUpperCase();
      const amount = this.moneyNumber(row.amount);
      paymentsByMethodMap.set(
        method,
        (paymentsByMethodMap.get(method) || 0) + amount,
      );
    }
    const paymentsByMethod = Array.from(paymentsByMethodMap.entries())
      .map(([method, amount]) => ({
        method,
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      section: 'summary' as const,
      branchId,
      from: dateRange.gte,
      to: dateRange.lte,
      summary: {
        sales,
        reservations,
        deliveredReservations,
        cancelledReservations,
        returns,
        exchanges,
        paymentsCollected: Number(paymentsCollected.toFixed(2)),
        refundsTotal: Number(refundsTotal.toFixed(2)),
        paymentsTotal: paymentsNet,
        paymentsByMethod,
        receivedQty,
        stockOutQty,
        stockMovements: stockMovementsCount,
      },
    };
  }

  private async getBranchDailySection(
    branchId: string,
    dateRange: { gte: Date; lte: Date },
    section: Exclude<DailyReportSection, 'summary'>,
  ) {
    const movementInclude = {
      product: { select: { id: true, name: true, type: true } },
      createdBy: { select: { id: true, fullName: true } },
    } as const;

    switch (section) {
      case 'sales': {
        const sales = await this.prisma.sale.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            items: {
              include: {
                product: { select: { id: true, name: true } },
              },
            },
            payments: true,
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return { section, sales };
      }

      case 'reservations': {
        const reservations = await this.prisma.reservation.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
            payments: true,
            refunds: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        return { section, reservations };
      }

      case 'delivered': {
        const deliveredReservations = await this.prisma.reservation.findMany({
          where: {
            branchId,
            status: ReservationStatus.DELIVERED,
            updatedAt: dateRange,
          },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { updatedAt: 'desc' },
        });
        return { section, deliveredReservations };
      }

      case 'cancelled': {
        const cancelledReservations = await this.prisma.reservation.findMany({
          where: {
            branchId,
            status: ReservationStatus.CANCELLED,
            updatedAt: dateRange,
          },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
            payments: true,
            refunds: true,
          },
          orderBy: { updatedAt: 'desc' },
        });
        return { section, cancelledReservations };
      }

      case 'received': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: { branchId, createdAt: dateRange },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        const receivedProducts = stockMovements.filter(
          (m) =>
            m.movementType === StockMovementType.STOCK_IN ||
            m.movementType === StockMovementType.RETURN ||
            (m.physicalQuantityChange > 0 &&
              m.movementType !== StockMovementType.ADJUSTMENT &&
              m.movementType !== StockMovementType.RESERVATION &&
              m.movementType !== StockMovementType.RESERVATION_RELEASE),
        );
        return { section, receivedProducts };
      }

      case 'stockout': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: {
            branchId,
            createdAt: dateRange,
            movementType: {
              in: [StockMovementType.STOCK_OUT, StockMovementType.DAMAGED],
            },
          },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        return { section, stockOutProducts: stockMovements };
      }

      case 'allmovements': {
        const stockMovements = await this.prisma.stockMovement.findMany({
          where: { branchId, createdAt: dateRange },
          include: movementInclude,
          orderBy: { createdAt: 'desc' },
        });
        return { section, stockMovements };
      }

      default:
        throw new ForbiddenException('Invalid report section');
    }
  }

  getSalesReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where = this.buildEntityFilter(user, query);
    return this.prisma.sale.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        student: true,
        branch: true,
        items: { include: { product: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getReservationsReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where = this.buildEntityFilter(user, query);
    return this.prisma.reservation.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        student: true,
        branch: true,
        product: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getInventoryReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : query.branchId
          ? { branchId: query.branchId }
          : {};

    return this.prisma.inventory.findMany({
      where,
      include: {
        branch: true,
        product: true,
      },
    });
  }

  getStockMovementsReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const where =
      user.role === UserRole.BRANCH_EMPLOYEE && user.branchId
        ? { branchId: user.branchId }
        : query.branchId
          ? { branchId: query.branchId }
          : {};

    return this.prisma.stockMovement.findMany({
      where: { ...where, createdAt: this.buildDateRange(query) },
      include: {
        branch: true,
        product: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getExpensesReport(query: ReportQueryDto) {
    return this.prisma.expense.findMany({
      where: {
        expenseDate: this.buildDateRange(query, 'expenseDate'),
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      include: {
        category: true,
        branch: true,
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    });
  }

  private buildEntityFilter(user: AuthenticatedUser, query: ReportQueryDto) {
    if (user.role === UserRole.ADMIN) {
      return query.branchId ? { branchId: query.branchId } : {};
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      return { createdById: user.id };
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      return { branchId: user.branchId };
    }

    throw new ForbiddenException('Cannot access report');
  }

  private buildDateRange(
    query: ReportQueryDto,
    field: 'createdAt' | 'expenseDate' = 'createdAt',
  ) {
    const from = query.from
      ? new Date(query.from)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const to = query.to
      ? new Date(query.to)
      : new Date(new Date().setHours(23, 59, 59, 999));

    return { gte: from, lte: to };
  }
}
