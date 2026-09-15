import { ForbiddenException, Injectable } from '@nestjs/common';
import { ReservationStatus, StockMovementType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyReport(user: AuthenticatedUser, query: ReportQueryDto) {
    const range = this.buildDateRange(query);

    if (user.role === UserRole.ADMIN) {
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
            where: { createdAt: range, ...(query.branchId ? { sale: { branchId: query.branchId } } : {}) },
            _sum: { amount: true },
          }),
        ]);

      return {
        sales,
        reservations,
        deliveredReservations,
        returns,
        exchanges,
        paymentsTotal: payments._sum.amount,
      };
    }

    if (user.role === UserRole.CUSTOMER_SERVICE) {
      const reservations = await this.prisma.reservation.count({
        where: { createdById: user.id, createdAt: range },
      });

      return { reservations };
    }

    if (user.role === UserRole.BRANCH_EMPLOYEE && user.branchId) {
      const branchId = user.branchId;
      const dateRange = this.buildDateRange(query);

      const [
        sales,
        reservations,
        deliveredReservations,
        returns,
        exchanges,
        payments,
        stockMovements,
        salesList,
        reservationsList,
        deliveredList,
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
        this.prisma.productReturn.count({
          where: { sale: { branchId }, createdAt: dateRange },
        }),
        this.prisma.exchange.count({
          where: { sale: { branchId }, createdAt: dateRange },
        }),
        this.prisma.payment.aggregate({
          where: {
            createdAt: dateRange,
            OR: [{ sale: { branchId } }, { reservation: { branchId } }],
          },
          _sum: { amount: true },
        }),
        this.prisma.stockMovement.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            product: { select: { id: true, name: true, type: true } },
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.sale.findMany({
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
        }),
        this.prisma.reservation.findMany({
          where: { branchId, createdAt: dateRange },
          include: {
            student: { select: { id: true, name: true, phone: true } },
            product: { select: { id: true, name: true } },
            createdBy: { select: { id: true, fullName: true } },
            payments: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.reservation.findMany({
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
        }),
      ]);

      const receivedStock = stockMovements.filter(
        (m) =>
          m.movementType === StockMovementType.STOCK_IN ||
          m.movementType === StockMovementType.RETURN ||
          (m.physicalQuantityChange > 0 &&
            m.movementType !== StockMovementType.ADJUSTMENT &&
            m.movementType !== StockMovementType.RESERVATION &&
            m.movementType !== StockMovementType.RESERVATION_RELEASE),
      );
      const takenStock = stockMovements.filter(
        (m) =>
          m.movementType === StockMovementType.STOCK_OUT ||
          m.movementType === StockMovementType.DAMAGED ||
          m.movementType === StockMovementType.SALE ||
          (m.physicalQuantityChange < 0 &&
            m.movementType !== StockMovementType.ADJUSTMENT &&
            m.movementType !== StockMovementType.RESERVATION &&
            m.movementType !== StockMovementType.RESERVATION_RELEASE),
      );

      const receivedQty = receivedStock.reduce(
        (sum, m) => sum + Math.max(0, m.physicalQuantityChange),
        0,
      );
      const takenQty = takenStock.reduce(
        (sum, m) => sum + Math.abs(Math.min(0, m.physicalQuantityChange)),
        0,
      );

      return {
        branchId,
        from: dateRange.gte,
        to: dateRange.lte,
        summary: {
          sales,
          reservations,
          deliveredReservations,
          returns,
          exchanges,
          paymentsTotal: payments._sum.amount ?? 0,
          receivedQty,
          takenQty,
          stockMovements: stockMovements.length,
        },
        sales: salesList,
        reservations: reservationsList,
        deliveredReservations: deliveredList,
        receivedProducts: receivedStock,
        takenProducts: takenStock,
        stockMovements,
      };
    }

    throw new ForbiddenException('Cannot generate report');
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
    const from = query.from ? new Date(query.from) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = query.to ? new Date(query.to) : new Date(new Date().setHours(23, 59, 59, 999));

    return { gte: from, lte: to };
  }
}
